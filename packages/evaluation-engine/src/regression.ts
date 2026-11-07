import {
  METRIC_DIMENSIONS,
  SEVERITY_RANK,
  maxSeverity,
  round,
  type Failure,
  type FirstDivergence,
  type MetricDelta,
  type RegressionReport,
  type RunMetrics,
  type ScenarioDelta,
  type Severity,
} from "@rel/core";

/** The minimal view of a run the regression engine needs (works from memory or the database). */
export interface RunSnapshot {
  id: string;
  agentVersion: string;
  metrics: RunMetrics;
  results: {
    scenarioId: string;
    scenarioName: string;
    category: string;
    status: "passed" | "failed" | "error";
    toolCalls: number;
    firstDivergence: FirstDivergence | null;
    failures: Pick<Failure, "fingerprint" | "category" | "severity" | "title" | "likelyCause" | "recommendation" | "scenarioId" | "violatedInvariant">[];
  }[];
}

const failSeverity = (fs: { severity: Severity }[]) => maxSeverity(fs.filter((f) => f.severity !== "low").map((f) => f.severity));

function delta(
  key: MetricDelta["key"],
  baseline: number | null | undefined,
  candidate: number | null | undefined,
  higherIsBetter: boolean,
  tolerance: { abs?: number; rel?: number },
): MetricDelta {
  const b = baseline ?? null;
  const c = candidate ?? null;
  if (b === null || c === null) return { key, baseline: b, candidate: c, delta: null, relative: null, direction: "unchanged", higherIsBetter };
  const d = c - b;
  const rel = b === 0 ? null : d / Math.abs(b);
  const significant = tolerance.rel !== undefined ? Math.abs(rel ?? 0) >= tolerance.rel : Math.abs(d) >= (tolerance.abs ?? 0.005);
  const better = higherIsBetter ? d > 0 : d < 0;
  return {
    key,
    baseline: round(b),
    candidate: round(c),
    delta: round(d),
    relative: rel === null ? null : round(rel),
    direction: !significant ? "unchanged" : better ? "improved" : "regressed",
    higherIsBetter,
  };
}

/** Compare a candidate run against a baseline run, scenario by scenario and metric by metric. */
export function compareRuns(baseline: RunSnapshot, candidate: RunSnapshot): RegressionReport {
  const base = new Map(baseline.results.map((r) => [r.scenarioId, r]));
  const scenarios: ScenarioDelta[] = [];

  for (const c of candidate.results) {
    const b = base.get(c.scenarioId);
    const bSev = b ? failSeverity(b.failures) : null;
    const cSev = failSeverity(c.failures);
    const bFail = b ? b.status !== "passed" : false;
    const cFail = c.status !== "passed";
    let change: ScenarioDelta["change"];
    if (!b) change = "new_scenario";
    else if (!bFail && cFail) change = "new_failure";
    else if (bFail && !cFail) change = "fixed";
    else if (bFail && cFail) change = bSev !== cSev ? "severity_change" : "unchanged_failure";
    else change = "unchanged_pass";
    const bCats = new Set((b?.failures ?? []).map((f) => f.category));
    const cCats = new Set(c.failures.map((f) => f.category));
    scenarios.push({
      scenarioId: c.scenarioId,
      scenarioName: c.scenarioName,
      category: c.category,
      baselineStatus: b?.status ?? "absent",
      candidateStatus: c.status,
      baselineSeverity: bSev,
      candidateSeverity: cSev,
      change,
      newFailureCategories: [...cCats].filter((x) => !bCats.has(x)),
      fixedFailureCategories: [...bCats].filter((x) => !cCats.has(x)),
      toolCallDelta: b ? c.toolCalls - b.toolCalls : 0,
      firstDivergence: c.firstDivergence ? { expected: c.firstDivergence.expected, actual: c.firstDivergence.actual, position: c.firstDivergence.position } : null,
    });
  }

  const bm = baseline.metrics;
  const cm = candidate.metrics;
  const metrics: MetricDelta[] = [
    delta("reliability", bm.reliability, cm.reliability, true, { abs: 0.005 }),
    delta("pass_rate", bm.passRate, cm.passRate, true, { abs: 0.005 }),
    ...METRIC_DIMENSIONS.map((d) => delta(d, bm.dimensions[d], cm.dimensions[d], true, { abs: 0.005 })),
    delta("latency", bm.operational.avgLatencyMs, cm.operational.avgLatencyMs, false, { rel: 0.02 }),
    delta("cost", bm.operational.avgCostUsd, cm.operational.avgCostUsd, false, { rel: 0.02 }),
    delta("tool_calls", bm.operational.avgToolCalls, cm.operational.avgToolCalls, false, { rel: 0.03 }),
  ];

  const behavioralChanges: string[] = [];
  const tc = metrics.find((m) => m.key === "tool_calls")!;
  if (tc.direction !== "unchanged" && tc.relative !== null)
    behavioralChanges.push(`Agent now makes ${Math.abs(Math.round(tc.relative * 100))}% ${tc.relative > 0 ? "more" : "fewer"} tool calls per scenario (${tc.baseline} → ${tc.candidate}).`);
  const moreCalls = scenarios.filter((s) => s.toolCallDelta > 0).length;
  if (moreCalls > 0) behavioralChanges.push(`${moreCalls} scenario(s) use more tool calls than before.`);
  const escalationLost = scenarios.filter((s) => s.newFailureCategories.includes("escalation_failure")).length;
  if (escalationLost > 0) behavioralChanges.push(`Escalation behavior regressed in ${escalationLost} scenario(s).`);

  return {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    baselineVersion: baseline.agentVersion,
    candidateVersion: candidate.agentVersion,
    scenarios,
    metrics,
    summary: {
      newFailures: scenarios.filter((s) => s.change === "new_failure").length,
      fixed: scenarios.filter((s) => s.change === "fixed").length,
      unchangedFailures: scenarios.filter((s) => s.change === "unchanged_failure").length,
      severityChanges: scenarios.filter((s) => s.change === "severity_change").length,
      improvedScenarios: scenarios.filter(
        (s) => s.change === "fixed" || (s.change === "severity_change" && s.baselineSeverity && s.candidateSeverity && SEVERITY_RANK[s.candidateSeverity] < SEVERITY_RANK[s.baselineSeverity]),
      ).length,
      metricRegressions: metrics.filter((m) => m.direction === "regressed").length,
      behavioralChanges,
    },
    baselineDimensions: bm.dimensions,
    candidateDimensions: cm.dimensions,
  };
}

/** Mark candidate failures that are regressions (scenario passed in the baseline). */
export function annotateRegressions<F extends Pick<Failure, "scenarioId" | "regression" | "previousPassingVersion">>(
  failures: F[],
  report: RegressionReport,
): F[] {
  const regressed = new Set(report.scenarios.filter((s) => s.change === "new_failure").map((s) => s.scenarioId));
  return failures.map((f) => (regressed.has(f.scenarioId) ? { ...f, regression: true, previousPassingVersion: report.baselineVersion } : f));
}
