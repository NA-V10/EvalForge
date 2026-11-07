import { and, desc, eq, inArray } from "drizzle-orm";
import { AgentSpec, AgentVersionSpec, newId, renderInvariant, ScenarioSpec, type AgentVersionSpecInput, type Invariant, type ToolDefinition } from "@rel/core";
import {
  agents,
  agentVersions,
  invariants as invariantsTable,
  projects,
  scenarioMutations,
  scenarioSetMembers,
  scenarioSets,
  scenarios,
  scenarioVersions,
  tools as toolsTable,
  toolVersions,
} from "@rel/database";
import { validateScenario } from "@rel/scenario-engine";
import type { Platform } from "./context";

export class NotFoundError extends Error {
  status = 404;
}
export class ValidationError extends Error {
  status = 400;
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

// ───────────────────────────── projects ─────────────────────────────

export async function ensureProject(p: Platform, slug = "default", name = "Default project") {
  const existing = (await p.db.select().from(projects).where(eq(projects.slug, slug)))[0];
  if (existing) return existing;
  const row = { id: newId("prj"), slug, name, redactionRules: [] };
  await p.db.insert(projects).values(row);
  return (await p.db.select().from(projects).where(eq(projects.id, row.id)))[0]!;
}

export async function getProject(p: Platform, projectId: string) {
  const row = (await p.db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!row) throw new NotFoundError("project not found");
  return row;
}

// ───────────────────────────── tools & invariants (library sync) ─────────────────────────────

export async function syncLibraries(p: Platform, projectId: string) {
  for (const t of p.tools.values()) await upsertTool(p, projectId, t);
  for (const inv of p.invariants.values()) await upsertInvariant(p, projectId, inv);
}

export async function upsertTool(p: Platform, projectId: string, t: ToolDefinition) {
  let row = (await p.db.select().from(toolsTable).where(and(eq(toolsTable.projectId, projectId), eq(toolsTable.name, t.name))))[0];
  if (!row) {
    row = { id: newId("tool"), projectId, name: t.name, description: t.description, destructive: t.destructive, currentVersion: t.version, createdAt: new Date().toISOString() };
    await p.db.insert(toolsTable).values(row);
  } else {
    await p.db.update(toolsTable).set({ description: t.description, destructive: t.destructive, currentVersion: t.version }).where(eq(toolsTable.id, row.id));
  }
  const v = (await p.db.select().from(toolVersions).where(and(eq(toolVersions.toolId, row.id), eq(toolVersions.version, t.version))))[0];
  if (!v) await p.db.insert(toolVersions).values({ id: newId("tv"), toolId: row.id, version: t.version, definition: t as unknown as Record<string, unknown> });
}

export async function upsertInvariant(p: Platform, projectId: string, inv: Invariant) {
  const row = (await p.db.select().from(invariantsTable).where(and(eq(invariantsTable.projectId, projectId), eq(invariantsTable.code, inv.id))))[0];
  const values = { name: inv.name, description: inv.description, severity: inv.severity, kind: inv.kind, spec: inv as unknown as Record<string, unknown> };
  if (row) await p.db.update(invariantsTable).set(values).where(eq(invariantsTable.id, row.id));
  else await p.db.insert(invariantsTable).values({ id: newId("inv"), projectId, code: inv.id, ...values });
}

export async function listTools(p: Platform, projectId: string) {
  const rows = await p.db.select().from(toolsTable).where(eq(toolsTable.projectId, projectId));
  return rows.map((r) => ({ ...r, definition: p.tools.get(r.name) ?? null }));
}

export async function listInvariants(p: Platform, projectId: string) {
  return (await p.db.select().from(invariantsTable).where(eq(invariantsTable.projectId, projectId))).map((r) => {
    const inv = r.spec as unknown as Invariant;
    return { ...inv, rule: renderInvariant(inv), global: p.globalInvariants.includes(inv.id) };
  });
}

// ───────────────────────────── agents ─────────────────────────────

export async function createAgent(p: Platform, projectId: string, input: unknown) {
  const spec = AgentSpec.parse(input);
  const id = newId("agt");
  await p.db.insert(agents).values({ id, projectId, slug: spec.slug, name: spec.name, description: spec.description, tools: spec.tools });
  return getAgent(p, projectId, id);
}

export async function listAgents(p: Platform, projectId: string) {
  const rows = await p.db.select().from(agents).where(eq(agents.projectId, projectId));
  const versions = rows.length ? await p.db.select().from(agentVersions).where(inArray(agentVersions.agentId, rows.map((r) => r.id))) : [];
  return rows.map((a) => ({ ...a, versions: versions.filter((v) => v.agentId === a.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt)) }));
}

export async function getAgent(p: Platform, projectId: string, idOrSlug: string) {
  const all = await listAgents(p, projectId);
  const a = all.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!a) throw new NotFoundError(`agent ${idOrSlug} not found`);
  return a;
}

export async function createAgentVersion(p: Platform, projectId: string, agentIdOrSlug: string, input: AgentVersionSpecInput) {
  const agent = await getAgent(p, projectId, agentIdOrSlug);
  const spec = AgentVersionSpec.parse(input);
  if (agent.versions.some((v) => v.version === spec.version)) throw new ValidationError(`version ${spec.version} already exists`);
  const id = newId("ver");
  await p.db.insert(agentVersions).values({
    id,
    agentId: agent.id,
    version: spec.version,
    model: spec.model,
    modelParams: spec.modelParams,
    systemPromptVersion: spec.systemPromptVersion,
    systemPrompt: spec.systemPrompt,
    toolVersion: spec.toolVersion,
    adapter: spec.adapter,
    config: spec.config,
    changelog: spec.changelog,
  });
  return (await p.db.select().from(agentVersions).where(eq(agentVersions.id, id)))[0]!;
}

export async function resolveAgentVersion(p: Platform, projectId: string, agent: string, version?: string) {
  const a = await getAgent(p, projectId, agent);
  const v = version ? a.versions.find((x) => x.version === version || x.id === version || x.version === `v${version}`) : a.versions.at(-1);
  if (!v) throw new NotFoundError(`agent ${agent} has no version ${version ?? "(any)"}`);
  return { agent: a, version: v };
}

// ───────────────────────────── scenarios ─────────────────────────────

export async function createScenario(p: Platform, projectId: string, input: unknown) {
  const report = validateScenario(input, p.tools, p.invariants);
  if (!report.valid || !report.spec) throw new ValidationError("scenario is invalid", report.errors);
  const s = report.spec;
  const existing = (await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, s.id))))[0];
  if (existing) throw new ValidationError(`scenario ${s.id} already exists — update it to create a new version`);
  const id = newId("scn");
  await p.db.insert(scenarios).values({
    id,
    projectId,
    code: s.id,
    name: s.name,
    domain: s.domain,
    category: s.category,
    severity: s.severity,
    parentCode: s.mutation?.parentId ?? null,
    mutationStrategy: s.mutation?.strategy ?? null,
    tags: s.tags,
  });
  await p.db.insert(scenarioVersions).values({ id: newId("sv"), scenarioId: id, version: 1, spec: s as unknown as Record<string, unknown> });
  return { id, code: s.id, version: 1, warnings: report.warnings };
}

/** Updating a scenario never mutates history: it appends an immutable version. */
export async function updateScenario(p: Platform, projectId: string, code: string, input: unknown) {
  const row = (await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, code))))[0];
  if (!row) throw new NotFoundError(`scenario ${code} not found`);
  const report = validateScenario({ ...(input as object), id: code }, p.tools, p.invariants);
  if (!report.valid || !report.spec) throw new ValidationError("scenario is invalid", report.errors);
  const version = row.currentVersion + 1;
  const s = report.spec;
  await p.db.insert(scenarioVersions).values({ id: newId("sv"), scenarioId: row.id, version, spec: s as unknown as Record<string, unknown> });
  await p.db
    .update(scenarios)
    .set({ currentVersion: version, name: s.name, domain: s.domain, category: s.category, severity: s.severity, tags: s.tags, updatedAt: new Date().toISOString() })
    .where(eq(scenarios.id, row.id));
  return { code, version, warnings: report.warnings };
}

export async function listScenarioRows(p: Platform, projectId: string, opts: { includeMutations?: boolean } = {}) {
  const rows = await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.archived, false))).orderBy(scenarios.code);
  return opts.includeMutations ? rows : rows.filter((r) => !r.parentCode);
}

/** Load current specs for a set of scenario codes (or all base scenarios). */
export async function loadSpecs(p: Platform, projectId: string, codes?: string[]): Promise<{ spec: ScenarioSpec; version: number; rowId: string }[]> {
  let rows = await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.archived, false)));
  if (codes) rows = rows.filter((r) => codes.includes(r.code));
  if (rows.length === 0) return [];
  const versions = await p.db.select().from(scenarioVersions).where(inArray(scenarioVersions.scenarioId, rows.map((r) => r.id)));
  return rows
    .map((r) => {
      const v = versions.find((x) => x.scenarioId === r.id && x.version === r.currentVersion)!;
      return { spec: ScenarioSpec.parse(v.spec), version: r.currentVersion, rowId: r.id };
    })
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}

export async function getScenario(p: Platform, projectId: string, code: string) {
  const row = (await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, code))))[0];
  if (!row) throw new NotFoundError(`scenario ${code} not found`);
  const versions = await p.db.select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, row.id)).orderBy(desc(scenarioVersions.version));
  const spec = ScenarioSpec.parse(versions[0]!.spec);
  const mutations = await p.db.select().from(scenarioMutations).where(eq(scenarioMutations.parentScenarioId, row.id));
  const childRows = mutations.length ? await p.db.select().from(scenarios).where(inArray(scenarios.id, mutations.map((m) => m.childScenarioId))) : [];
  const invariants = [...spec.invariantRefs.map((r) => p.invariants.get(r)).filter(Boolean), ...spec.invariants] as Invariant[];
  return {
    ...row,
    spec,
    versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt })),
    invariants: invariants.map((i) => ({ ...i, rule: renderInvariant(i) })),
    globalInvariants: (p.globalInvariants.map((g) => p.invariants.get(g)).filter(Boolean) as Invariant[]).map((i) => ({ ...i, rule: renderInvariant(i) })),
    mutations: mutations.map((m) => ({ ...m, childCode: childRows.find((c) => c.id === m.childScenarioId)?.code })),
  };
}

// ───────────────────────────── scenario sets ─────────────────────────────

export async function upsertScenarioSet(p: Platform, projectId: string, input: { slug: string; name: string; description?: string; kind?: "suite" | "regression"; codes: string[] }) {
  let set = (await p.db.select().from(scenarioSets).where(and(eq(scenarioSets.projectId, projectId), eq(scenarioSets.slug, input.slug))))[0];
  if (!set) {
    const id = newId("set");
    await p.db.insert(scenarioSets).values({ id, projectId, slug: input.slug, name: input.name, description: input.description ?? "", kind: input.kind ?? "suite" });
    set = (await p.db.select().from(scenarioSets).where(eq(scenarioSets.id, id)))[0]!;
  }
  const rows = await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), inArray(scenarios.code, input.codes.length ? input.codes : ["__none__"])));
  await p.db.delete(scenarioSetMembers).where(eq(scenarioSetMembers.setId, set.id));
  if (rows.length) await p.db.insert(scenarioSetMembers).values(rows.map((r) => ({ setId: set!.id, scenarioId: r.id })));
  return { ...set, size: rows.length };
}

export async function listScenarioSets(p: Platform, projectId: string) {
  const sets = await p.db.select().from(scenarioSets).where(eq(scenarioSets.projectId, projectId));
  const members = sets.length ? await p.db.select().from(scenarioSetMembers).where(inArray(scenarioSetMembers.setId, sets.map((s) => s.id))) : [];
  const rows = members.length ? await p.db.select({ id: scenarios.id, code: scenarios.code }).from(scenarios).where(inArray(scenarios.id, members.map((m) => m.scenarioId))) : [];
  return sets.map((s) => ({ ...s, codes: members.filter((m) => m.setId === s.id).map((m) => rows.find((r) => r.id === m.scenarioId)?.code).filter(Boolean) as string[] }));
}

export async function setCodes(p: Platform, projectId: string, slugOrId: string): Promise<{ id: string; codes: string[] }> {
  const s = (await listScenarioSets(p, projectId)).find((x) => x.slug === slugOrId || x.id === slugOrId);
  if (!s) throw new NotFoundError(`scenario set ${slugOrId} not found`);
  return { id: s.id, codes: s.codes };
}

export async function recordMutation(p: Platform, projectId: string, parentCode: string, childCode: string, strategy: string, description: string) {
  const [parent] = await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, parentCode)));
  const [child] = await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, childCode)));
  if (!parent || !child) throw new NotFoundError("scenario not found");
  await p.db.insert(scenarioMutations).values({ id: newId("mut"), parentScenarioId: parent.id, childScenarioId: child.id, strategy, description });
}
