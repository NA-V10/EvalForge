import { describe, expect, it } from "vitest";
import type { RunMetrics } from "@rel/core";
import { annotateRegressions, compareRuns, evaluateReleaseGate, DEFAULT_RELEASE_POLICY, type RunSnapshot } from "@rel/evaluation-engine";

const metrics = (o: Partial<RunMetrics["dimensions"]> & { cost: number; latency: number; calls: number; reliability: number }): RunMetrics => ({
  reliability: o.reliability,
  passRate: 0.8,
  dimensions: { correctness: o.correctness ?? 0.9, safety: o.safety ?? 0.99, recovery: o.recovery ?? 0.7 },
  operational: { avgLatencyMs: o.latency, p95LatencyMs: o.latency * 2, avgCostUsd: o.cost, totalCostUsd: o.cost * 10, avgToolCalls: o.calls, totalTokens: 1 },
  byCategory: {},
  hardGateFailures: 0,
});

const fail = (scenarioId: string, severity: "critical" | "high" | "medium", category = "safety_violation") => ({
  fingerprint: `${scenarioId}-${category}`,
  category: category as never,
  severity,
  title: `${category} in ${scenarioId}`,
  likelyCause: `cause for ${scenarioId}`,
  recommendation: `fix ${scenarioId}`,
  scenarioId,
  violatedInvariant: null,
});
const res = (id: string, status: "passed" | "failed", failures: ReturnType<typeof fail>[] = [], toolCalls = 3) => ({
  scenarioId: id,
  scenarioName: `Scenario ${id}`,
  category: "policy_conflict",
  status,
  toolCalls,
  firstDivergence: null,
  failures,
});

const baseline: RunSnapshot = {
  id: "run_a",
  agentVersion: "v1.0.0",
  metrics: metrics({ reliability: 0.86, safety: 0.991, recovery: 0.71, cost: 0.08, latency: 4100, calls: 3 }),
  results: [res("SCN-001", "passed"), res("SCN-002", "failed", [fail("SCN-002", "critical")]), res("SCN-003", "failed", [fail("SCN-003", "medium", "recovery_failure")]), res("SCN-004", "passed")],
};
const candidate: RunSnapshot = {
  id: "run_b",
  agentVersion: "v1.1.0",
  metrics: metrics({ reliability: 0.88, safety: 0.974, recovery: 0.83, cost: 0.052, latency: 3200, calls: 3.5 }),
  results: [
    res("SCN-001", "failed", [fail("SCN-001", "critical")], 4),
    res("SCN-002", "passed"),
    res("SCN-003", "failed", [fail("SCN-003", "high", "recovery_failure")]),
    res("SCN-004", "passed", [], 4),
    res("SCN-005", "passed"),
  ],
};

describe("regression engine", () => {
  const report = compareRuns(baseline, candidate);

  it("classifies scenario changes", () => {
    const by = Object.fromEntries(report.scenarios.map((s) => [s.scenarioId, s.change]));
    expect(by).toEqual({ "SCN-001": "new_failure", "SCN-002": "fixed", "SCN-003": "severity_change", "SCN-004": "unchanged_pass", "SCN-005": "new_scenario" });
    expect(report.summary).toMatchObject({ newFailures: 1, fixed: 1, severityChanges: 1 });
  });

  it("computes metric deltas with direction", () => {
    const m = Object.fromEntries(report.metrics.map((x) => [x.key, x]));
    expect(m.safety!.direction).toBe("regressed");
    expect(m.recovery!.direction).toBe("improved");
    expect(m.cost!.direction).toBe("improved");
    expect(m.cost!.relative).toBeCloseTo(-0.35, 2);
    expect(m.tool_calls!.direction).toBe("regressed");
    expect(report.summary.behavioralChanges.join(" ")).toMatch(/more tool calls/);
  });

  it("annotates regressions with the previous passing version", () => {
    const out = annotateRegressions([{ scenarioId: "SCN-001", regression: false, previousPassingVersion: null }, { scenarioId: "SCN-003", regression: false, previousPassingVersion: null }], report);
    expect(out[0]).toMatchObject({ regression: true, previousPassingVersion: "v1.0.0" });
    expect(out[1]!.regression).toBe(false);
  });
});

describe("release gates", () => {
  it("blocks on safety regression and critical failures, with an actionable report", () => {
    const report = compareRuns(baseline, candidate);
    const g = evaluateReleaseGate(DEFAULT_RELEASE_POLICY, candidate, report, baseline);
    expect(g.decision).toBe("BLOCKED");
    const failed = g.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["minimum_safety", "maximum_critical_failures", "block_on_regression_severity"]));
    expect(g.checks.find((c) => c.id === "minimum_safety")!.actual).toBe("99.1% → 97.4%");
    expect(g.report).toContain("DEPLOYMENT\nBLOCKED");
    expect(g.report).toContain("SCN-001");
    expect(g.report).toContain("v1.0.0 → PASS");
    expect(g.report).toMatch(/Performance improved, but safety regressed/);
  });

  it("passes when every check holds", () => {
    const g = evaluateReleaseGate({ minimum_correctness: 0.5, maximum_cost_increase: 0.2 }, candidate, compareRuns(baseline, candidate), baseline);
    expect(g.decision).toBe("PASS");
    expect(g.report).toContain("APPROVED");
  });
});
