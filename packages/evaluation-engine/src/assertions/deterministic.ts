import type { AssertionResult } from "@rel/core";
import { evaluateCondition, explainFacts, isRespond } from "@rel/trajectory-engine";
import { renderCondition } from "@rel/core";
import { validateToolArgs } from "../simulator";
import { assertion, type EvalContext } from "../context";

const L = "deterministic" as const;

/** Layer 1 — authoritative code checks: schemas, limits, outcome state, required content. */
export function deterministicAssertions(ctx: EvalContext): AssertionResult[] {
  const { spec, trace } = ctx;
  const out: AssertionResult[] = [];

  if (trace.infrastructureError) {
    out.push(
      assertion({
        layer: L,
        kind: "infrastructure",
        name: "Agent executed without infrastructure errors",
        dimension: "correctness",
        passed: false,
        severity: "high",
        message: `Agent adapter failed: ${trace.infrastructureError}`,
        evidence: [{ traceStep: trace.steps.at(-1)?.index, explanation: trace.infrastructureError }],
      }),
    );
  }

  // Hallucinated tools — calls to tools the agent was never given.
  const unknown = ctx.toolCalls.filter((p) => !spec.availableTools.includes(p.call.tool ?? ""));
  out.push(
    assertion({
      layer: L,
      kind: "unknown_tool",
      name: "Only available tools are called",
      dimension: "tool_correctness",
      passed: unknown.length === 0,
      severity: "high",
      message: unknown.length ? `Called unavailable tool(s): ${unknown.map((u) => u.call.tool).join(", ")}` : "All tool calls target available tools.",
      evidence: unknown.map((u) => ({ traceStep: u.call.index, explanation: `${u.call.tool} is not in availableTools` })),
    }),
  );

  // Schema validity of arguments.
  const invalid = ctx.toolCalls
    .map((p) => {
      const def = ctx.tools.get(p.call.tool ?? "");
      return { p, problems: def ? validateToolArgs(def, p.call.arguments ?? {}) : [] };
    })
    .filter((x) => x.problems.length > 0);
  if (ctx.toolCalls.length > 0) {
    out.push(
      assertion({
        layer: L,
        kind: "tool_schema",
        name: "Tool arguments match input schemas",
        dimension: "tool_arguments",
        passed: invalid.length === 0,
        score: 1 - invalid.length / ctx.toolCalls.length,
        severity: "medium",
        message: invalid.length ? `${invalid.length} call(s) had schema-invalid arguments` : "All tool arguments are schema-valid.",
        evidence: invalid.map((x) => ({ traceStep: x.p.call.index, explanation: `${x.p.call.tool}: ${x.problems.join("; ")}` })),
      }),
    );
  }

  // Operational limits.
  const lim = spec.limits;
  const t = trace.totals;
  out.push(
    assertion({
      layer: L,
      kind: "limit_tool_calls",
      name: `At most ${lim.maxToolCalls} tool calls`,
      dimension: "tool_efficiency",
      passed: t.toolCalls <= lim.maxToolCalls && !trace.steps.some((s) => s.error?.code === "BUDGET_EXCEEDED"),
      severity: "low",
      message: `${t.toolCalls} tool calls (limit ${lim.maxToolCalls})`,
      expected: `<= ${lim.maxToolCalls}`,
      actual: String(t.toolCalls),
    }),
    assertion({
      layer: L,
      kind: "limit_latency",
      name: `End-to-end latency under ${lim.maxLatencyMs}ms`,
      dimension: "tool_efficiency",
      passed: t.latencyMs <= lim.maxLatencyMs,
      score: Math.min(1, lim.maxLatencyMs / Math.max(1, t.latencyMs)),
      severity: "low",
      message: `${Math.round(t.latencyMs)}ms (limit ${lim.maxLatencyMs}ms)`,
      expected: `<= ${lim.maxLatencyMs}ms`,
      actual: `${Math.round(t.latencyMs)}ms`,
    }),
    assertion({
      layer: L,
      kind: "limit_cost",
      name: `Execution cost under $${lim.maxCostUsd}`,
      dimension: "tool_efficiency",
      passed: t.costUsd <= lim.maxCostUsd,
      severity: "low",
      message: `$${t.costUsd.toFixed(4)} (limit $${lim.maxCostUsd})`,
    }),
  );

  // Expected outcome: final world state.
  spec.expectedOutcome.finalState.forEach((cond, i) => {
    const passed = evaluateCondition(cond, ctx.facts);
    out.push(
      assertion({
        layer: L,
        kind: "outcome_state",
        key: String(i),
        name: `Final state: ${renderCondition(cond)}`,
        dimension: "correctness",
        passed,
        severity: spec.severity,
        message: passed ? "Final state matches expectation." : `Final state violates ${renderCondition(cond)}`,
        expected: renderCondition(cond),
        actual: JSON.stringify(explainFacts(cond, ctx.facts).map((f) => `${f.path}=${JSON.stringify(f.value)}`)),
        evidence: passed ? [] : explainFacts(cond, ctx.facts).map((f) => ({ explanation: `${f.path} = ${JSON.stringify(f.value)}`, fact: f })),
      }),
    );
  });

  // Required / forbidden response acts.
  for (const act of spec.expectedOutcome.requiredActs) {
    const passed = ctx.final.acts.includes(act);
    out.push(
      assertion({
        layer: L,
        kind: "outcome_required_act",
        key: act,
        name: `Final response must ${act.replace(/_/g, " ")}`,
        dimension: "correctness",
        passed,
        severity: spec.severity === "critical" ? "high" : spec.severity,
        message: passed ? `Response includes "${act}".` : `Response does not ${act.replace(/_/g, " ")} (acts: ${ctx.final.acts.join(", ") || "none"}).`,
        evidence: passed ? [] : [{ traceStep: ctx.final.step, explanation: `Classified acts: ${ctx.final.acts.join(", ") || "none"}` }],
      }),
    );
  }
  for (const act of spec.expectedOutcome.forbiddenActs) {
    const passed = !ctx.final.acts.includes(act);
    out.push(
      assertion({
        layer: L,
        kind: "outcome_forbidden_act",
        key: act,
        name: `Final response must not ${act.replace(/_/g, " ")}`,
        dimension: "correctness",
        passed,
        severity: spec.severity,
        message: passed ? `Response does not ${act.replace(/_/g, " ")}.` : `Response performs forbidden act "${act}".`,
        evidence: passed ? [] : [{ traceStep: ctx.final.step, explanation: ctx.final.text.slice(0, 240) }],
      }),
    );
  }

  spec.expectedOutcome.mustMention.forEach((p, i) => {
    const passed = new RegExp(p, "i").test(ctx.final.text);
    out.push(
      assertion({
        layer: L,
        kind: "outcome_mention",
        key: String(i),
        name: `Response mentions /${p}/`,
        dimension: "correctness",
        passed,
        severity: "medium",
        message: passed ? `Mentions /${p}/.` : `Response never mentions /${p}/.`,
        evidence: passed ? [] : [{ traceStep: ctx.final.step, explanation: `No match for /${p}/` }],
      }),
    );
  });
  spec.expectedOutcome.mustNotMention.forEach((p, i) => {
    const m = ctx.agentText.match(new RegExp(p, "i"));
    out.push(
      assertion({
        layer: L,
        kind: "outcome_forbidden_mention",
        key: String(i),
        name: `Response never mentions /${p}/`,
        dimension: "correctness",
        passed: !m,
        severity: "high",
        message: m ? `Agent said "${m[0]}".` : `Does not mention /${p}/.`,
        evidence: m ? [{ traceStep: ctx.final.step, explanation: `Matched "${m[0]}"` }] : [],
      }),
    );
  });

  // Escalation (human handoff).
  if (spec.expectedOutcome.escalationRequired) {
    const ticket = ctx.toolCalls.find((p) => p.call.tool === "create_ticket" && p.result?.status === "ok");
    out.push(
      assertion({
        layer: L,
        kind: "escalation",
        name: "Escalates to a human specialist",
        dimension: "handoff",
        passed: Boolean(ticket),
        severity: "high",
        message: ticket ? "Created a support ticket for human follow-up." : "Escalation was required but no ticket was created.",
        evidence: ticket ? [{ traceStep: ticket.call.index, explanation: "create_ticket succeeded" }] : [{ traceStep: ctx.final.step, explanation: "No successful create_ticket call" }],
      }),
    );
  }

  // Required response acts appearing in expected trajectory are handled by the behavioral layer.
  void isRespond;
  return out;
}
