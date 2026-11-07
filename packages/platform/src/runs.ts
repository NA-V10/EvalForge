import os from "node:os";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  EVALUATOR_VERSION,
  PLATFORM_VERSION,
  newId,
  type Failure,
  type RunConfigSnapshot,
  type RunMetrics,
  type RunMode,
  type ScenarioResult,
  type Trace,
  type AgentVersionSpec,
} from "@rel/core";
import {
  assertions as assertionsTable,
  evaluationResults,
  evaluationRuns,
  failureEvidence,
  failures as failuresTable,
  metrics as metricsTable,
  regressions,
  traces as tracesTable,
  traceSteps,
} from "@rel/database";
import { MODEL_PRICING, adapterFactoryFor } from "@rel/agents";
import { compareRuns, countFailures, runSuite, type RunSnapshot } from "@rel/evaluation-engine";
import { getProject, loadSpecs, resolveAgentVersion, setCodes, ValidationError } from "./catalog";
import type { Platform } from "./context";

export interface StartRunInput {
  agent: string;
  version?: string;
  mode?: RunMode;
  scenarios?: string[];
  scenarioSet?: string;
  baselineRunId?: string;
  label?: string;
  seed?: number;
}

/** Resolve which scenarios a run covers. */
async function selectScenarios(p: Platform, projectId: string, agentId: string, input: StartRunInput) {
  const mode = input.mode ?? (input.scenarios?.length ? "selected" : "all");
  let codes: string[] | undefined;
  let setId: string | null = null;
  if (input.scenarioSet) {
    const s = await setCodes(p, projectId, input.scenarioSet);
    codes = s.codes;
    setId = s.id;
  }
  const all = await loadSpecs(p, projectId, codes);
  switch (mode) {
    case "selected":
      if (!input.scenarios?.length) throw new ValidationError("mode=selected requires scenarios");
      return { mode, setId, specs: all.filter((s) => input.scenarios!.includes(s.spec.id)) };
    case "mutations":
      return { mode, setId, specs: all.filter((s) => s.spec.mutation && (!input.scenarios?.length || input.scenarios.includes(s.spec.mutation.parentId))) };
    case "failed": {
      const last = (
        await p.db
          .select()
          .from(evaluationRuns)
          .where(and(eq(evaluationRuns.projectId, projectId), eq(evaluationRuns.agentId, agentId), eq(evaluationRuns.status, "completed")))
          .orderBy(desc(evaluationRuns.createdAt))
          .limit(1)
      )[0];
      if (!last) throw new ValidationError("no completed run to take failed scenarios from");
      const failed = await p.db.select({ code: evaluationResults.scenarioCode }).from(evaluationResults).where(and(eq(evaluationResults.runId, last.id), ne(evaluationResults.status, "passed")));
      const set = new Set(failed.map((f) => f.code));
      return { mode, setId, specs: all.filter((s) => set.has(s.spec.id)) };
    }
    case "regression_suite": {
      if (!input.scenarioSet) {
        const s = await setCodes(p, projectId, "production-regression");
        return { mode, setId: s.id, specs: all.filter((x) => s.codes.includes(x.spec.id)) };
      }
      return { mode, setId, specs: all };
    }
    default:
      return { mode, setId, specs: all.filter((s) => !s.spec.mutation) };
  }
}

export async function startRun(p: Platform, projectId: string, input: StartRunInput) {
  const { agent, version } = await resolveAgentVersion(p, projectId, input.agent, input.version);
  const sel = await selectScenarios(p, projectId, agent.id, input);
  if (sel.specs.length === 0) throw new ValidationError("no scenarios matched this run");
  const id = newId("run");
  await p.db.insert(evaluationRuns).values({
    id,
    projectId,
    agentId: agent.id,
    agentVersionId: version.id,
    agentVersion: version.version,
    scenarioSetId: sel.setId,
    mode: sel.mode,
    label: input.label ?? null,
    evaluatorVersion: EVALUATOR_VERSION,
    status: "queued",
    progressTotal: sel.specs.length,
    totalScenarios: sel.specs.length,
    baselineRunId: input.baselineRunId ?? null,
  });
  await p.queue.enqueue("evaluation-run", { runId: id, projectId, codes: sel.specs.map((s) => s.spec.id), seed: input.seed ?? 20260101 });
  p.log.info("run queued", { runId: id, agent: agent.slug, version: version.version, scenarios: sel.specs.length, mode: sel.mode });
  return { id, total: sel.specs.length, status: "queued" as const };
}

/** Queue worker: execute, evaluate and persist a run. */
export async function executeRun(p: Platform, payload: { runId: string; projectId: string; codes: string[]; seed: number }) {
  const { runId, projectId, seed } = payload;
  const run = (await p.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)))[0]!;
  const log = p.log.child({ runId });
  const project = await getProject(p, projectId);
  const { redact } = p.redactorFor(project.redactionRules);
  const { agent, version } = await resolveAgentVersion(p, projectId, run.agentId, run.agentVersionId);
  const specs = await loadSpecs(p, projectId, payload.codes);
  const versionSpec = version as unknown as AgentVersionSpec;
  const factory = adapterFactoryFor(agent.slug, { ...versionSpec, modelParams: version.modelParams, config: version.config } as AgentVersionSpec);
  const config: RunConfigSnapshot = {
    agentVersion: version.version,
    model: factory.model,
    modelParams: version.modelParams,
    systemPromptVersion: version.systemPromptVersion,
    toolVersions: Object.fromEntries([...p.tools.values()].map((t) => [t.name, t.version])),
    evaluatorVersion: EVALUATOR_VERSION,
    judge: `${p.provider.id}:${p.provider.model}`,
    scenarioVersions: Object.fromEntries(specs.map((s) => [s.spec.id, s.version])),
    seed,
    environment: { platformVersion: PLATFORM_VERSION, node: process.version, os: `${os.platform()}-${os.arch()}` },
  };
  await p.db.update(evaluationRuns).set({ status: "running", startedAt: new Date().toISOString(), config: config as unknown as Record<string, unknown> }).where(eq(evaluationRuns.id, runId));
  p.telemetry.inc("runs_started");
  log.info("run started", { scenarios: specs.length, agentVersion: version.version });

  try {
    const { results, metrics } = await runSuite({
      runId,
      agentVersion: version.version,
      specs: specs.map(({ spec, version: v }) => ({ spec, version: v })),
      tools: p.tools,
      adapter: { ...factory, pricing: { ...MODEL_PRICING, ...factory.pricing } },
      evaluator: { provider: p.provider, invariantLibrary: p.invariants, globalInvariants: p.globalInvariants, redact },
      seed,
      concurrency: 4,
      onResult: async (result, trace, prog) => {
        const started = Date.now();
        await persistResult(p, projectId, result, trace, redact);
        for (const j of result.judgments) p.telemetry.observeEvaluator(j.latencyMs, j.costUsd, j.judge === "error");
        p.telemetry.inc("scenarios_executed");
        if (result.status === "error") p.telemetry.inc("scenario_execution_failures");
        p.telemetry.observeScenario(trace.totals.latencyMs + (Date.now() - started));
        await p.db.update(evaluationRuns).set({ progressCompleted: prog.completed }).where(eq(evaluationRuns.id, runId));
        p.events.emit("run", { runId, type: "progress", completed: prog.completed, total: prog.total, scenarioId: result.scenarioId, status: result.status });
      },
    });
    await finalizeRun(p, projectId, runId, results, metrics);
    p.telemetry.inc("runs_completed");
    log.info("run completed", { passed: results.filter((r) => r.status === "passed").length, total: results.length, reliability: metrics.reliability });
    p.events.emit("run", { runId, type: "completed", completed: results.length, total: results.length });
  } catch (err) {
    const cause = err instanceof Error && err.cause ? ` (cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)})` : "";
    // Drizzle appends full query params to messages; keep the statement, drop the (possibly sensitive) params.
    const base = err instanceof Error ? err.message.split("\nparams:")[0]! : String(err);
    const message = `${base}${cause}`.slice(0, 2000);
    await p.db.update(evaluationRuns).set({ status: "failed", error: message, completedAt: new Date().toISOString() }).where(eq(evaluationRuns.id, runId));
    p.telemetry.inc("runs_failed");
    log.error("run failed", { error: message });
    p.events.emit("run", { runId, type: "failed", completed: 0, total: specs.length });
  }
}

async function persistResult(p: Platform, projectId: string, r: ScenarioResult, trace: Trace, redact: (v: unknown) => unknown) {
  const db = p.db;
  await db.insert(evaluationResults).values({
    id: r.id,
    runId: r.runId,
    scenarioCode: r.scenarioId,
    scenarioVersion: r.scenarioVersion,
    scenarioName: r.scenarioName,
    category: r.category,
    severity: r.severity,
    parentScenarioCode: r.parentScenarioId,
    mutationStrategy: r.mutationStrategy,
    status: r.status,
    outcomePassed: r.outcomePassed,
    trajectoryPassed: r.trajectoryPassed,
    hardGateFailed: r.hardGateFailed,
    scores: r.scores as Record<string, number | null>,
    operational: r.operational as unknown as Record<string, number>,
    firstDivergence: r.firstDivergence as unknown as Record<string, unknown> | null,
    expectedTrajectory: r.expectedTrajectory,
    actualTrajectory: r.actualTrajectory as unknown as Record<string, unknown>[],
    judgments: redact(r.judgments) as Record<string, unknown>[],
    traceId: trace.id,
    latencyMs: r.operational.latencyMs,
    costUsd: r.operational.costUsd,
  });
  await db.insert(tracesTable).values({
    id: trace.id,
    runId: trace.runId,
    resultId: r.id,
    scenarioCode: trace.scenarioId,
    agentVersion: trace.agentVersion,
    model: trace.model,
    seed: trace.seed,
    startedAt: trace.startedAt,
    totals: trace.totals as unknown as Record<string, number>,
    initialState: redact(trace.initialState) as Record<string, unknown>,
    finalState: redact(trace.finalState) as Record<string, unknown>,
    infrastructureError: trace.infrastructureError ?? null,
  });
  if (trace.steps.length)
    await db.insert(traceSteps).values(
      trace.steps.map((s) => ({
        traceId: trace.id,
        idx: s.index,
        type: s.type,
        tool: s.tool ?? null,
        status: s.status ?? null,
        offsetMs: s.offsetMs,
        durationMs: s.durationMs,
        payload: redact(s) as Record<string, unknown>,
      })),
    );
  if (r.assertions.length)
    await db.insert(assertionsTable).values(
      r.assertions.map((a) => ({
        id: newId("as"),
        runId: r.runId,
        resultId: r.id,
        assertionKey: a.id,
        layer: a.layer,
        kind: a.kind,
        name: a.name,
        dimension: a.dimension,
        passed: a.passed,
        score: a.score,
        severity: a.severity,
        hardGate: a.hardGate,
        invariantCode: a.invariantId ?? null,
        message: String(redact(a.message)),
        expected: a.expected ?? null,
        actual: a.actual ? String(redact(a.actual)) : null,
        evidence: redact(a.evidence) as Record<string, unknown>[],
      })),
    );
  for (const f of r.failures) await insertFailure(p, projectId, f, redact);
}

async function insertFailure(p: Platform, projectId: string, f: Failure, redact: (v: unknown) => unknown) {
  await p.db.insert(failuresTable).values({
    id: f.id,
    projectId,
    runId: f.runId,
    resultId: f.resultId ?? null,
    scenarioCode: f.scenarioId,
    agentVersion: f.agentVersion,
    fingerprint: f.fingerprint,
    title: f.title,
    category: f.category,
    subcategory: f.subcategory,
    severity: f.severity,
    firstDivergenceStep: f.firstDivergenceStep,
    firstDivergence: f.firstDivergence as unknown as Record<string, unknown> | null,
    expectedBehavior: String(redact(f.expectedBehavior)),
    actualBehavior: String(redact(f.actualBehavior)),
    violatedInvariant: f.violatedInvariant,
    likelyCause: String(redact(f.likelyCause)),
    recommendation: f.recommendation,
    assertionKeys: f.assertionIds,
  });
  if (f.evidence.length)
    await p.db.insert(failureEvidence).values(
      f.evidence.map((e) => ({ failureId: f.id, traceStep: e.traceStep ?? null, explanation: String(redact(e.explanation)), fact: (redact(e.fact ?? null) as { path: string; value: unknown } | null) ?? null })),
    );
}

async function finalizeRun(p: Platform, projectId: string, runId: string, results: ScenarioResult[], metrics: RunMetrics) {
  const counts = countFailures({ results });
  const run = (await p.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)))[0]!;

  // Baseline: explicit, else the latest completed run of a different version of the same agent.
  let baselineId = run.baselineRunId;
  if (!baselineId) {
    const prev = (
      await p.db
        .select()
        .from(evaluationRuns)
        .where(and(eq(evaluationRuns.agentId, run.agentId), eq(evaluationRuns.status, "completed"), ne(evaluationRuns.agentVersionId, run.agentVersionId), eq(evaluationRuns.mode, run.mode)))
        .orderBy(desc(evaluationRuns.completedAt))
        .limit(1)
    )[0];
    baselineId = prev?.id ?? null;
  }

  await p.db
    .update(evaluationRuns)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      errored: results.filter((r) => r.status === "error").length,
      criticalFailures: counts.critical,
      majorFailures: counts.major,
      minorFailures: counts.minor,
      metrics: metrics as unknown as Record<string, unknown>,
      baselineRunId: baselineId,
    })
    .where(eq(evaluationRuns.id, runId));
  await p.db.insert(metricsTable).values(
    Object.entries(metrics.dimensions).map(([dimension, value]) => ({
      runId,
      dimension,
      value: value ?? null,
      sampleSize: results.filter((r) => typeof r.scores[dimension as keyof typeof r.scores] === "number").length,
    })),
  );

  if (baselineId) {
    const report = compareRuns(await runSnapshot(p, baselineId), await runSnapshot(p, runId));
    await p.db.insert(regressions).values({
      id: newId("reg"),
      projectId,
      baselineRunId: baselineId,
      candidateRunId: runId,
      newFailures: report.summary.newFailures,
      fixed: report.summary.fixed,
      report: report as unknown as Record<string, unknown>,
    });
    const regressedCodes = report.scenarios.filter((s) => s.change === "new_failure").map((s) => s.scenarioId);
    if (regressedCodes.length)
      await p.db
        .update(failuresTable)
        .set({ regression: true, previousPassingVersion: report.baselineVersion })
        .where(and(eq(failuresTable.runId, runId), inArray(failuresTable.scenarioCode, regressedCodes)));
  }
}

/** Build the regression engine's view of a run from the database. */
export async function runSnapshot(p: Platform, runId: string): Promise<RunSnapshot> {
  const run = (await p.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)))[0];
  if (!run || run.status !== "completed") throw new ValidationError(`run ${runId} is not completed`);
  const results = await p.db.select().from(evaluationResults).where(eq(evaluationResults.runId, runId));
  const fails = await p.db.select().from(failuresTable).where(eq(failuresTable.runId, runId));
  return {
    id: run.id,
    agentVersion: run.agentVersion,
    metrics: run.metrics as unknown as RunMetrics,
    results: results.map((r) => ({
      scenarioId: r.scenarioCode,
      scenarioName: r.scenarioName,
      category: r.category,
      status: r.status as "passed" | "failed" | "error",
      toolCalls: Number(r.operational.toolCalls ?? 0),
      firstDivergence: r.firstDivergence as never,
      failures: fails
        .filter((f) => f.resultId === r.id)
        .map((f) => ({
          fingerprint: f.fingerprint,
          category: f.category as Failure["category"],
          severity: f.severity as Failure["severity"],
          title: f.title,
          likelyCause: f.likelyCause,
          recommendation: f.recommendation,
          scenarioId: f.scenarioCode,
          violatedInvariant: f.violatedInvariant,
        })),
    })),
  };
}
