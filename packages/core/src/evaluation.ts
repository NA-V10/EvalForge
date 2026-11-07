import { z } from "zod";
import { Severity } from "./primitives";

export const METRIC_DIMENSIONS = [
  "correctness",
  "tool_correctness",
  "tool_arguments",
  "tool_efficiency",
  "trajectory",
  "policy",
  "safety",
  "grounding",
  "state_consistency",
  "recovery",
  "robustness",
  "handoff",
  "response_quality",
] as const;
export const MetricDimension = z.enum(METRIC_DIMENSIONS);
export type MetricDimension = z.infer<typeof MetricDimension>;
export type DimensionScores = Partial<Record<MetricDimension, number | null>>;

export const EVAL_LAYERS = ["deterministic", "semantic", "behavioral"] as const;
export const EvalLayer = z.enum(EVAL_LAYERS);
export type EvalLayer = z.infer<typeof EvalLayer>;

export const Evidence = z.object({
  traceStep: z.number().int().optional(),
  explanation: z.string(),
  fact: z.object({ path: z.string(), value: z.unknown() }).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const AssertionResult = z.object({
  id: z.string(),
  layer: EvalLayer,
  kind: z.string(),
  name: z.string(),
  dimension: MetricDimension,
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  severity: Severity,
  message: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  evidence: z.array(Evidence).default([]),
  invariantId: z.string().optional(),
  /** Hard gates fail the scenario regardless of any other score. */
  hardGate: z.boolean().default(false),
});
export type AssertionResult = z.infer<typeof AssertionResult>;

/** Structured judge output. A bare PASS/FAIL is never accepted. */
export const JudgeVerdict = z.object({
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  evidence: z.array(z.object({ trace_step: z.number().int(), explanation: z.string() })),
  confidence: z.number().min(0).max(1),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const JudgeResult = JudgeVerdict.extend({
  criterionId: z.string(),
  criterionName: z.string(),
  dimension: MetricDimension,
  judge: z.string(),
  threshold: z.number(),
  blocking: z.boolean(),
  passed: z.boolean(),
  latencyMs: z.number(),
  costUsd: z.number(),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

export const ActualAction = z.object({
  action: z.string(),
  traceStep: z.number().int(),
  status: z.enum(["ok", "error"]).optional(),
  destructive: z.boolean().default(false),
});
export type ActualAction = z.infer<typeof ActualAction>;

export const FirstDivergence = z.object({
  /** 1-based position in the actual trajectory (or expected length+1 if a step is missing at the end). */
  position: z.number().int().positive(),
  traceStep: z.number().int().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  kind: z.enum(["unexpected_action", "missing_action", "forbidden_action", "wrong_order", "wrong_arguments"]),
  severity: Severity,
  reason: z.string(),
});
export type FirstDivergence = z.infer<typeof FirstDivergence>;

export const FAILURE_CATEGORIES = [
  "outcome_failure",
  "tool_selection_failure",
  "tool_argument_failure",
  "tool_ordering_failure",
  "policy_violation",
  "safety_violation",
  "grounding_failure",
  "hallucination",
  "state_inconsistency",
  "recovery_failure",
  "escalation_failure",
  "efficiency_failure",
  "timeout",
  "infrastructure_failure",
] as const;
export const FailureCategory = z.enum(FAILURE_CATEGORIES);

/** Tie-breaker within a severity: what an engineer should look at first. */
export const FAILURE_PRIORITY: Record<(typeof FAILURE_CATEGORIES)[number], number> = {
  safety_violation: 0,
  policy_violation: 1,
  hallucination: 2,
  escalation_failure: 3,
  recovery_failure: 4,
  timeout: 5,
  state_inconsistency: 6,
  grounding_failure: 7,
  tool_ordering_failure: 8,
  tool_selection_failure: 9,
  tool_argument_failure: 10,
  outcome_failure: 11,
  efficiency_failure: 12,
  infrastructure_failure: 13,
};
export type FailureCategory = z.infer<typeof FailureCategory>;

export const Failure = z.object({
  id: z.string(),
  fingerprint: z.string(),
  scenarioId: z.string(),
  runId: z.string(),
  resultId: z.string().optional(),
  agentVersion: z.string(),
  title: z.string(),
  category: FailureCategory,
  subcategory: z.string(),
  severity: Severity,
  firstDivergenceStep: z.number().int().nullable(),
  firstDivergence: FirstDivergence.nullable(),
  expectedBehavior: z.string(),
  actualBehavior: z.string(),
  violatedInvariant: z
    .object({ id: z.string(), name: z.string(), description: z.string() })
    .nullable(),
  evidence: z.array(Evidence),
  likelyCause: z.string(),
  recommendation: z.string(),
  assertionIds: z.array(z.string()),
  regression: z.boolean().default(false),
  previousPassingVersion: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Failure = z.infer<typeof Failure>;

export const OperationalMetrics = z.object({
  latencyMs: z.number(),
  timeToFirstResponseMs: z.number(),
  toolLatencyMs: z.number(),
  costUsd: z.number(),
  inputCostUsd: z.number(),
  outputCostUsd: z.number(),
  toolCostUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  toolCalls: z.number(),
  steps: z.number(),
});
export type OperationalMetrics = z.infer<typeof OperationalMetrics>;

export type ScenarioStatus = "passed" | "failed" | "error";

export interface ScenarioResult {
  id: string;
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioName: string;
  category: string;
  severity: Severity;
  parentScenarioId: string | null;
  mutationStrategy: string | null;
  status: ScenarioStatus;
  outcomePassed: boolean;
  trajectoryPassed: boolean;
  hardGateFailed: boolean;
  scores: DimensionScores;
  operational: OperationalMetrics;
  assertions: AssertionResult[];
  judgments: JudgeResult[];
  firstDivergence: FirstDivergence | null;
  expectedTrajectory: string[];
  actualTrajectory: ActualAction[];
  failures: Failure[];
  traceId: string;
  evaluatorVersion: string;
}

export const RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_MODES = ["all", "selected", "failed", "regression_suite", "mutations"] as const;
export const RunMode = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof RunMode>;

/** Everything needed to reproduce a run. */
export interface RunConfigSnapshot {
  agentVersion: string;
  model: string;
  modelParams: Record<string, unknown>;
  systemPromptVersion: string;
  toolVersions: Record<string, string>;
  evaluatorVersion: string;
  judge: string;
  scenarioVersions: Record<string, number>;
  seed: number;
  environment: { platformVersion: string; node: string; os: string };
}

export interface RunMetrics {
  /** Composite score — display only, never the source of truth. */
  reliability: number;
  dimensions: DimensionScores;
  passRate: number;
  operational: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgCostUsd: number;
    totalCostUsd: number;
    avgToolCalls: number;
    totalTokens: number;
  };
  byCategory: Record<string, { total: number; passed: number }>;
  hardGateFailures: number;
}

export interface EvaluationRun {
  id: string;
  projectId: string;
  agentId: string;
  agentVersionId: string;
  agentVersion: string;
  scenarioSetId: string | null;
  mode: RunMode;
  label: string | null;
  evaluatorVersion: string;
  status: RunStatus;
  progress: { completed: number; total: number };
  totalScenarios: number;
  passed: number;
  failed: number;
  errored: number;
  criticalFailures: number;
  majorFailures: number;
  minorFailures: number;
  metrics: RunMetrics | null;
  config: RunConfigSnapshot | null;
  baselineRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
}
