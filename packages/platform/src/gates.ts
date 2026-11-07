import { and, desc, eq } from "drizzle-orm";
import { newId, ReleasePolicy, type ReleaseGateResult } from "@rel/core";
import { evaluationRuns, releaseGateResults, releaseGates } from "@rel/database";
import { compareRuns, DEFAULT_RELEASE_POLICY, evaluateReleaseGate } from "@rel/evaluation-engine";
import YAML from "yaml";
import { NotFoundError, getAgent, ValidationError } from "./catalog";
import type { Platform } from "./context";
import { getRunRow } from "./queries";
import { runSnapshot } from "./runs";

/** Accepts the YAML/JSON shape `{ release_policy: {...} }` or the bare policy object. */
export function parsePolicy(input: unknown): ReleasePolicy {
  const raw = typeof input === "string" ? YAML.parse(input) : input;
  const body = raw && typeof raw === "object" && "release_policy" in raw ? (raw as { release_policy: unknown }).release_policy : raw;
  const parsed = ReleasePolicy.safeParse(body);
  if (!parsed.success) throw new ValidationError("invalid release policy", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return parsed.data;
}

export async function listGates(p: Platform, projectId: string) {
  const gates = await p.db.select().from(releaseGates).where(eq(releaseGates.projectId, projectId));
  const results = await p.db.select().from(releaseGateResults).orderBy(desc(releaseGateResults.createdAt));
  return gates.map((g) => ({ ...g, latestResults: results.filter((r) => r.gateId === g.id).slice(0, 5) }));
}

export async function upsertGate(p: Platform, projectId: string, input: { id?: string; name: string; agent?: string; policy: unknown }) {
  const policy = parsePolicy(input.policy);
  const agentId = input.agent ? (await getAgent(p, projectId, input.agent)).id : null;
  if (input.id) {
    const row = (await p.db.select().from(releaseGates).where(and(eq(releaseGates.projectId, projectId), eq(releaseGates.id, input.id))))[0];
    if (!row) throw new NotFoundError("gate not found");
    await p.db.update(releaseGates).set({ name: input.name, policy, agentId, updatedAt: new Date().toISOString() }).where(eq(releaseGates.id, input.id));
    return { ...row, name: input.name, policy };
  }
  const id = newId("gate");
  await p.db.insert(releaseGates).values({ id, projectId, agentId, name: input.name, policy });
  return (await p.db.select().from(releaseGates).where(eq(releaseGates.id, id)))[0]!;
}

export async function ensureDefaultGate(p: Platform, projectId: string, agent?: string) {
  const existing = (await p.db.select().from(releaseGates).where(eq(releaseGates.projectId, projectId)))[0];
  return existing ?? upsertGate(p, projectId, { name: "Production release policy", agent, policy: DEFAULT_RELEASE_POLICY });
}

/** Evaluate a gate against a run. Baseline defaults to the run's recorded baseline. Result is persisted. */
export async function evaluateGate(p: Platform, projectId: string, input: { gateId?: string; runId: string; baselineRunId?: string; policy?: unknown }): Promise<ReleaseGateResult> {
  const run = await getRunRow(p, projectId, input.runId);
  if (run.status !== "completed") throw new ValidationError(`run ${run.id} is ${run.status}`);
  const gate = input.gateId
    ? (await p.db.select().from(releaseGates).where(and(eq(releaseGates.projectId, projectId), eq(releaseGates.id, input.gateId))))[0]
    : await ensureDefaultGate(p, projectId);
  if (!gate) throw new NotFoundError("gate not found");
  const policy = input.policy ? parsePolicy(input.policy) : parsePolicy(gate.policy);
  const baselineId = input.baselineRunId ?? run.baselineRunId;
  const baselineRun = baselineId ? (await p.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, baselineId)))[0] : undefined;
  const candidate = await runSnapshot(p, run.id);
  const baseline = baselineRun?.status === "completed" ? await runSnapshot(p, baselineRun.id) : null;
  const comparison = baseline ? compareRuns(baseline, candidate) : null;
  const g = evaluateReleaseGate(policy, candidate, comparison, baseline);
  const row = {
    id: newId("gres"),
    gateId: gate.id,
    runId: run.id,
    baselineRunId: baseline?.id ?? null,
    decision: g.decision,
    checks: g.checks as unknown as Record<string, unknown>[],
    reasons: g.reasons,
    report: g.report,
  };
  await p.db.insert(releaseGateResults).values(row);
  p.log.info("release gate evaluated", { runId: run.id, gate: gate.name, decision: g.decision });
  return { ...row, checks: g.checks, createdAt: new Date().toISOString() };
}
