import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Platform } from "@rel/platform";
import { errorHandler, requireAuth, type Env } from "./http";
import { adminRoutes } from "./routes/admin";
import { catalogRoutes } from "./routes/catalog";
import { evaluationRoutes } from "./routes/evaluations";
import { mutationRoutes } from "./routes/mutations";

export function createApp(p: Platform) {
  const app = new Hono<Env>();
  app.onError(errorHandler);
  app.use("*", cors({ origin: (o) => (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : null), allowHeaders: ["content-type", "x-api-key", "authorization"] }));
  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    if (!c.req.path.endsWith("/events"))
      p.log.info("http", { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started });
  });
  app.get("/api/health", (c) => c.json({ ok: true, database: p.handle.kind }));
  const api = new Hono<Env>();
  api.use("*", requireAuth(p));
  api.route("/", catalogRoutes);
  api.route("/", evaluationRoutes);
  api.route("/", mutationRoutes);
  api.route("/", adminRoutes);
  app.route("/api", api);
  return app;
}
