import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { REPO_ROOT } from "@rel/database";
import { bootstrap, createPlatform, ensureDevApiKey, registerWorkers } from "@rel/platform";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
const p = await createPlatform();
registerWorkers(p);
const project = await bootstrap(p);
if (process.env.NODE_ENV !== "production") await ensureDevApiKey(p, project.id);

const app = createApp(p);

// Production: serve the built web UI from the same origin.
const webDist = resolve(REPO_ROOT, "apps/web/dist");
if (existsSync(webDist)) {
  // serveStatic resolves `root` against the process cwd (apps/api under pnpm --filter).
  app.use("/*", serveStatic({ root: relative(process.cwd(), webDist) }));
  app.get("*", (c) => c.html(readFileSync(resolve(webDist, "index.html"), "utf8")));
}

serve({ fetch: app.fetch, port }, () => p.log.info("api listening", { url: `http://localhost:${port}` }));

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    p.log.info("shutting down", { signal: sig });
    await p.close();
    process.exit(0);
  });
