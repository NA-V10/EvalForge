import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, apiKeys, projects } from "@rel/database";
import { RedactionRuleSchema } from "../schemas";
import { createApiKey, listSecretNames, putSecret } from "@rel/platform";
import { audited, body, project, requireRole, type Env } from "../http";

export const adminRoutes = new Hono<Env>();

adminRoutes.get("/system/metrics", (c) => {
  const p = c.get("platform");
  return c.json({ ...p.telemetry.snapshot(p.queue.depth()), judge: `${p.provider.id}:${p.provider.model}`, judgeOffline: p.provider.offline, database: p.handle.kind });
});

adminRoutes.get("/audit-logs", requireRole("admin"), async (c) =>
  c.json(await c.get("platform").db.select().from(auditLogs).where(eq(auditLogs.projectId, project(c))).orderBy(desc(auditLogs.createdAt)).limit(200)),
);

/** Secrets: write-only. Values are encrypted at rest and never returned. */
adminRoutes.get("/secrets", requireRole("admin"), async (c) => c.json(await listSecretNames(c.get("platform").db, project(c))));
adminRoutes.put("/secrets/:name", requireRole("admin"), async (c) => {
  const { value } = await body(c, z.object({ value: z.string().min(1) }));
  await putSecret(c.get("platform").db, project(c), c.req.param("name"), value);
  await audited(c, "secret.put", "secret", c.req.param("name"));
  return c.json({ ok: true });
});

adminRoutes.get("/api-keys", requireRole("admin"), async (c) =>
  c.json(
    (await c.get("platform").db.select().from(apiKeys).where(eq(apiKeys.projectId, project(c)))).map(({ hash: _hash, ...k }) => k),
  ),
);
adminRoutes.post("/api-keys", requireRole("admin"), async (c) => {
  const b = await body(c, z.object({ name: z.string().min(1), role: z.enum(["admin", "engineer", "viewer"]) }));
  const key = await createApiKey(c.get("platform").db, project(c), b.name, b.role);
  await audited(c, "api_key.create", "api_key", key.slice(0, 10), { role: b.role });
  return c.json({ key, note: "Store this key now — it cannot be retrieved again." }, 201);
});

adminRoutes.get("/settings/redaction", async (c) => {
  const row = (await c.get("platform").db.select().from(projects).where(eq(projects.id, project(c))))[0]!;
  return c.json({ rules: row.redactionRules });
});
adminRoutes.put("/settings/redaction", requireRole("admin"), async (c) => {
  const { rules } = await body(c, z.object({ rules: z.array(RedactionRuleSchema) }));
  for (const r of rules) new RegExp(r.pattern); // reject invalid regexes early
  await c.get("platform").db.update(projects).set({ redactionRules: rules }).where(eq(projects.id, project(c)));
  await audited(c, "redaction.update", "project", project(c), { rules: rules.length });
  return c.json({ rules });
});
