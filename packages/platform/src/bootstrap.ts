import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { REPO_ROOT } from "@rel/database";
import { ensureProject, syncLibraries } from "./catalog";
import type { Platform } from "./context";
import { authenticate, createApiKey } from "./security";

export const DEV_KEY_FILE = resolve(REPO_ROOT, ".data/dev-api-key");

/** Idempotent startup: default project, tool/invariant library sync. */
export async function bootstrap(p: Platform) {
  const project = await ensureProject(p);
  await syncLibraries(p, project.id);
  return project;
}

/**
 * Local development key: generated once, stored under .data (git-ignored) with owner-only intent,
 * read by the web dev proxy and CLI. Never used when RELIABILITY_API_KEY is provided.
 */
export async function ensureDevApiKey(p: Platform, projectId: string): Promise<string> {
  if (existsSync(DEV_KEY_FILE)) {
    const key = readFileSync(DEV_KEY_FILE, "utf8").trim();
    if (await authenticate(p.db, key)) return key;
  }
  const key = await createApiKey(p.db, projectId, "local-development", "admin");
  mkdirSync(dirname(DEV_KEY_FILE), { recursive: true });
  writeFileSync(DEV_KEY_FILE, key, { mode: 0o600 });
  p.log.info("created local development API key", { file: DEV_KEY_FILE });
  return key;
}
