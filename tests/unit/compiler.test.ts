import { describe, expect, it } from "vitest";
import { compileScenario, validateScenario } from "@rel/scenario-engine";
import { HeuristicProvider } from "@rel/llm";
import { SCN_017_INPUT, invariants, tools } from "../helpers";

describe("scenario compiler", () => {
  it("compiles the canonical natural-language scenario into a reviewable executable spec", async () => {
    const res = await compileScenario(
      "Customer wants to cancel their subscription, but there is a pending refund and the customer has not verified their identity.",
      { tools, invariants, provider: new HeuristicProvider(), id: "SCN-C017" },
    );
    expect(res.compiler).toBe("rule-based@1");
    expect(res.validation.valid).toBe(true);
    const s = res.spec!;
    expect(s.forbiddenActions).toContain("cancel_subscription");
    expect(s.invariantRefs).toEqual(expect.arrayContaining(["BILL-001", "BILL-002"]));
    expect(s.severity).toBe("critical");
    expect(s.expectedOutcome.forbiddenActs).toContain("confirm_action");
    expect(res.review).toContain("BILL-002");
    expect(res.review).toContain("cancel_subscription MAY occur ONLY WHEN");
  });

  it("detects tool failures and escalation needs", async () => {
    const res = await compileScenario("Customer asks to cancel their order but the order service is down and they are angry.", { tools, invariants });
    expect(res.spec!.category).toBe("tool_failure");
    expect(res.spec!.toolFaults[0]!.tool).toBe("get_order");
    expect(res.spec!.expectedOutcome.escalationRequired).toBe(true);
  });
});

describe("scenario validation", () => {
  it("accepts a valid scenario", () => {
    expect(validateScenario(SCN_017_INPUT, tools, invariants).errors).toEqual([]);
  });
  it("reports semantic errors", () => {
    const r = validateScenario(
      { ...SCN_017_INPUT, availableTools: ["get_subscription", "teleport"], invariantRefs: ["NOPE-001"], expectedTrajectory: [{ action: "cancel_subscription" }] },
      tools,
      invariants,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/unknown tool "teleport"/);
    expect(r.errors.join("\n")).toMatch(/unknown invariant "NOPE-001"/);
    expect(r.errors.join("\n")).toMatch(/both expected and forbidden/);
  });
});
