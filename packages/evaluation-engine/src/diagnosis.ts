import {
  FAILURE_PRIORITY,
  SEVERITY_RANK,
  maxSeverity,
  newId,
  renderCondition,
  stableHash,
  type AssertionResult,
  type Evidence,
  type Failure,
  type FailureCategory,
  type Invariant,
  type JudgeResult,
} from "@rel/core";
import { formatAction } from "@rel/trajectory-engine";
import type { EvalContext } from "./context";

interface Classified {
  category: FailureCategory;
  subcategory: string;
  /** Assertions in the same group become one failure. */
  group: string;
}

function classify(a: AssertionResult, ctx: EvalContext): Classified {
  switch (a.kind) {
    case "invariant": {
      const inv = ctx.invariants.find((i) => i.id === a.invariantId);
      const sub = inv?.assertion.type === "no_leak" ? "data_exposure" : (inv?.kind ?? "invariant");
      const category: FailureCategory =
        a.dimension === "tool_efficiency" ? "efficiency_failure" : a.dimension === "safety" ? "safety_violation" : "policy_violation";
      return { category, subcategory: sub, group: `invariant:${a.invariantId}` };
    }
    case "forbidden_action":
      return {
        category: a.dimension === "safety" ? "safety_violation" : "policy_violation",
        subcategory: "forbidden_action",
        group: `forbidden:${a.id}`,
      };
    case "unknown_tool":
      return { category: "hallucination", subcategory: "hallucinated_tool", group: "unknown_tool" };
    case "tool_schema":
    case "tool_arguments":
      return { category: "tool_argument_failure", subcategory: a.kind === "tool_schema" ? "schema_invalid" : "semantic_mismatch", group: "args" };
    case "required_tool":
      return { category: "tool_selection_failure", subcategory: "missing_required_tool", group: "selection" };
    case "trajectory": {
      const k = ctx.divergence?.kind;
      if (k === "wrong_order") return { category: "tool_ordering_failure", subcategory: "wrong_order", group: "ordering" };
      if (k === "wrong_arguments") return { category: "tool_argument_failure", subcategory: "semantic_mismatch", group: "args" };
      if (k === "unexpected_action" || k === "forbidden_action")
        return { category: "safety_violation", subcategory: "unexpected_destructive_action", group: "trajectory_safety" };
      return { category: "tool_selection_failure", subcategory: "missing_step", group: "selection" };
    }
    case "outcome_state":
    case "outcome_required_act":
    case "outcome_forbidden_act":
    case "outcome_mention":
    case "outcome_forbidden_mention":
      return { category: "outcome_failure", subcategory: a.kind.replace("outcome_", ""), group: "outcome" };
    case "escalation":
      return { category: "escalation_failure", subcategory: "missing_handoff", group: "escalation" };
    case "recovery": {
      const timeout = a.evidence.some((e) => /TIMEOUT/.test(e.explanation));
      return { category: timeout ? "timeout" : "recovery_failure", subcategory: timeout ? "unhandled_timeout" : "unhandled_tool_error", group: "recovery" };
    }
    case "false_success_claim":
      return { category: "hallucination", subcategory: "fabricated_action", group: "hallucination" };
    case "refusal_consistency":
      return { category: "state_inconsistency", subcategory: "refusal_contradicts_action", group: "state" };
    case "grounding":
      return { category: "grounding_failure", subcategory: "unsupported_claim", group: "grounding" };
    case "infrastructure":
      return { category: "infrastructure_failure", subcategory: "adapter_error", group: "infra" };
    case "limit_latency":
      return { category: "efficiency_failure", subcategory: "latency_budget", group: "efficiency" };
    default:
      return { category: "efficiency_failure", subcategory: a.kind, group: "efficiency" };
  }
}

const TITLES: Record<FailureCategory, string> = {
  outcome_failure: "Wrong outcome",
  tool_selection_failure: "Required step skipped",
  tool_argument_failure: "Incorrect tool arguments",
  tool_ordering_failure: "Steps executed out of order",
  policy_violation: "Policy violation",
  safety_violation: "Unsafe action",
  grounding_failure: "Ungrounded claims",
  hallucination: "Hallucinated action",
  state_inconsistency: "Response contradicts state",
  recovery_failure: "Failed to recover from tool error",
  escalation_failure: "Missed escalation",
  efficiency_failure: "Inefficient execution",
  timeout: "Unhandled timeout",
  infrastructure_failure: "Agent infrastructure error",
};

function invariantDiagnosis(inv: Invariant, ev: Evidence[], ctx: EvalContext): { cause: string; fix: string } {
  const a = inv.assertion;
  const facts = ev.map((e) => e.explanation).slice(0, 2).join("; ");
  const injected = ctx.spec.mutation?.strategy === "prompt_injection" || ctx.spec.tags.includes("prompt-injection");
  switch (a.type) {
    case "call_before":
      return {
        cause: `${a.then}() executed without a successful ${a.first}() earlier in the session. The ordering requirement exists only as instructions to the model, so nothing stopped the call.`,
        fix: `Add a deterministic guard in the tool-execution layer: reject ${a.then}() unless ${a.first}() succeeded in this session, and return a structured error the model can explain to the customer.`,
      };
    case "call_only_when": {
      const read = ctx.toolCalls.some((p) => a.requires && JSON.stringify(a.requires).includes(String(p.call.tool ?? "").replace("get_", "")));
      return {
        cause: `The agent called ${a.tool}() while the blocking condition held (${facts}). ${read ? "It retrieved the blocking state but did not act on it." : "It never checked the blocking state before acting."}`,
        fix: `Add an explicit policy guard before ${a.tool}() that evaluates "${renderCondition(a.requires)}" and returns a refusal reason to the model.`,
      };
    }
    case "destructive_only_when":
      return {
        cause: `A destructive action ran before the precondition "${renderCondition(a.requires)}" was satisfied (${facts}).${ctx.spec.category === "adversarial" ? " The customer's claim was trusted instead of verified." : ""}`,
        fix: "Gate every destructive tool behind a verified-session check enforced in code, not in the prompt. Treat customer assertions about prior verification as untrusted input.",
      };
    case "no_leak":
      return {
        cause: "The response disclosed sensitive values returned by tools to a requester who was not entitled to them.",
        fix: "Strip sensitive fields from tool results before they reach the model and add an output filter for PII and secrets on every response.",
      };
    case "never_call":
    case "no_destructive_action":
      return {
        cause: injected
          ? "The agent followed instructions embedded in tool-returned data (prompt injection) and executed a prohibited action."
          : `A prohibited tool was executed (${facts}).`,
        fix: injected
          ? "Treat tool results as data, never instructions: wrap them in delimited, typed fields and require explicit user intent for any destructive call."
          : "Remove the prohibited tool from the agent's toolset in this context or require explicit, verified confirmation before it can run.",
      };
    case "acts_exclude":
    case "acts_include":
      return {
        cause: `The final response ${a.type === "acts_exclude" ? "performed" : "omitted"} ${a.acts.join("/")} contrary to "${inv.name}".`,
        fix: "Propagate tool errors to the model as structured failures and generate confirmations only from successful tool results.",
      };
    case "response_not_matches":
    case "response_matches":
      return { cause: `The response text violated "${inv.name}": ${facts}.`, fix: "Constrain the response template for this intent and refuse to state facts that were not successfully retrieved." };
    case "max_calls":
      return { cause: `Tool budget exceeded: ${facts}.`, fix: "Cache lookups within a conversation and stop retrying non-transient errors." };
    case "args_match":
      return { cause: `Arguments violated "${inv.name}": ${facts}.`, fix: "Derive identifiers and amounts from tool results instead of free text, and validate them before execution." };
    case "state":
    case "must_call":
      return { cause: `"${inv.name}" did not hold: ${facts}.`, fix: "Add a post-action check that verifies this state before responding." };
  }
}

function genericDiagnosis(category: FailureCategory, group: AssertionResult[], ctx: EvalContext): { cause: string; fix: string } {
  const msgs = group.map((g) => g.message).join(" ");
  const d = ctx.divergence;
  switch (category) {
    case "tool_selection_failure":
      return {
        cause: d ? `${d.reason} ${msgs}` : msgs,
        fix: `Make the missing step${d?.expected ? ` (${formatAction(d.expected)})` : ""} an explicit required stage for this intent — e.g. a planner/state machine that cannot reach the response stage without it.`,
      };
    case "tool_ordering_failure":
      return { cause: d?.reason ?? msgs, fix: "Enforce step ordering in code (precondition checks per tool) rather than relying on prompt order." };
    case "tool_argument_failure":
      return { cause: msgs, fix: "Validate arguments against the tool schema before execution, feed validation errors back to the model, and take identifiers from verified context." };
    case "outcome_failure":
      return { cause: msgs, fix: "Review the response policy for this intent; add the expected behaviour as an explicit rule and keep this scenario in the regression suite." };
    case "escalation_failure":
      return {
        cause: "Escalation conditions were present (e.g. legal threat, out-of-policy request or repeated failure) but no ticket was created.",
        fix: "Add deterministic escalation triggers that create a ticket via create_ticket() and tell the customer a specialist will follow up.",
      };
    case "recovery_failure":
    case "timeout":
      return {
        cause: msgs,
        fix: "Retry transient errors (5xx, timeouts) once with backoff; if still failing, escalate via create_ticket() and tell the customer honestly what happened.",
      };
    case "hallucination":
      return { cause: msgs, fix: "Only confirm actions after a successful tool result, and generate confirmations from the tool output rather than free text." };
    case "grounding_failure":
      return { cause: msgs, fix: "Require statuses, amounts and identifiers in responses to come from successful tool results; when a lookup fails, say so instead of guessing." };
    case "state_inconsistency":
      return { cause: msgs, fix: "Generate the final response from the post-action world state so it cannot contradict what the agent actually did." };
    case "safety_violation":
      return { cause: d?.reason ?? msgs, fix: "Block unexpected destructive actions with a deterministic allow-list per intent and require verified confirmation." };
    case "infrastructure_failure":
      return { cause: msgs, fix: "Inspect the agent adapter logs; this run is not a behavioural signal until it executes cleanly." };
    default:
      return { cause: msgs, fix: "Remove redundant lookups and cache read results within a conversation." };
  }
}

/** Turn failed assertions (+ failed blocking judgments) into structured, actionable failures. */
export function diagnose(
  ctx: EvalContext,
  assertions: AssertionResult[],
  judgments: JudgeResult[],
  meta: { runId: string; resultId: string; agentVersion: string },
): Failure[] {
  const failed = assertions.filter((a) => !a.passed);
  const groups = new Map<string, { cls: Classified; items: AssertionResult[] }>();
  for (const a of failed) {
    const cls = classify(a, ctx);
    const g = groups.get(cls.group) ?? { cls, items: [] };
    g.items.push(a);
    groups.set(cls.group, g);
  }
  // A forbidden-action failure duplicated by an invariant on the same step adds no information.
  const invariantSteps = new Set(failed.filter((a) => a.kind === "invariant").flatMap((a) => a.evidence.map((e) => e.traceStep)));
  for (const [key, g] of groups) {
    if ((key.startsWith("forbidden:") || key === "trajectory_safety") && g.items.every((i) => i.evidence.every((e) => invariantSteps.has(e.traceStep)))) {
      // keep the evidence on the invariant failure, drop the duplicate
      groups.delete(key);
    }
  }

  const failures: Failure[] = [];
  for (const { cls, items } of groups.values()) {
    const severity = maxSeverity(items.map((i) => i.severity))!;
    const invAssertion = items.find((i) => i.invariantId);
    const inv = invAssertion ? ctx.invariants.find((i) => i.id === invAssertion.invariantId) : undefined;
    const evidence = items.flatMap((i) => i.evidence).slice(0, 10);
    const dx = inv ? invariantDiagnosis(inv, evidence, ctx) : genericDiagnosis(cls.category, items, ctx);
    const d = ctx.divergence;
    failures.push({
      id: newId("fail"),
      fingerprint: stableHash([ctx.spec.id, cls.category, inv?.id ?? cls.subcategory]),
      scenarioId: ctx.spec.id,
      runId: meta.runId,
      resultId: meta.resultId,
      agentVersion: meta.agentVersion,
      title: inv ? `${TITLES[cls.category]}: ${inv.name}` : `${TITLES[cls.category]} — ${ctx.spec.name}`,
      category: cls.category,
      subcategory: cls.subcategory,
      severity,
      firstDivergenceStep: d?.traceStep ?? null,
      firstDivergence: d,
      expectedBehavior: items.map((i) => i.expected).find(Boolean) ?? (d?.expected ? formatAction(d.expected) : ctx.spec.expectedOutcome.summary),
      actualBehavior: items.map((i) => i.actual).find(Boolean) ?? items.map((i) => i.message).join(" "),
      violatedInvariant: inv ? { id: inv.id, name: inv.name, description: inv.description } : null,
      evidence,
      likelyCause: dx.cause,
      recommendation: dx.fix,
      assertionIds: items.map((i) => i.id),
      regression: false,
      previousPassingVersion: null,
      createdAt: new Date().toISOString(),
    });
  }

  for (const j of judgments.filter((x) => x.blocking && !x.passed)) {
    failures.push({
      id: newId("fail"),
      fingerprint: stableHash([ctx.spec.id, "judge", j.criterionId]),
      scenarioId: ctx.spec.id,
      runId: meta.runId,
      resultId: meta.resultId,
      agentVersion: meta.agentVersion,
      title: `${j.dimension === "grounding" ? "Ungrounded claims" : "Response quality"}: ${j.criterionName}`,
      category: j.dimension === "grounding" ? "grounding_failure" : "outcome_failure",
      subcategory: `judge:${j.criterionId}`,
      severity: "medium",
      firstDivergenceStep: ctx.divergence?.traceStep ?? null,
      firstDivergence: ctx.divergence,
      expectedBehavior: `score >= ${j.threshold}`,
      actualBehavior: `score ${j.score.toFixed(2)} (${j.judge}, confidence ${j.confidence.toFixed(2)})`,
      violatedInvariant: null,
      evidence: j.evidence.map((e) => ({ traceStep: e.trace_step, explanation: e.explanation })),
      likelyCause: j.reason,
      recommendation: "Review the judge evidence; tighten the response template or instructions for this intent.",
      assertionIds: [`judge:${j.criterionId}`],
      regression: false,
      previousPassingVersion: null,
      createdAt: new Date().toISOString(),
    });
  }

  return failures.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || FAILURE_PRIORITY[a.category] - FAILURE_PRIORITY[b.category]);
}
