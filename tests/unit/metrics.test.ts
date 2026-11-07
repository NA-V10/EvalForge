import { describe, expect, it } from "vitest";
import type { AssertionResult, JudgeResult, ScenarioResult } from "@rel/core";
import { aggregateRun, composite, scenarioScores } from "@rel/evaluation-engine";

const a = (dimension: AssertionResult["dimension"], score: number, severity: AssertionResult["severity"] = "medium"): AssertionResult => ({
  id: `${dimension}-${score}`,
  layer: "behavioral",
  kind: "x",
  name: "x",
  dimension,
  passed: score === 1,
  score,
  severity,
  message: "",
  evidence: [],
  hardGate: false,
});

describe("scoring", () => {
  it("uses the minimum for hard dimensions (one unsafe action is disqualifying)", () => {
    const s = scenarioScores([a("safety", 1), a("safety", 1), a("safety", 0, "critical")], []);
    expect(s.safety).toBe(0);
  });

  it("uses severity-weighted means for other dimensions and null when not applicable", () => {
    const s = scenarioScores([a("correctness", 1, "critical"), a("correctness", 0, "low")], []);
    expect(s.correctness).toBeCloseTo(4 / 5);
    expect(s.recovery).toBeNull();
  });

  it("blends judge scores weighted by confidence and ignores errored judges", () => {
    const judge = (score: number, confidence: number, judgeName = "j"): JudgeResult => ({
      criterionId: "c",
      criterionName: "c",
      dimension: "response_quality",
      score,
      confidence,
      reason: "r",
      evidence: [],
      judge: judgeName,
      threshold: 0.5,
      blocking: false,
      passed: true,
      latencyMs: 0,
      costUsd: 0,
    });
    expect(scenarioScores([], [judge(0.8, 1), judge(0, 0, "error")]).response_quality).toBeCloseTo(0.8);
  });

  it("composite is display-only and skips missing dimensions", () => {
    expect(composite({ correctness: 1, safety: 1 })).toBe(1);
    expect(composite({ correctness: 0.5, safety: 1, recovery: null })).toBeCloseTo((0.5 * 0.2 + 1 * 0.2) / 0.4);
  });

  it("aggregates runs: pass rate, per-category counts, operational stats, hard gates", () => {
    const r = (status: "passed" | "failed", category: string, latencyMs: number, safety: number, hard = false) =>
      ({ status, category, hardGateFailed: hard, scores: { safety }, operational: { latencyMs, costUsd: 0.01, toolCalls: 3, promptTokens: 100, completionTokens: 10 } }) as unknown as ScenarioResult;
    const m = aggregateRun([r("passed", "happy_path", 1000, 1), r("failed", "adversarial", 3000, 0, true), r("passed", "happy_path", 2000, 1)]);
    expect(m.passRate).toBeCloseTo(2 / 3, 3);
    expect(m.byCategory).toEqual({ happy_path: { total: 2, passed: 2 }, adversarial: { total: 1, passed: 0 } });
    expect(m.dimensions.safety).toBeCloseTo(2 / 3, 3);
    expect(m.operational.avgLatencyMs).toBe(2000);
    expect(m.operational.p95LatencyMs).toBe(3000);
    expect(m.hardGateFailures).toBe(1);
  });
});
