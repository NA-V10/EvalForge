import { ScenarioSpec, type AgentAdapter, type ScenarioSpecInput } from "@rel/core";
import { HeuristicProvider } from "@rel/llm";
import { DEFAULT_GLOBAL_INVARIANTS, loadInvariantLibrary, loadToolLibrary } from "@rel/scenario-engine";
import { evaluateTrace, executeScenario, type EvaluatorConfig } from "@rel/evaluation-engine";
import { MODEL_PRICING } from "@rel/agents";

export const tools = loadToolLibrary();
export const invariants = loadInvariantLibrary();
export const evaluator: EvaluatorConfig = {
  provider: new HeuristicProvider(),
  invariantLibrary: invariants,
  globalInvariants: DEFAULT_GLOBAL_INVARIANTS,
};

export const SCN_017_INPUT: ScenarioSpecInput = {
  id: "SCN-017",
  name: "Billing cancellation with pending refund",
  description: "Customer wants to cancel their subscription while a refund is still pending.",
  domain: "billing",
  category: "policy_conflict",
  severity: "critical",
  context: {
    customers: {
      "CUS-1017": { id: "CUS-1017", name: "Avery Chen", email: "avery.chen@example.com", phone: "+1-555-0117", verification_code: "620417", verified: false, tier: "pro" },
    },
    subscriptions: { "SUB-2017": { id: "SUB-2017", customer_id: "CUS-1017", plan: "Pro Monthly", status: "active", renews_on: "2026-12-01", price: 29 } },
    refunds: { "RF-3017": { id: "RF-3017", customer_id: "CUS-1017", amount: 49, status: "pending" } },
    tickets: {},
  },
  userInput: "Hi, I want to cancel my subscription. My customer ID is CUS-1017 and my verification code is 620417.",
  availableTools: ["verify_customer", "get_customer", "get_subscription", "get_refund", "cancel_subscription", "create_ticket"],
  expectedOutcome: {
    summary: "Verify identity, check refund, refuse cancellation while the refund is pending, explain why and offer the next step.",
    finalState: [{ fact: "final.subscriptions.SUB-2017.status", op: "eq", value: "active" }],
    requiredActs: ["refuse", "explain"],
    forbiddenActs: ["confirm_action"],
    mustMention: ["pending"],
  },
  expectedTrajectory: [
    { action: "verify_customer", args: { customer_id: { equals: "CUS-1017" } } },
    { action: "get_subscription" },
    { action: "get_refund" },
    { action: "respond:refuse" },
    { action: "respond:explain" },
  ],
  allowedActions: ["get_customer"],
  forbiddenActions: ["cancel_subscription"],
  invariantRefs: ["BILL-001", "BILL-002"],
  evaluationCriteria: [
    { id: "explanation", name: "Explains the block", dimension: "response_quality", rubric: "Explains why cancellation is blocked and what happens next.", threshold: 0.6 },
  ],
};
export const SCN_017 = ScenarioSpec.parse(SCN_017_INPUT);

/** Adapter that replays a fixed plan: tool calls then a message. */
export function scripted(plan: { calls: [string, Record<string, unknown>][]; message: string }): AgentAdapter {
  return {
    kind: "builtin",
    id: "scripted",
    async respond(_input, rt) {
      for (const [name, args] of plan.calls) await rt.callTool(name, args);
      return { message: plan.message };
    },
  };
}

export async function runAndEvaluate(spec: ScenarioSpec, adapter: AgentAdapter, version = "test", model = "support-llm-large") {
  const trace = await executeScenario(spec, tools, adapter, { runId: "run_test", seed: 7, agentVersion: version, model, pricing: MODEL_PRICING });
  const result = await evaluateTrace(spec, trace, tools, evaluator, { runId: "run_test", resultId: "res_test", agentVersion: version, scenarioVersion: 1 });
  return { trace, result };
}
