import { Hono, type Context } from "hono";
import { z } from "zod";
import { AgentVersionSpec } from "@rel/core";
import { compileScenario, validateScenario } from "@rel/scenario-engine";
import {
  createAgent,
  createAgentVersion,
  createScenario,
  getAgent,
  getScenario,
  listAgents,
  listInvariants,
  listScenarioSets,
  listTools,
  scenarioIndex,
  updateScenario,
  upsertScenarioSet,
} from "@rel/platform";
import { audited, body, project, type Env } from "../http";

export const catalogRoutes = new Hono<Env>();

catalogRoutes.get("/agents", async (c) => c.json(await listAgents(c.get("platform"), project(c))));
catalogRoutes.post("/agents", async (c) => {
  const a = await createAgent(c.get("platform"), project(c), await c.req.json());
  await audited(c, "agent.create", "agent", a.id, { slug: a.slug });
  return c.json(a, 201);
});
catalogRoutes.get("/agents/:id", async (c) => c.json(await getAgent(c.get("platform"), project(c), c.req.param("id"))));
catalogRoutes.get("/agents/:id/versions", async (c) => c.json((await getAgent(c.get("platform"), project(c), c.req.param("id"))).versions));
catalogRoutes.post("/agents/:id/versions", async (c) => {
  const v = await createAgentVersion(c.get("platform"), project(c), c.req.param("id"), await body(c, AgentVersionSpec));
  await audited(c, "agent_version.create", "agent_version", v.id, { version: v.version });
  return c.json(v, 201);
});

catalogRoutes.get("/tools", async (c) => c.json(await listTools(c.get("platform"), project(c))));
catalogRoutes.get("/invariants", async (c) => c.json(await listInvariants(c.get("platform"), project(c))));

catalogRoutes.get("/scenarios", async (c) =>
  c.json(await scenarioIndex(c.get("platform"), project(c), { includeMutations: c.req.query("mutations") === "true" })),
);
catalogRoutes.post("/scenarios", async (c) => {
  const r = await createScenario(c.get("platform"), project(c), await c.req.json());
  await audited(c, "scenario.create", "scenario", r.code);
  return c.json(r, 201);
});
catalogRoutes.post("/scenarios/validate", async (c) => {
  const p = c.get("platform");
  return c.json(validateScenario(await c.req.json(), p.tools, p.invariants));
});
const CompileBody = z.object({ text: z.string().min(10), id: z.string().regex(/^SCN-[A-Z0-9-]+$/).optional() });
async function compile(c: Context<Env>, id?: string) {
  const p = c.get("platform");
  const b = await body(c, CompileBody);
  return c.json(await compileScenario(b.text, { tools: p.tools, invariants: p.invariants, provider: p.provider, id: id ?? b.id }));
}
catalogRoutes.post("/scenarios/compile", (c) => compile(c));
catalogRoutes.post("/scenarios/:id/compile", (c) => compile(c, c.req.param("id")));
catalogRoutes.get("/scenarios/:id", async (c) => c.json(await getScenario(c.get("platform"), project(c), c.req.param("id"))));
catalogRoutes.put("/scenarios/:id", async (c) => {
  const r = await updateScenario(c.get("platform"), project(c), c.req.param("id"), await c.req.json());
  await audited(c, "scenario.update", "scenario", r.code, { version: r.version });
  return c.json(r);
});

catalogRoutes.get("/scenario-sets", async (c) => c.json(await listScenarioSets(c.get("platform"), project(c))));
const SetBody = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), description: z.string().optional(), kind: z.enum(["suite", "regression"]).optional(), codes: z.array(z.string()) });
catalogRoutes.post("/scenario-sets", async (c) => {
  const s = await upsertScenarioSet(c.get("platform"), project(c), await body(c, SetBody));
  await audited(c, "scenario_set.upsert", "scenario_set", s.id, { size: s.size });
  return c.json(s, 201);
});
