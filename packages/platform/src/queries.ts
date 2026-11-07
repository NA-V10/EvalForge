import { and, desc, eq, inArray } from "drizzle-orm";
import { FAILURE_CATEGORIES, FAILURE_PRIORITY, MUTATION_STRATEGIES, SCENARIO_CATEGORIES, SEVERITY_RANK, type FailureCategory, type RunMetrics, type Severity } from "@rel/core";
import {
  agents,
  agentVersions,
  assertions as assertionsTable,
  evaluationResults,
  evaluationRuns,
  failureEvidence,
  failures as failuresTable,
  regressions,
  scenarios,
  traces,
  traceSteps,
} from "@rel/database";
import { compareRuns } from "@rel/evaluation-engine";
import { NotFoundError, getAgent, getScenario, listScenarioRows, loadSpecs } from "./catalog";
import type { Platform } from "./context";
import { runSnapshot } from "./runs";

type RunRow = typeof evaluationRuns.$inferSelect;
const runDto = (r: RunRow) => ({
  ...r,
  progress: { completed: r.progressCompleted, total: r.progressTotal },
  metrics: r.metrics as unknown as RunMetrics | null,
});

export async function listRuns(p: Platform, projectId: string, opts: { agent?: string; limit?: number } = {}) {
  let where = eq(evaluationRuns.projectId, projectId);
  if (opts.agent) {
    const a = await getAgent(p, projectId, opts.agent);
    where = and(where, eq(evaluationRuns.agentId, a.id))!;
  }
  const rows = await p.db.select().from(evaluationRuns).where(where).orderBy(desc(evaluationRuns.createdAt)).limit(opts.limit ?? 50);
  return rows.map(runDto);
}

export async function getRunRow(p: Platform, projectId: string, runId: string) {
  const r = (await p.db.select().from(evaluationRuns).where(and(eq(evaluationRuns.projectId, projectId), eq(evaluationRuns.id, runId))))[0];
  if (!r) throw new NotFoundError(`run ${runId} not found`);
  return r;
}

export async function latestCompletedRun(p: Platform, projectId: string, opts: { agentVersionId?: string; agentId?: string; mode?: string } = {}) {
  const conds = [eq(evaluationRuns.projectId, projectId), eq(evaluationRuns.status, "completed")];
  if (opts.agentVersionId) conds.push(eq(evaluationRuns.agentVersionId, opts.agentVersionId));
  if (opts.agentId) conds.push(eq(evaluationRuns.agentId, opts.agentId));
  if (opts.mode) conds.push(eq(evaluationRuns.mode, opts.mode));
  return (await p.db.select().from(evaluationRuns).where(and(...conds)).orderBy(desc(evaluationRuns.completedAt)).limit(1))[0] ?? null;
}

export async function getRun(p: Platform, projectId: string, runId: string) {
  const run = await getRunRow(p, projectId, runId);
  const results = await p.db.select().from(evaluationResults).where(eq(evaluationResults.runId, runId)).orderBy(evaluationResults.scenarioCode);
  const fails = await p.db.select().from(failuresTable).where(eq(failuresTable.runId, runId));
  const regression = (await p.db.select().from(regressions).where(eq(regressions.candidateRunId, runId)))[0];
  return {
    ...runDto(run),
    results: results.map((r) => {
      const fs = fails.filter((f) => f.resultId === r.id);
      const worst = fs.reduce<Severity | null>((acc, f) => (acc && SEVERITY_RANK[acc] >= SEVERITY_RANK[f.severity as Severity] ? acc : (f.severity as Severity)), null);
      return {
        id: r.id,
        scenarioId: r.scenarioCode,
        scenarioName: r.scenarioName,
        category: r.category,
        severity: r.severity,
        parentScenarioId: r.parentScenarioCode,
        mutationStrategy: r.mutationStrategy,
        status: r.status,
        outcomePassed: r.outcomePassed,
        trajectoryPassed: r.trajectoryPassed,
        hardGateFailed: r.hardGateFailed,
        scores: r.scores,
        firstDivergence: r.firstDivergence,
        latencyMs: r.latencyMs,
        costUsd: r.costUsd,
        toolCalls: r.operational.toolCalls,
        traceId: r.traceId,
        failureCount: fs.length,
        worstSeverity: worst,
        regression: fs.some((f) => f.regression),
      };
    }),
    regression: regression ? { id: regression.id, baselineRunId: regression.baselineRunId, newFailures: regression.newFailures, fixed: regression.fixed } : null,
  };
}

export async function getResult(p: Platform, projectId: string, resultId: string) {
  const r = (await p.db.select().from(evaluationResults).where(eq(evaluationResults.id, resultId)))[0];
  if (!r) throw new NotFoundError("result not found");
  await getRunRow(p, projectId, r.runId);
  const as = await p.db.select().from(assertionsTable).where(eq(assertionsTable.resultId, resultId));
  const fs = await p.db.select().from(failuresTable).where(eq(failuresTable.resultId, resultId));
  return { ...r, assertions: as, failures: fs };
}

export async function getTrace(p: Platform, projectId: string, traceId: string) {
  const t = (await p.db.select().from(traces).where(eq(traces.id, traceId)))[0];
  if (!t) throw new NotFoundError("trace not found");
  const run = await getRunRow(p, projectId, t.runId);
  const steps = await p.db.select().from(traceSteps).where(eq(traceSteps.traceId, traceId)).orderBy(traceSteps.idx);
  const result = t.resultId ? (await p.db.select().from(evaluationResults).where(eq(evaluationResults.id, t.resultId)))[0] : undefined;
  const as = t.resultId ? await p.db.select().from(assertionsTable).where(eq(assertionsTable.resultId, t.resultId)) : [];
  const fs = t.resultId ? await p.db.select().from(failuresTable).where(eq(failuresTable.resultId, t.resultId)) : [];
  const spec = await loadSpecs(p, projectId, [t.scenarioCode]);
  return {
    ...t,
    agentVersion: run.agentVersion,
    runStatus: run.status,
    scenario: spec[0] ? { id: spec[0].spec.id, name: spec[0].spec.name, severity: spec[0].spec.severity, category: spec[0].spec.category } : null,
    result: result
      ? { id: result.id, status: result.status, firstDivergence: result.firstDivergence, expectedTrajectory: result.expectedTrajectory, actualTrajectory: result.actualTrajectory, scores: result.scores, judgments: result.judgments }
      : null,
    steps: steps.map((s) => {
      const related = as.filter((a) => (a.evidence as { traceStep?: number }[]).some((e) => e.traceStep === s.idx));
      return { ...(s.payload as Record<string, unknown>), index: s.idx, assertions: related.map((a) => ({ key: a.assertionKey, name: a.name, passed: a.passed, severity: a.severity, invariantCode: a.invariantCode, message: a.message })) };
    }),
    assertions: as,
    failures: fs,
  };
}

export async function listFailures(
  p: Platform,
  projectId: string,
  f: { runId?: string; severity?: string; regression?: boolean; category?: string; scenario?: string; agentVersion?: string; limit?: number } = {},
) {
  const conds = [eq(failuresTable.projectId, projectId)];
  if (f.runId) conds.push(eq(failuresTable.runId, f.runId));
  if (f.severity) conds.push(eq(failuresTable.severity, f.severity));
  if (f.regression !== undefined) conds.push(eq(failuresTable.regression, f.regression));
  if (f.category) conds.push(eq(failuresTable.category, f.category));
  if (f.scenario) conds.push(eq(failuresTable.scenarioCode, f.scenario));
  if (f.agentVersion) conds.push(eq(failuresTable.agentVersion, f.agentVersion));
  const rows = await p.db.select().from(failuresTable).where(and(...conds)).orderBy(desc(failuresTable.createdAt)).limit(f.limit ?? 500);
  return rows.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity as Severity] - SEVERITY_RANK[a.severity as Severity] ||
      a.scenarioCode.localeCompare(b.scenarioCode) ||
      FAILURE_PRIORITY[a.category as FailureCategory] - FAILURE_PRIORITY[b.category as FailureCategory],
  );
}

export async function getFailure(p: Platform, projectId: string, id: string) {
  const f = (await p.db.select().from(failuresTable).where(and(eq(failuresTable.projectId, projectId), eq(failuresTable.id, id))))[0];
  if (!f) throw new NotFoundError("failure not found");
  const evidence = await p.db.select().from(failureEvidence).where(eq(failureEvidence.failureId, id));
  const result = f.resultId ? (await p.db.select().from(evaluationResults).where(eq(evaluationResults.id, f.resultId)))[0] : undefined;
  const run = await getRunRow(p, projectId, f.runId);
  // Version history for this scenario on this agent: status per completed run (latest run per version).
  const history = await p.db
    .select({ runId: evaluationRuns.id, version: evaluationRuns.agentVersion, status: evaluationResults.status, completedAt: evaluationRuns.completedAt })
    .from(evaluationResults)
    .innerJoin(evaluationRuns, eq(evaluationRuns.id, evaluationResults.runId))
    .where(and(eq(evaluationRuns.agentId, run.agentId), eq(evaluationRuns.status, "completed"), eq(evaluationResults.scenarioCode, f.scenarioCode)))
    .orderBy(desc(evaluationRuns.completedAt));
  const byVersion = new Map<string, (typeof history)[number]>();
  for (const h of history) if (!byVersion.has(h.version)) byVersion.set(h.version, h);
  const scenario = await getScenario(p, projectId, f.scenarioCode).catch(() => null);
  return {
    ...f,
    evidence,
    result: result ? { id: result.id, traceId: result.traceId, expectedTrajectory: result.expectedTrajectory, actualTrajectory: result.actualTrajectory, scores: result.scores } : null,
    run: { id: run.id, agentVersion: run.agentVersion, createdAt: run.createdAt },
    history: [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })),
    scenario: scenario ? { id: scenario.code, name: scenario.name, severity: scenario.severity, category: scenario.category, description: scenario.spec.description, expected: scenario.spec.expectedOutcome.summary } : null,
  };
}

export async function compare(p: Platform, projectId: string, baselineRunId: string, candidateRunId: string) {
  await getRunRow(p, projectId, baselineRunId);
  await getRunRow(p, projectId, candidateRunId);
  return compareRuns(await runSnapshot(p, baselineRunId), await runSnapshot(p, candidateRunId));
}

/** Compare the latest completed runs of two versions of an agent. */
export async function compareVersions(p: Platform, projectId: string, agent: string, a: string, b: string) {
  const ag = await getAgent(p, projectId, agent);
  const va = ag.versions.find((v) => v.version === a);
  const vb = ag.versions.find((v) => v.version === b);
  if (!va || !vb) throw new NotFoundError("version not found");
  const ra = await latestCompletedRun(p, projectId, { agentVersionId: va.id, mode: "all" });
  const rb = await latestCompletedRun(p, projectId, { agentVersionId: vb.id, mode: "all" });
  if (!ra || !rb) throw new NotFoundError("both versions need a completed full run");
  return { baselineRun: runDto(ra), candidateRun: runDto(rb), report: await compare(p, projectId, ra.id, rb.id) };
}

export async function coverage(p: Platform, projectId: string) {
  const rows = await listScenarioRows(p, projectId, { includeMutations: true });
  const specs = await loadSpecs(p, projectId);
  const base = specs.filter((s) => !s.spec.mutation);
  const latest = await latestCompletedRun(p, projectId, { mode: "all" });
  const results = latest ? await p.db.select().from(evaluationResults).where(eq(evaluationResults.runId, latest.id)) : [];
  const as = latest ? await p.db.select().from(assertionsTable).where(and(eq(assertionsTable.runId, latest.id), eq(assertionsTable.kind, "invariant"))) : [];
  const fs = latest ? await p.db.select().from(failuresTable).where(eq(failuresTable.runId, latest.id)) : [];
  const stepRows = latest
    ? await p.db
        .select({ tool: traceSteps.tool })
        .from(traceSteps)
        .innerJoin(traces, eq(traces.id, traceSteps.traceId))
        .where(and(eq(traces.runId, latest.id), eq(traceSteps.type, "tool_call")))
    : [];
  const exercised = new Set(stepRows.map((s) => s.tool));

  return {
    runId: latest?.id ?? null,
    agentVersion: latest?.agentVersion ?? null,
    categories: SCENARIO_CATEGORIES.map((c) => {
      const inCat = base.filter((s) => s.spec.category === c);
      const res = results.filter((r) => r.category === c && !r.parentScenarioCode);
      return { category: c, scenarios: inCat.length, evaluated: res.length, passed: res.filter((r) => r.status === "passed").length };
    }),
    tools: [...p.tools.values()].map((t) => ({
      name: t.name,
      destructive: t.destructive,
      inScenarios: base.filter((s) => s.spec.availableTools.includes(t.name)).length,
      forbiddenIn: base.filter((s) => s.spec.forbiddenActions.includes(t.name)).length,
      faultInjected: base.filter((s) => s.spec.toolFaults.some((f) => f.tool === t.name)).length,
      exercised: exercised.has(t.name),
    })),
    invariants: [...p.invariants.values()].map((i) => {
      const evals = as.filter((a) => a.invariantCode === i.id);
      return {
        id: i.id,
        name: i.name,
        severity: i.severity,
        global: p.globalInvariants.includes(i.id),
        referencedBy: base.filter((s) => s.spec.invariantRefs.includes(i.id)).length,
        evaluated: evals.length,
        violated: evals.filter((a) => !a.passed).length,
      };
    }),
    failureModes: FAILURE_CATEGORIES.map((c) => ({ category: c, observed: fs.filter((f) => f.category === c).length })),
    mutations: MUTATION_STRATEGIES.map((m) => ({ strategy: m, scenarios: rows.filter((r) => r.mutationStrategy === m).length })),
    domains: [...new Set(base.map((s) => s.spec.domain))].map((d) => ({ domain: d, scenarios: base.filter((s) => s.spec.domain === d).length })),
  };
}

export async function overview(p: Platform, projectId: string) {
  const agentRows = await p.db.select().from(agents).where(eq(agents.projectId, projectId));
  const versions = agentRows.length ? await p.db.select().from(agentVersions).where(inArray(agentVersions.agentId, agentRows.map((a) => a.id))) : [];
  const runs = await listRuns(p, projectId, { limit: 20 });
  const scenarioCount = (await p.db.select({ id: scenarios.id, parent: scenarios.parentCode }).from(scenarios).where(eq(scenarios.projectId, projectId)));
  const latest = await latestCompletedRun(p, projectId, { mode: "all" });
  const latestFailures = latest ? await p.db.select().from(failuresTable).where(eq(failuresTable.runId, latest.id)) : [];
  const reg = latest ? (await p.db.select().from(regressions).where(eq(regressions.candidateRunId, latest.id)))[0] : undefined;
  const completedFull = runs.filter((r) => r.status === "completed" && r.mode === "all").reverse();
  return {
    agents: agentRows.map((a) => ({ ...a, versions: versions.filter((v) => v.agentId === a.id).map((v) => ({ id: v.id, version: v.version, model: v.model })) })),
    scenarios: { base: scenarioCount.filter((s) => !s.parent).length, mutations: scenarioCount.filter((s) => s.parent).length },
    latestRun: latest ? runDto(latest) : null,
    // Counted per scenario, consistent with run counts and release gates.
    criticalFailures: new Set(latestFailures.filter((f) => f.severity === "critical").map((f) => f.scenarioCode)).size,
    regressions: new Set(latestFailures.filter((f) => f.regression).map((f) => f.scenarioCode)).size,
    topFailures: latestFailures
      .filter((f) => f.severity !== "low")
      .sort((a, b) => SEVERITY_RANK[b.severity as Severity] - SEVERITY_RANK[a.severity as Severity] || FAILURE_PRIORITY[a.category as FailureCategory] - FAILURE_PRIORITY[b.category as FailureCategory])
      .filter((f, i, all) => all.findIndex((x) => x.scenarioCode === f.scenarioCode) === i)
      .slice(0, 6),
    regression: reg ? { baselineRunId: reg.baselineRunId, newFailures: reg.newFailures, fixed: reg.fixed } : null,
    trend: completedFull.map((r) => ({ runId: r.id, version: r.agentVersion, reliability: r.metrics?.reliability ?? null, safety: r.metrics?.dimensions.safety ?? null, passRate: r.metrics?.passRate ?? null, at: r.completedAt })),
    recentRuns: runs.slice(0, 8),
  };
}

/** Scenario library with the latest result of each scenario (from the latest completed full run). */
export async function scenarioIndex(p: Platform, projectId: string, opts: { includeMutations?: boolean } = {}) {
  const rows = await listScenarioRows(p, projectId, opts);
  const specs = new Map((await loadSpecs(p, projectId)).map((s) => [s.spec.id, s.spec]));
  const latestAll = await latestCompletedRun(p, projectId, { mode: "all" });
  const latestMut = opts.includeMutations ? await latestCompletedRun(p, projectId, { mode: "mutations" }) : null;
  const runIds = [latestAll?.id, latestMut?.id].filter(Boolean) as string[];
  const results = runIds.length ? await p.db.select().from(evaluationResults).where(inArray(evaluationResults.runId, runIds)) : [];
  return {
    runId: latestAll?.id ?? null,
    agentVersion: latestAll?.agentVersion ?? null,
    scenarios: rows.map((r) => {
      const s = specs.get(r.code);
      const res = results.find((x) => x.scenarioCode === r.code);
      return {
        code: r.code,
        name: r.name,
        domain: r.domain,
        category: r.category,
        severity: r.severity,
        version: r.currentVersion,
        tags: r.tags,
        parentCode: r.parentCode,
        mutationStrategy: r.mutationStrategy,
        description: s?.description ?? "",
        tools: s?.availableTools.length ?? 0,
        invariants: (s?.invariantRefs.length ?? 0) + (s?.invariants.length ?? 0),
        latest: res ? { status: res.status, resultId: res.id, traceId: res.traceId, firstDivergence: res.firstDivergence } : null,
        updatedAt: r.updatedAt,
      };
    }),
  };
}
