import { Hono } from "hono";
import { z } from "zod";
import { MUTATION_STRATEGIES } from "@rel/core";
import { generateAndStoreMutations, getScenario } from "@rel/platform";
import { generateMutations } from "@rel/mutation-engine";
import { audited, body, project, type Env } from "../http";

export const mutationRoutes = new Hono<Env>();

const Body = z.object({
  scenario: z.string(),
  strategies: z.array(z.enum(MUTATION_STRATEGIES)).optional(),
  /** false = preview only (nothing stored). */
  persist: z.boolean().default(false),
});

mutationRoutes.post("/mutations/generate", async (c) => {
  const b = await body(c, Body);
  const p = c.get("platform");
  if (!b.persist) {
    const s = await getScenario(p, project(c), b.scenario);
    return c.json({ persisted: false, mutations: generateMutations(s.spec, p.tools, { strategies: b.strategies }) });
  }
  const created = await generateAndStoreMutations(p, project(c), b.scenario, b.strategies);
  await audited(c, "mutations.generate", "scenario", b.scenario, { created: created.length });
  return c.json({ persisted: true, mutations: created }, 201);
});
