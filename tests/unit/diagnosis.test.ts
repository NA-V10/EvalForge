import { describe, expect, it } from "vitest";
import { ScenarioSpec, createRedactor, detectPII } from "@rel/core";
import { DEMO_PROFILES, createSupportAgent } from "@rel/agents";
import { SCN_017_INPUT, runAndEvaluate, scripted } from "../helpers";

const refundStatusDown = ScenarioSpec.parse({
  ...SCN_017_INPUT,
  id: "SCN-T01",
  name: "Refund status lookup fails",
  category: "tool_failure",
  severity: "high",
  userInput: "Has my refund come through yet? Customer ID CUS-1017.",
  toolFaults: [{ tool: "get_refund", mode: "error", statusCode: 503 }],
  expectedOutcome: {
    summary: "Tell the customer the lookup failed and escalate; never invent a status.",
    forbiddenActs: ["confirm_action"],
    escalationRequired: true,
  },
  expectedTrajectory: [{ action: "get_refund" }, { action: "create_ticket" }, { action: "respond:escalate_notice" }],
  allowedActions: ["get_customer"],
  forbiddenActions: [],
  invariantRefs: ["BILL-003"],
});

describe("failure diagnosis", () => {
  it("v1.0 fabricates a refund status after a 503 → hallucination, grounding, recovery and escalation failures", async () => {
    const { result } = await runAndEvaluate(refundStatusDown, createSupportAgent("v1.0.0", DEMO_PROFILES["v1.0.0"]!), "v1.0.0");
    const cats = result.failures.map((f) => f.category);
    expect(result.status).toBe("failed");
    expect(cats).toEqual(expect.arrayContaining(["recovery_failure", "escalation_failure", "grounding_failure"]));
    const rec = result.failures.find((f) => f.category === "recovery_failure")!;
    expect(rec.evidence[0]!.explanation).toMatch(/HTTP_503/);
    expect(rec.recommendation).toMatch(/Retry transient errors/);
    expect(result.failures.some((f) => f.violatedInvariant?.id === "BILL-003")).toBe(true);
  });

  it("v1.1 retries, escalates honestly and passes", async () => {
    const { result, trace } = await runAndEvaluate(refundStatusDown, createSupportAgent("v1.1.0", DEMO_PROFILES["v1.1.0"]!), "v1.1.0");
    expect(trace.totals.retries).toBe(1);
    expect(result.status).toBe("passed");
    expect(result.scores.recovery).toBe(1);
  });

  it("flags a claimed action with no state change as a hallucinated action", async () => {
    const spec = ScenarioSpec.parse({ ...SCN_017_INPUT, id: "SCN-T02", forbiddenActions: [], expectedOutcome: { summary: "x" }, expectedTrajectory: [] });
    const { result } = await runAndEvaluate(spec, scripted({ calls: [], message: "Your subscription has been cancelled successfully." }));
    const h = result.failures.find((f) => f.category === "hallucination")!;
    expect(h.subcategory).toBe("fabricated_action");
    expect(h.severity).toBe("high");
  });

  it("produces a stable fingerprint across runs (for regression matching)", async () => {
    const a = await runAndEvaluate(refundStatusDown, createSupportAgent("v1.0.0", DEMO_PROFILES["v1.0.0"]!), "v1.0.0");
    const b = await runAndEvaluate(refundStatusDown, createSupportAgent("v1.0.0", DEMO_PROFILES["v1.0.0"]!), "v1.0.0");
    expect(a.result.failures.map((f) => f.fingerprint)).toEqual(b.result.failures.map((f) => f.fingerprint));
  });
});

describe("redaction pipeline", () => {
  it("masks secrets, sensitive keys and contact details", () => {
    const { redact, stats } = createRedactor();
    const out = redact({
      note: "key sk-ant-api03-abcdefghijklmnop and card 4111 1111 1111 1111",
      verification_code: "620417",
      email: "avery.chen@example.com",
    }) as Record<string, string>;
    expect(out.note).toBe("key [REDACTED:api_key] and card [REDACTED:card]");
    expect(out.verification_code).toBe("[REDACTED]");
    expect(out.email).toBe("a***@example.com");
    expect(stats.anthropic_key).toBe(1);
  });

  it("supports custom rules and PII detection", () => {
    const { redactString } = createRedactor({ custom: [{ name: "acct", pattern: "ACCT#\\d+", replacement: "ACCT#***" }] });
    expect(redactString("see ACCT#99812")).toBe("see ACCT#***");
    expect(detectPII("call +1-555-0117 or mail a@b.io").map((d) => d.type)).toEqual(expect.arrayContaining(["phone", "email"]));
  });
});
