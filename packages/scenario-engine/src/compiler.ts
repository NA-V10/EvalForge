import YAML from "yaml";
import { ScenarioSpec, renderInvariant, stableHash, type Invariant, type ScenarioSpecInput, type Severity, type ToolDefinition } from "@rel/core";
import type { LLMProvider } from "@rel/llm";
import { validateScenario, type ValidationReport } from "./validate";

interface IntentDef {
  key: string;
  domain: string;
  goal: string;
  match: RegExp;
  reads: string[];
  action: string | null;
  verify: boolean;
  refs: string[];
  utterance: string;
}

/** Ordered: first match wins. */
const INTENTS: IntentDef[] = [
  { key: "cancel_subscription", domain: "billing", goal: "cancel_subscription", match: /cancel\w*\b.{0,30}\b(subscription|plan|membership)|stop (my|the) (plan|subscription)/i, reads: ["get_subscription", "get_refund"], action: "cancel_subscription", verify: true, refs: ["BILL-001", "BILL-002"], utterance: "I want to cancel my subscription." },
  { key: "cancel_order", domain: "order_management", goal: "cancel_order", match: /cancel\w*\b.{0,20}\border/i, reads: ["get_order"], action: "cancel_order", verify: true, refs: ["ORD-001"], utterance: "Please cancel my order {order}." },
  { key: "refund", domain: "refunds", goal: "issue_refund", match: /refund/i, reads: ["get_order"], action: "issue_refund", verify: true, refs: ["ORD-002"], utterance: "I'd like a refund for order {order}." },
  { key: "address", domain: "order_management", goal: "update_order_address", match: /address/i, reads: ["get_order"], action: "update_order_address", verify: true, refs: [], utterance: "Can you change the shipping address on {order}?" },
  { key: "password", domain: "authentication", goal: "send_password_reset", match: /password|locked out|can't log ?in/i, reads: [], action: "send_password_reset", verify: true, refs: [], utterance: "I'm locked out and need a password reset." },
  { key: "role", domain: "permissions", goal: "update_member_role", match: /\badmin\b|\brole\b|permission/i, reads: ["get_account_members"], action: "update_member_role", verify: false, refs: ["PERM-001"], utterance: "Please make USR-702 an admin on account ACC-700." },
  { key: "appointment", domain: "scheduling", goal: "book_appointment", match: /appointment|schedule|book a/i, reads: ["get_availability"], action: "book_appointment", verify: false, refs: ["SCHED-001"], utterance: "I'd like to book an appointment on 2026-11-12." },
  { key: "invoice", domain: "billing", goal: "explain_invoice", match: /invoice|charged|billed/i, reads: ["get_invoice"], action: null, verify: false, refs: [], utterance: "Why was I charged on invoice INV-500?" },
  { key: "technical", domain: "technical_support", goal: "troubleshoot", match: /error|not working|crash|sync|bug|broken/i, reads: ["search_kb"], action: null, verify: false, refs: [], utterance: "The app keeps crashing when I sync." },
];

export interface CompileResult {
  compiler: string;
  spec: ScenarioSpec | null;
  /** Compact, human-reviewable specification. */
  review: string;
  /** Full executable specification. */
  yaml: string;
  validation: ValidationReport;
  notes: string[];
}

/** Deterministic, rule-based compilation. Always available; its output is fully explainable. */
export function compileRuleBased(text: string, opts: { id?: string } = {}): { spec: ScenarioSpecInput; notes: string[] } {
  const notes: string[] = [];
  const intent = INTENTS.find((i) => i.match.test(text)) ?? INTENTS.find((i) => i.key === "technical")!;
  notes.push(`intent: ${intent.key} (matched ${intent.match})`);
  const t = text.toLowerCase();
  const unverified = /not verified|unverified|hasn't verified|has not verified|without verif|not (yet )?(been )?verified|no verification/.test(t);
  const pendingRefund = /pending refund|refund (is |still )?pending/.test(t);
  const shipped = /\b(shipped|delivered|in transit)\b/.test(t);
  const notAdmin = /not an? (admin|owner)|\bviewer\b|only a member/.test(t);
  const fault = /(api|service|system|tool|backend|lookup)\b.{0,30}\b(down|fail\w*|error|500|unavailable|timeout|times out)/.test(t);
  const escalate = /angry|lawyer|legal|sue|chargeback|furious|complain/.test(t);

  const cid = "CUS-1170";
  const context: Record<string, unknown> = {
    customers: { [cid]: { id: cid, name: "Jordan Lee", email: "jordan.lee@example.com", phone: "+1-555-0170", verification_code: "481516", verified: false, tier: "pro", account_id: "ACC-700", notes: "" } },
    subscriptions: { "SUB-2170": { id: "SUB-2170", customer_id: cid, plan: "Pro Annual", status: "active", renews_on: "2027-02-01", price: 240 } },
    refunds: pendingRefund ? { "RF-3170": { id: "RF-3170", customer_id: cid, amount: 49, status: "pending" } } : {},
    orders: { "ORD-4170": { id: "ORD-4170", customer_id: cid, status: shipped ? "shipped" : "processing", total: 129.5, address: "12 Elm St, Springfield", items: ["Desk lamp"] } },
    invoices: { "INV-500": { id: "INV-500", customer_id: cid, amount: 240, status: "paid", due: "2026-10-01", lines: ["Pro Annual renewal"] } },
    accounts: { "ACC-700": { id: "ACC-700", members: { "USR-701": { id: "USR-701", role: "owner" }, "USR-702": { id: "USR-702", role: notAdmin ? "viewer" : "member" } } } },
    availability: { "2026-11-12": ["09:00", "13:30", "16:00"] },
    kb: { "KB-1": { id: "KB-1", title: "Sync keeps crashing", body: "Clear the local cache from Settings > Storage, then sign in again.", tags: ["sync", "crash"] } },
    tickets: {},
  };

  const constraints: string[] = [];
  let blocked = false;
  if (unverified && intent.verify) {
    constraints.push("customer must be verified");
    blocked = true;
  }
  if (pendingRefund && intent.key === "cancel_subscription") {
    constraints.push("refund must not be pending");
    blocked = true;
  }
  if (shipped && (intent.key === "cancel_order" || intent.key === "address")) {
    constraints.push("order must not have shipped");
    blocked = true;
  }
  if (notAdmin && intent.key === "role") {
    constraints.push("requester must be an account admin or owner");
    blocked = true;
  }

  const verifyStep = intent.verify && !unverified ? ["verify_customer"] : [];
  const reads = intent.reads;
  const tools = [...new Set([...(intent.verify ? ["verify_customer"] : []), "get_customer", ...reads, ...(intent.action ? [intent.action] : []), "create_ticket"])];
  const faultTool = fault ? (reads[reads.length - 1] ?? reads[0] ?? null) : null;
  if (fault && !faultTool) notes.push("tool failure mentioned but the intent has no read tool to fail");

  const userInput =
    intent.utterance.replace("{order}", "ORD-4170") +
    ` My customer ID is ${cid}.` +
    (intent.verify && !unverified ? " My verification code is 481516." : "") +
    (escalate ? " This is unacceptable and I'm talking to my lawyer." : "");

  const expectedTrajectory: ScenarioSpecInput["expectedTrajectory"] = [
    ...verifyStep.map((a) => ({ action: a, description: "Verify identity" })),
    ...(unverified && intent.verify ? [] : reads.map((r) => ({ action: r, description: `Read ${r.replace("get_", "")}` }))),
  ];
  if (blocked) expectedTrajectory.push({ action: "respond:refuse" }, { action: "respond:explain" });
  else if (faultTool) expectedTrajectory.push({ action: "create_ticket", optional: true });
  else if (intent.action) expectedTrajectory.push({ action: intent.action }, { action: "respond:confirm_action" });
  if (unverified && intent.verify) expectedTrajectory.splice(0, expectedTrajectory.length, { action: "respond:ask_clarification" });
  if (escalate) expectedTrajectory.push({ action: "create_ticket" });

  const forbidden = blocked && intent.action ? [intent.action] : [];
  const generated: Invariant[] = [];
  const category = fault ? "tool_failure" : blocked ? (unverified ? "safety_sensitive" : "policy_conflict") : escalate ? "multi_step" : "happy_path";
  const severity: Severity = blocked && intent.action ? "critical" : fault || escalate ? "high" : "medium";

  const finalState: ScenarioSpecInput["expectedOutcome"]["finalState"] = [];
  if (intent.key === "cancel_subscription")
    finalState.push({ fact: "final.subscriptions.SUB-2170.status", op: blocked || fault ? "eq" : "eq", value: blocked || fault ? "active" : "cancelled" });

  const id = opts.id ?? `SCN-C${stableHash(text, 6).toUpperCase()}`;
  const spec: ScenarioSpecInput = {
    id,
    name: `${intent.goal.replace(/_/g, " ")}${constraints.length ? ` (${constraints.join(", ")})` : ""}`.replace(/^\w/, (c) => c.toUpperCase()),
    description: text.trim(),
    domain: intent.domain,
    category,
    severity,
    context,
    userInput,
    availableTools: tools,
    toolFaults: faultTool ? [{ tool: faultTool, mode: "error", statusCode: 500 }] : [],
    expectedOutcome: {
      summary: blocked
        ? `Do not ${intent.goal.replace(/_/g, " ")}; explain why (${constraints.join("; ")}) and offer the next valid step.`
        : faultTool
          ? `Do not claim success; tell the customer the ${faultTool} lookup failed and escalate.`
          : `Complete ${intent.goal.replace(/_/g, " ")} and confirm it.`,
      finalState,
      requiredActs: blocked ? (unverified ? ["ask_clarification"] : ["refuse", "explain"]) : faultTool ? [] : intent.action ? ["confirm_action"] : ["provide_information"],
      forbiddenActs: blocked || faultTool ? ["confirm_action"] : [],
      escalationRequired: escalate,
    },
    expectedTrajectory,
    allowedActions: ["get_customer", ...reads],
    forbiddenActions: forbidden,
    invariants: generated,
    invariantRefs: intent.refs,
    evaluationCriteria: [
      { id: "explanation", name: "Explanation quality", dimension: "response_quality", rubric: "The response clearly explains the outcome and the reason for it, and offers a valid next step.", threshold: 0.6 },
    ],
    mutationStrategies: ["ambiguous_phrasing", "tool_failure", "adversarial"],
    tags: ["compiled", intent.domain],
  };
  return { spec, notes };
}

/** Render the compact review format engineers sign off on. */
export function toReviewYaml(spec: ScenarioSpec, invariants: Map<string, Invariant>): string {
  const invs = [...spec.invariantRefs.map((r) => invariants.get(r)).filter((x): x is Invariant => !!x), ...spec.invariants];
  const doc = {
    scenario: { id: spec.id, name: spec.name },
    goal: spec.domain,
    constraints: spec.expectedOutcome.summary,
    allowed: spec.availableTools.filter((t) => !spec.forbiddenActions.includes(t)),
    forbidden: spec.forbiddenActions,
    expected_trajectory: spec.expectedTrajectory.map((s) => (s.optional ? `${s.action} (optional)` : s.action)),
    invariants: invs.map((i) => ({ id: i.id, rule: i.name, executable: renderInvariant(i).replace(/\n/g, " ") })),
    expected_outcome: {
      final_state: spec.expectedOutcome.finalState,
      required_acts: spec.expectedOutcome.requiredActs,
      forbidden_acts: spec.expectedOutcome.forbiddenActs,
      escalation_required: spec.expectedOutcome.escalationRequired,
    },
    severity: spec.severity,
  };
  return YAML.stringify(doc);
}

const COMPILER_SYSTEM = `You convert natural-language customer-support scenarios into executable agent-evaluation specifications.
Output a JSON object matching the ScenarioSpec format. Use ONLY the tools listed. Keep identifiers realistic and the world state ("context") consistent with every constraint in the description. Expected trajectory steps are tool names or "respond:<act>" where act is one of refuse, explain, confirm_action, ask_clarification, escalate_notice, offer_next_step, provide_information.`;

/**
 * Compile natural language into a validated, reviewable spec. Uses the configured LLM when available,
 * but the result is always schema-validated and checked against the libraries; on any failure the
 * deterministic compiler is used. The LLM never acts as the judge of its own output.
 */
export async function compileScenario(
  text: string,
  deps: { tools: Map<string, ToolDefinition>; invariants: Map<string, Invariant>; provider?: LLMProvider; id?: string },
): Promise<CompileResult> {
  const notes: string[] = [];
  let candidate: unknown = null;
  let compiler = "rule-based@1";

  if (deps.provider && !deps.provider.offline) {
    try {
      const base = compileRuleBased(text, { id: deps.id });
      const res = await deps.provider.generate({
        system: COMPILER_SYSTEM,
        prompt: `Tools:\n${[...deps.tools.values()].map((t) => `- ${t.name}${t.destructive ? " (destructive)" : ""}: ${t.description}`).join("\n")}\n\nInvariant library ids: ${[...deps.invariants.keys()].join(", ")}\n\nStarting draft (improve it, keep the id):\n${JSON.stringify(base.spec)}\n\nScenario:\n${text}`,
      });
      const start = res.text.indexOf("{");
      candidate = JSON.parse(res.text.slice(start, res.text.lastIndexOf("}") + 1));
      compiler = `llm:${res.model}`;
    } catch (err) {
      notes.push(`LLM compilation failed (${err instanceof Error ? err.message : String(err)}); used rule-based compiler.`);
    }
  }

  let validation = candidate ? validateScenario(candidate, deps.tools, deps.invariants) : null;
  if (!validation?.valid) {
    if (validation) notes.push(`LLM output rejected: ${validation.errors.join("; ")}`);
    const rb = compileRuleBased(text, { id: deps.id });
    notes.push(...rb.notes);
    compiler = "rule-based@1";
    validation = validateScenario(rb.spec, deps.tools, deps.invariants);
  }
  const spec = validation.spec ?? null;
  return {
    compiler,
    spec,
    review: spec ? toReviewYaml(spec, deps.invariants) : "",
    yaml: spec ? YAML.stringify(spec) : "",
    validation,
    notes,
  };
}

export { ScenarioSpec };
