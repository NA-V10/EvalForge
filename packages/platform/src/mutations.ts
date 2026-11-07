import { and, eq } from "drizzle-orm";
import type { MutationStrategy } from "@rel/core";
import { scenarios } from "@rel/database";
import { generateMutations } from "@rel/mutation-engine";
import { createScenario, getScenario, recordMutation, updateScenario } from "./catalog";
import type { Platform } from "./context";

/** Generate variants of a scenario and store each as a versioned child scenario. Idempotent. */
export async function generateAndStoreMutations(p: Platform, projectId: string, code: string, strategies?: MutationStrategy[]) {
  const parent = await getScenario(p, projectId, code);
  const out: { code: string; strategy: string; description: string; version: number }[] = [];
  for (const m of generateMutations(parent.spec, p.tools, { strategies })) {
    const exists = (await p.db.select().from(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.code, m.spec.id))))[0];
    if (exists) {
      const r = await updateScenario(p, projectId, m.spec.id, m.spec);
      out.push({ code: m.spec.id, strategy: m.strategy, description: m.description, version: r.version });
      continue;
    }
    await createScenario(p, projectId, m.spec);
    await recordMutation(p, projectId, code, m.spec.id, m.strategy, m.description);
    out.push({ code: m.spec.id, strategy: m.strategy, description: m.description, version: 1 });
  }
  return out;
}
