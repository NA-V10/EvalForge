import type {
  ActualAction,
  FirstDivergence,
  GateCheck,
  Invariant,
  JudgeResult,
  RegressionReport,
  RunMetrics,
  ScenarioSpec,
  Severity,
} from "@rel/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/** In development the Vite proxy injects the dev key; in production a key can be stored in Settings. */
export function storedKey(): string | null {
  try {
    return localStorage.getItem("rel.apiKey");
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = storedKey();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.details ?? []);
  return data as T;
}
export const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });

// ───────────────────────────── response types ─────────────────────────────

export interface AgentVersionRow {
  id: string;
  version: string;
  model: string;
  adapter: string;
  systemPromptVersion: string;
  toolVersion: string;
  changelog: string;
  config: Record<string, unknown>;
  createdAt: string;
}
export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  tools: string[];
  versions: AgentVersionRow[];
}

export interface RunRow {
  id: string;
  agentId: string;
  agentVersion: string;
  mode: string;
  label: string | null;
  status: "queued" | "running" | "completed" | "failed";
  progress: { completed: number; total: number };
  totalScenarios: number;
  passed: number;
  failed: number;
  errored: number;
  criticalFailures: number;
  majorFailures: number;
  minorFailures: number;
  metrics: RunMetrics | null;
  config: Record<string, unknown> | null;
  baselineRunId: string | null;
  evaluatorVersion: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
}

export interface RunResultRow {
  id: string;
  scenarioId: string;
  scenarioName: string;
  category: string;
  severity: Severity;
  parentScenarioId: string | null;
  mutationStrategy: string | null;
  status: "passed" | "failed" | "error";
  outcomePassed: boolean;
  trajectoryPassed: boolean;
  hardGateFailed: boolean;
  scores: Record<string, number | null>;
  firstDivergence: FirstDivergence | null;
  latencyMs: number;
  costUsd: number;
  toolCalls: number;
  traceId: string;
  failureCount: number;
  worstSeverity: Severity | null;
  regression: boolean;
}
export interface RunDetail extends RunRow {
  results: RunResultRow[];
  regression: { id: string; baselineRunId: string; newFailures: number; fixed: number } | null;
}

export interface FailureRow {
  id: string;
  runId: string;
  resultId: string | null;
  scenarioCode: string;
  agentVersion: string;
  fingerprint: string;
  title: string;
  category: string;
  subcategory: string;
  severity: Severity;
  firstDivergenceStep: number | null;
  firstDivergence: FirstDivergence | null;
  expectedBehavior: string;
  actualBehavior: string;
  violatedInvariant: { id: string; name: string; description: string } | null;
  likelyCause: string;
  recommendation: string;
  regression: boolean;
  previousPassingVersion: string | null;
  createdAt: string;
}
export interface FailureDetail extends FailureRow {
  evidence: { id: number; traceStep: number | null; explanation: string; fact: { path: string; value: unknown } | null }[];
  result: { id: string; traceId: string; expectedTrajectory: string[]; actualTrajectory: ActualAction[]; scores: Record<string, number | null> } | null;
  run: { id: string; agentVersion: string; createdAt: string };
  history: { runId: string; version: string; status: string; completedAt: string | null }[];
  scenario: { id: string; name: string; severity: Severity; category: string; description: string; expected: string } | null;
}

export interface TraceStepView {
  index: number;
  type: string;
  timestamp: string;
  offsetMs: number;
  durationMs: number;
  content?: string;
  tool?: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: "ok" | "error";
  error?: { code: string; message: string };
  retry?: number;
  model?: string;
  tokens?: { prompt: number; completion: number };
  costUsd?: number;
  stateDiff?: { path: string; before: unknown; after: unknown }[];
  acts?: string[];
  assertions: { key: string; name: string; passed: boolean; severity: Severity; invariantCode: string | null; message: string }[];
}
export interface AssertionRow {
  id: string;
  assertionKey: string;
  layer: string;
  kind: string;
  name: string;
  dimension: string;
  passed: boolean;
  score: number;
  severity: Severity;
  hardGate: boolean;
  invariantCode: string | null;
  message: string;
  expected: string | null;
  actual: string | null;
  evidence: { traceStep?: number; explanation: string }[];
}
export interface TraceDetail {
  id: string;
  runId: string;
  scenarioCode: string;
  agentVersion: string;
  model: string;
  seed: number;
  totals: Record<string, number>;
  initialState: Record<string, unknown>;
  finalState: Record<string, unknown>;
  infrastructureError: string | null;
  scenario: { id: string; name: string; severity: Severity; category: string } | null;
  result: {
    id: string;
    status: string;
    firstDivergence: FirstDivergence | null;
    expectedTrajectory: string[];
    actualTrajectory: ActualAction[];
    scores: Record<string, number | null>;
    judgments: JudgeResult[];
  } | null;
  steps: TraceStepView[];
  assertions: AssertionRow[];
  failures: FailureRow[];
}

export interface ScenarioIndexRow {
  code: string;
  name: string;
  domain: string;
  category: string;
  severity: Severity;
  version: number;
  tags: string[];
  parentCode: string | null;
  mutationStrategy: string | null;
  description: string;
  tools: number;
  invariants: number;
  latest: { status: string; resultId: string; traceId: string; firstDivergence: FirstDivergence | null } | null;
}
export interface ScenarioDetailView {
  id: string;
  code: string;
  name: string;
  severity: Severity;
  category: string;
  domain: string;
  currentVersion: number;
  spec: ScenarioSpec;
  versions: { version: number; createdAt: string }[];
  invariants: Invariant[];
  globalInvariants: Invariant[];
  mutations: { id: string; strategy: string; description: string; childCode?: string }[];
}

export interface Overview {
  agents: { id: string; slug: string; name: string; versions: { id: string; version: string; model: string }[] }[];
  scenarios: { base: number; mutations: number };
  latestRun: RunRow | null;
  criticalFailures: number;
  regressions: number;
  topFailures: FailureRow[];
  regression: { baselineRunId: string; newFailures: number; fixed: number } | null;
  trend: { runId: string; version: string; reliability: number | null; safety: number | null; passRate: number | null; at: string | null }[];
  recentRuns: RunRow[];
}

export interface GateRow {
  id: string;
  name: string;
  agentId: string | null;
  policy: Record<string, unknown>;
  latestResults: { id: string; runId: string; decision: string; createdAt: string }[];
}
export interface GateResult {
  id: string;
  runId: string;
  baselineRunId: string | null;
  decision: "PASS" | "BLOCKED";
  checks: GateCheck[];
  reasons: string[];
  report: string;
}

export interface CompareResponse {
  baselineRun: RunRow;
  candidateRun: RunRow;
  report: RegressionReport;
}

export type { RegressionReport, Severity, Invariant, ScenarioSpec, FirstDivergence, ActualAction };
