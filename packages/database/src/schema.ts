import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const created = () => ts("created_at").notNull().defaultNow();

// ───────────────────────────── Tenancy & security ─────────────────────────────

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Redaction rules applied to traces before they are stored/displayed. */
  redactionRules: jsonb("redaction_rules").$type<{ name: string; pattern: string; replacement: string }[]>().notNull().default([]),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: created(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<"owner" | "admin" | "engineer" | "viewer">(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  name: text("name").notNull(),
  /** First chars shown in UI; the full key is never stored. */
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  role: text("role").notNull().$type<"admin" | "engineer" | "viewer">().default("engineer"),
  createdAt: created(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

/** Encrypted provider credentials (AES-256-GCM). */
export const secrets = pgTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("secrets_project_name").on(t.projectId, t.name)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
  },
  (t) => [index("audit_project_created").on(t.projectId, t.createdAt)],
);

// ───────────────────────────── Agents & tools ─────────────────────────────

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    createdAt: created(),
  },
  (t) => [uniqueIndex("agents_project_slug").on(t.projectId, t.slug)],
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    model: text("model").notNull(),
    modelParams: jsonb("model_params").$type<Record<string, unknown>>().notNull().default({}),
    systemPromptVersion: text("system_prompt_version").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    toolVersion: text("tool_version").notNull(),
    adapter: text("adapter").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    changelog: text("changelog").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("agent_versions_agent_version").on(t.agentId, t.version)],
);

export const tools = pgTable(
  "tools",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    destructive: boolean("destructive").notNull().default(false),
    currentVersion: text("current_version").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("tools_project_name").on(t.projectId, t.name)],
);

export const toolVersions = pgTable(
  "tool_versions",
  {
    id: text("id").primaryKey(),
    toolId: text("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("tool_versions_tool_version").on(t.toolId, t.version)],
);

// ───────────────────────────── Scenarios & invariants ─────────────────────────────

export const invariants = pgTable(
  "invariants",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    severity: text("severity").notNull(),
    kind: text("kind").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("invariants_project_code").on(t.projectId, t.code)],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    parentCode: text("parent_code"),
    mutationStrategy: text("mutation_strategy"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    archived: boolean("archived").notNull().default(false),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scenarios_project_code").on(t.projectId, t.code), index("scenarios_category").on(t.category)],
);

export const scenarioVersions = pgTable(
  "scenario_versions",
  {
    id: text("id").primaryKey(),
    scenarioId: text("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Immutable, validated ScenarioSpec. */
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("scenario_versions_scenario_version").on(t.scenarioId, t.version)],
);

export const scenarioSets = pgTable(
  "scenario_sets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().$type<"suite" | "regression">().default("suite"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("scenario_sets_project_slug").on(t.projectId, t.slug)],
);

export const scenarioSetMembers = pgTable(
  "scenario_set_members",
  {
    setId: text("set_id").notNull().references(() => scenarioSets.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.setId, t.scenarioId] })],
);

export const scenarioMutations = pgTable("scenario_mutations", {
  id: text("id").primaryKey(),
  parentScenarioId: text("parent_scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  childScenarioId: text("child_scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  strategy: text("strategy").notNull(),
  description: text("description").notNull(),
  createdAt: created(),
});

// ───────────────────────────── Evaluation ─────────────────────────────

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull().references(() => agents.id),
    agentVersionId: text("agent_version_id").notNull().references(() => agentVersions.id),
    agentVersion: text("agent_version").notNull(),
    scenarioSetId: text("scenario_set_id").references(() => scenarioSets.id),
    mode: text("mode").notNull(),
    label: text("label"),
    evaluatorVersion: text("evaluator_version").notNull(),
    status: text("status").notNull(),
    progressCompleted: integer("progress_completed").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    totalScenarios: integer("total_scenarios").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    errored: integer("errored").notNull().default(0),
    criticalFailures: integer("critical_failures").notNull().default(0),
    majorFailures: integer("major_failures").notNull().default(0),
    minorFailures: integer("minor_failures").notNull().default(0),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    config: jsonb("config").$type<Record<string, unknown>>(),
    baselineRunId: text("baseline_run_id"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: created(),
    error: text("error"),
  },
  (t) => [index("runs_project_created").on(t.projectId, t.createdAt), index("runs_agent_version").on(t.agentVersionId)],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    scenarioCode: text("scenario_code").notNull(),
    scenarioVersion: integer("scenario_version").notNull(),
    scenarioName: text("scenario_name").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    parentScenarioCode: text("parent_scenario_code"),
    mutationStrategy: text("mutation_strategy"),
    status: text("status").notNull(),
    outcomePassed: boolean("outcome_passed").notNull(),
    trajectoryPassed: boolean("trajectory_passed").notNull(),
    hardGateFailed: boolean("hard_gate_failed").notNull(),
    scores: jsonb("scores").$type<Record<string, number | null>>().notNull(),
    operational: jsonb("operational").$type<Record<string, number>>().notNull(),
    firstDivergence: jsonb("first_divergence").$type<Record<string, unknown> | null>(),
    expectedTrajectory: jsonb("expected_trajectory").$type<string[]>().notNull(),
    actualTrajectory: jsonb("actual_trajectory").$type<Record<string, unknown>[]>().notNull(),
    judgments: jsonb("judgments").$type<Record<string, unknown>[]>().notNull().default([]),
    traceId: text("trace_id").notNull(),
    latencyMs: doublePrecision("latency_ms").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: created(),
  },
  (t) => [index("results_run").on(t.runId), index("results_scenario").on(t.scenarioCode)],
);

export const traces = pgTable(
  "traces",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    resultId: text("result_id"),
    scenarioCode: text("scenario_code").notNull(),
    agentVersion: text("agent_version").notNull(),
    model: text("model").notNull(),
    seed: integer("seed").notNull(),
    startedAt: ts("started_at").notNull(),
    totals: jsonb("totals").$type<Record<string, number>>().notNull(),
    initialState: jsonb("initial_state").$type<Record<string, unknown>>().notNull(),
    finalState: jsonb("final_state").$type<Record<string, unknown>>().notNull(),
    infrastructureError: text("infrastructure_error"),
  },
  (t) => [index("traces_run").on(t.runId)],
);

export const traceSteps = pgTable(
  "trace_steps",
  {
    id: serial("id").primaryKey(),
    traceId: text("trace_id").notNull().references(() => traces.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    type: text("type").notNull(),
    tool: text("tool"),
    status: text("status"),
    offsetMs: doublePrecision("offset_ms").notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    /** Full redacted step payload. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("trace_steps_trace").on(t.traceId, t.idx)],
);

export const assertions = pgTable(
  "assertions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    resultId: text("result_id").notNull().references(() => evaluationResults.id, { onDelete: "cascade" }),
    assertionKey: text("assertion_key").notNull(),
    layer: text("layer").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    dimension: text("dimension").notNull(),
    passed: boolean("passed").notNull(),
    score: doublePrecision("score").notNull(),
    severity: text("severity").notNull(),
    hardGate: boolean("hard_gate").notNull(),
    invariantCode: text("invariant_code"),
    message: text("message").notNull(),
    expected: text("expected"),
    actual: text("actual"),
    evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]),
  },
  (t) => [index("assertions_result").on(t.resultId)],
);

export const metrics = pgTable(
  "metrics",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    value: doublePrecision("value"),
    sampleSize: integer("sample_size").notNull(),
  },
  (t) => [index("metrics_run").on(t.runId)],
);

export const failures = pgTable(
  "failures",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    resultId: text("result_id").references(() => evaluationResults.id, { onDelete: "cascade" }),
    scenarioCode: text("scenario_code").notNull(),
    agentVersion: text("agent_version").notNull(),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    severity: text("severity").notNull(),
    firstDivergenceStep: integer("first_divergence_step"),
    firstDivergence: jsonb("first_divergence").$type<Record<string, unknown> | null>(),
    expectedBehavior: text("expected_behavior").notNull(),
    actualBehavior: text("actual_behavior").notNull(),
    violatedInvariant: jsonb("violated_invariant").$type<{ id: string; name: string; description: string } | null>(),
    likelyCause: text("likely_cause").notNull(),
    recommendation: text("recommendation").notNull(),
    assertionKeys: jsonb("assertion_keys").$type<string[]>().notNull().default([]),
    regression: boolean("regression").notNull().default(false),
    previousPassingVersion: text("previous_passing_version"),
    status: text("status").notNull().$type<"open" | "acknowledged" | "resolved">().default("open"),
    createdAt: created(),
  },
  (t) => [
    index("failures_run").on(t.runId),
    index("failures_project_severity").on(t.projectId, t.severity),
    index("failures_fingerprint").on(t.fingerprint),
  ],
);

export const failureEvidence = pgTable(
  "failure_evidence",
  {
    id: serial("id").primaryKey(),
    failureId: text("failure_id").notNull().references(() => failures.id, { onDelete: "cascade" }),
    traceStep: integer("trace_step"),
    explanation: text("explanation").notNull(),
    fact: jsonb("fact").$type<{ path: string; value: unknown } | null>(),
  },
  (t) => [index("failure_evidence_failure").on(t.failureId)],
);

export const regressions = pgTable("regressions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  baselineRunId: text("baseline_run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
  candidateRunId: text("candidate_run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
  newFailures: integer("new_failures").notNull(),
  fixed: integer("fixed").notNull(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  createdAt: created(),
});

export const releaseGates = pgTable("release_gates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const releaseGateResults = pgTable("release_gate_results", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => releaseGates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
  baselineRunId: text("baseline_run_id"),
  decision: text("decision").notNull(),
  checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull(),
  report: text("report").notNull(),
  createdAt: created(),
});
