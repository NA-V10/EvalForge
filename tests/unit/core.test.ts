import { describe, expect, it } from "vitest";
import { Invariant, ScenarioSpec, getPath, interpolatePath, renderInvariant, seededRandom, stableHash } from "@rel/core";

describe("core domain", () => {
  it("validates invariants and renders them as executable rules", () => {
    const inv = Invariant.parse({
      id: "BILL-002",
      name: "Pending refunds block cancellation",
      description: "A subscription cannot be cancelled while a refund is pending.",
      severity: "critical",
      kind: "temporal",
      assertion: {
        type: "call_only_when",
        tool: "cancel_subscription",
        requires: { fact: "live.refunds.RF-1.status", op: "neq", value: "pending" },
      },
    });
    expect(renderInvariant(inv)).toBe('cancel_subscription MAY occur ONLY WHEN live.refunds.RF-1.status != "pending"');
    expect(() => Invariant.parse({ ...inv, id: "bad" })).toThrow();
  });

  it("applies scenario defaults", () => {
    const s = ScenarioSpec.parse({
      id: "SCN-001",
      name: "Cancel",
      description: "d",
      domain: "billing",
      category: "happy_path",
      severity: "high",
      context: {},
      userInput: "cancel please",
      availableTools: ["get_subscription"],
      expectedOutcome: { summary: "x" },
    });
    expect(s.limits.maxToolCalls).toBe(12);
    expect(s.expectedOutcome.requiredActs).toEqual([]);
  });

  it("has deterministic helpers", () => {
    expect(getPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(interpolatePath("subs.{id}", { id: "S1" })).toBe("subs.S1");
    expect(interpolatePath("subs.{id}", {})).toBeNull();
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    expect([r1(), r1()]).toEqual([r2(), r2()]);
    expect(stableHash({ b: 1, a: 2 })).toBe(stableHash({ a: 2, b: 1 }));
  });
});
