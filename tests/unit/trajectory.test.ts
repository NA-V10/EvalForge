import { describe, expect, it } from "vitest";
import type { ActualAction, ExpectedStep, Trace } from "@rel/core";
import { classifyActs, findFirstDivergence, trajectoryAlignment } from "@rel/trajectory-engine";

const trace = (args: Record<number, Record<string, unknown>> = {}): Trace =>
  ({
    id: "t",
    runId: "r",
    scenarioId: "s",
    agentVersion: "v",
    model: "m",
    seed: 1,
    startedAt: "",
    steps: Object.entries(args).map(([i, a]) => ({ index: Number(i), type: "tool_call", timestamp: "", offsetMs: 0, durationMs: 0, arguments: a })),
    totals: {} as Trace["totals"],
    initialState: {},
    finalState: {},
  }) as Trace;

const act = (action: string, traceStep: number, destructive = false): ActualAction => ({ action, traceStep, destructive, status: "ok" });
const exp = (action: string, optional = false): ExpectedStep => ({ action, optional });

const EXPECTED = [exp("verify_customer"), exp("get_subscription"), exp("get_refund"), exp("respond:refuse"), exp("respond:explain")];
const run = (actual: ActualAction[], expected = EXPECTED, forbidden = ["cancel_subscription"]) =>
  findFirstDivergence({ expected, actual, forbidden, allowed: [], trace: trace(), finalResponse: "" });

describe("first divergence", () => {
  it("returns null for a matching trajectory (retries and extra acts tolerated)", () => {
    expect(
      run([act("verify_customer", 1), act("get_subscription", 3), act("get_refund", 5), act("get_refund", 7), act("respond:refuse", 9), act("respond:explain", 9), act("respond:offer_next_step", 9)]),
    ).toBeNull();
  });

  it("detects a forbidden destructive action as a critical divergence", () => {
    const d = run([act("verify_customer", 1), act("get_subscription", 3), act("get_refund", 5), act("cancel_subscription", 7, true)]);
    expect(d).toMatchObject({ position: 4, expected: "respond:refuse", actual: "cancel_subscription", kind: "forbidden_action", severity: "critical", traceStep: 7 });
  });

  it("detects skipped verification as wrong order at the first step", () => {
    const d = run([act("get_subscription", 1), act("get_refund", 3), act("respond:refuse", 5)]);
    expect(d).toMatchObject({ position: 1, expected: "verify_customer", actual: "get_subscription", kind: "wrong_order" });
  });

  it("reports a missing final step at end of conversation", () => {
    const d = run([act("verify_customer", 1), act("get_subscription", 3), act("get_refund", 5)]);
    expect(d).toMatchObject({ position: 4, expected: "respond:refuse", actual: null, kind: "missing_action" });
  });

  it("flags unexpected destructive actions even when not explicitly forbidden", () => {
    const d = run([act("verify_customer", 1), act("issue_refund", 3, true)], [exp("verify_customer"), exp("get_order")], []);
    expect(d).toMatchObject({ kind: "unexpected_action", severity: "critical", actual: "issue_refund" });
  });

  it("skips optional steps and tolerates extra read-only calls", () => {
    const expected = [exp("get_customer", true), exp("get_order"), exp("respond:provide_information")];
    expect(run([act("search_kb", 1), act("get_order", 3), act("respond:provide_information", 5)], expected, [])).toBeNull();
  });

  it("checks semantic arguments of matched steps", () => {
    const d = findFirstDivergence({
      expected: [{ action: "verify_customer", optional: false, args: { customer_id: { equals: "CUS-1" } } }],
      actual: [act("verify_customer", 1)],
      forbidden: [],
      allowed: [],
      trace: trace({ 1: { customer_id: "CUS-2" } }),
      finalResponse: "",
    });
    expect(d).toMatchObject({ kind: "wrong_arguments", position: 1 });
  });

  it("scores alignment with LCS", () => {
    expect(trajectoryAlignment(EXPECTED, [act("verify_customer", 1), act("get_refund", 2), act("respond:refuse", 3)])).toBeCloseTo(3 / 5);
  });
});

describe("response act classification", () => {
  it.each([
    ["I can't cancel subscription SUB-1 right now because refund RF-1 is still pending. Once that refund completes, reply here.", ["refuse", "explain", "offer_next_step"]],
    ["Done — your Pro subscription (SUB-1) has been cancelled, and you won't be charged again.", ["confirm_action"]],
    ["Could you share your customer ID?", ["ask_clarification"]],
    ["Your subscription has not been cancelled.", []],
    ["I've opened ticket TCK-9001 and our support team will follow up.", ["escalate_notice"]],
  ])("%s", (text, acts) => {
    const got = classifyActs(text);
    for (const a of acts) expect(got).toContain(a);
    if (acts.length === 0) expect(got).not.toContain("confirm_action");
  });
});
