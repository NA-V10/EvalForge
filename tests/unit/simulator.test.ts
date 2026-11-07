import { describe, expect, it } from "vitest";
import { deepClone, seededRandom } from "@rel/core";
import { ToolSimulator, validateToolArgs } from "@rel/evaluation-engine";
import { SCN_017, tools } from "../helpers";

const world = () =>
  deepClone({
    ...SCN_017.context,
    orders: { "ORD-1": { id: "ORD-1", status: "shipped", total: 10 }, "ORD-2": { id: "ORD-2", status: "processing", total: 20 } },
  }) as Record<string, unknown>;

describe("tool simulator", () => {
  it("executes reads, omitting secret fields", () => {
    const sim = new ToolSimulator(tools, world(), [], seededRandom(1));
    const r = sim.call("get_customer", { customer_id: "CUS-1017" });
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ name: "Avery Chen" });
    expect(r.result).not.toHaveProperty("verification_code");
  });

  it("verifies identity and records the state change", () => {
    const sim = new ToolSimulator(tools, world(), [], seededRandom(1));
    expect(sim.call("verify_customer", { customer_id: "CUS-1017", verification_code: "000000" }).result).toEqual({ verified: false, reason: "code does not match" });
    const ok = sim.call("verify_customer", { customer_id: "CUS-1017", verification_code: "620417" });
    expect(ok.result).toEqual({ verified: true });
    expect(ok.stateDiff).toEqual([{ path: "customers.CUS-1017.verified", before: false, after: true }]);
  });

  it("enforces backend guards on mutations", () => {
    const sim = new ToolSimulator(tools, world(), [], seededRandom(1));
    expect(sim.call("cancel_order", { order_id: "ORD-1" }).error?.code).toBe("CONFLICT");
    const ok = sim.call("cancel_order", { order_id: "ORD-2" });
    expect(ok.ok).toBe(true);
    expect(ok.stateDiff[0]).toMatchObject({ path: "orders.ORD-2.status", before: "processing", after: "cancelled" });
  });

  it("injects faults only on the configured calls", () => {
    const sim = new ToolSimulator(tools, world(), [{ tool: "get_refund", mode: "error", statusCode: 503, onCalls: [1] }], seededRandom(1));
    expect(sim.call("get_refund", { customer_id: "CUS-1017" }).error?.code).toBe("HTTP_503");
    expect(sim.call("get_refund", { customer_id: "CUS-1017" }).ok).toBe(true);
  });

  it("supports timeout, empty and contradictory faults", () => {
    const sim = new ToolSimulator(
      tools,
      world(),
      [
        { tool: "get_subscription", mode: "timeout", latencyMs: 9000 },
        { tool: "get_refund", mode: "empty" },
        { tool: "get_customer", mode: "contradictory", override: { tier: "free" } },
      ],
      seededRandom(1),
    );
    const t = sim.call("get_subscription", { customer_id: "CUS-1017" });
    expect(t.error?.code).toBe("TIMEOUT");
    expect(t.latencyMs).toBe(9000);
    expect(sim.call("get_refund", { customer_id: "CUS-1017" }).result).toEqual([]);
    expect(sim.call("get_customer", { customer_id: "CUS-1017" }).result).toMatchObject({ tier: "free" });
  });

  it("rejects schema-invalid arguments like a real backend", () => {
    const def = tools.get("verify_customer")!;
    expect(validateToolArgs(def, { customer_id: "1017" })).toEqual(
      expect.arrayContaining([expect.stringContaining("customer_id"), expect.stringContaining('missing required argument "verification_code"')]),
    );
  });

  it("is deterministic for a seed", () => {
    const a = new ToolSimulator(tools, world(), [], seededRandom(9)).call("get_refund", { customer_id: "CUS-1017" });
    const b = new ToolSimulator(tools, world(), [], seededRandom(9)).call("get_refund", { customer_id: "CUS-1017" });
    expect(a.latencyMs).toBe(b.latencyMs);
  });
});
