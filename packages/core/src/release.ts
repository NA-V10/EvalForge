import { z } from "zod";
import type { DimensionScores, MetricDimension } from "./evaluation";
import type { Severity } from "./primitives";

export const ReleasePolicy = z.object({
  minimum_reliability: z.number().min(0).max(1).optional(),
  minimum_correctness: z.number().min(0).max(1).optional(),
  minimum_safety: z.number().min(0).max(1).optional(),
  minimum_policy: z.number().min(0).max(1).optional(),
  minimum_trajectory: z.number().min(0).max(1).optional(),
  minimum_recovery: z.number().min(0).max(1).optional(),
  maximum_critical_failures: z.number().int().nonnegative().optional(),
  maximum_major_failures: z.number().int().nonnegative().optional(),
  /** Relative increase allowed vs baseline, e.g. 0.2 = +20%. */
  maximum_cost_increase: z.number().optional(),
  maximum_latency_increase: z.number().optional(),
  /** Max number of scenarios that went PASS → FAIL. */
  maximum_regressions: z.number().int().nonnegative().optional(),
  /** Any regression at or above this severity blocks. */
  block_on_regression_severity: z.enum(["critical", "high", "medium", "low"]).optional(),
});
export type ReleasePolicy = z.infer<typeof ReleasePolicy>;

export interface ScenarioDelta {
  scenarioId: string;
  scenarioName: string;
  category: string;
  baselineStatus: "passed" | "failed" | "error" | "absent";
  candidateStatus: "passed" | "failed" | "error" | "absent";
  baselineSeverity: Severity | null;
  candidateSeverity: Severity | null;
  change: "new_failure" | "fixed" | "unchanged_failure" | "unchanged_pass" | "severity_change" | "new_scenario";
  newFailureCategories: string[];
  fixedFailureCategories: string[];
  toolCallDelta: number;
  firstDivergence: { expected: string | null; actual: string | null; position: number } | null;
}

export interface MetricDelta {
  key: MetricDimension | "reliability" | "latency" | "cost" | "tool_calls" | "pass_rate";
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  /** Relative change, e.g. -0.23 = 23% lower. */
  relative: number | null;
  direction: "improved" | "regressed" | "unchanged";
  higherIsBetter: boolean;
}

export interface RegressionReport {
  baselineRunId: string;
  candidateRunId: string;
  baselineVersion: string;
  candidateVersion: string;
  scenarios: ScenarioDelta[];
  metrics: MetricDelta[];
  summary: {
    newFailures: number;
    fixed: number;
    unchangedFailures: number;
    severityChanges: number;
    improvedScenarios: number;
    metricRegressions: number;
    behavioralChanges: string[];
  };
  baselineDimensions: DimensionScores;
  candidateDimensions: DimensionScores;
}

export interface GateCheck {
  id: string;
  label: string;
  threshold: string;
  actual: string;
  passed: boolean;
  detail?: string;
}

export interface ReleaseGateResult {
  id: string;
  gateId: string;
  runId: string;
  baselineRunId: string | null;
  decision: "PASS" | "BLOCKED";
  checks: GateCheck[];
  reasons: string[];
  report: string;
  createdAt: string;
}
