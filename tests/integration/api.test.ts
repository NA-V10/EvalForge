import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider } from "@rel/llm";
import { bootstrap, createApiKey, createLogger, createPlatform, registerWorkers, type Platform } from "@rel/platform";
import { createApp } from "@rel/api";
import { SCN_017_INPUT } from "../helpers";

let p: Platform;
let app: ReturnType<typeof createApp>;
let admin: string;
let viewer: string;

beforeAll(async () => {
  p = await createPlatform({ databaseUrl: "memory://", provider: new HeuristicProvider(), log: createLogger({}, "error") });
  registerWorkers(p);
  const project = await bootstrap(p);
  admin = await createApiKey(p.db, project.id, "admin", "admin");
  viewer = await createApiKey(p.db, project.id, "viewer", "viewer");
  app = createApp(p);
});
afterAll(async () => p.close());

const req = (path: string, key?: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), ...(init.headers ?? {}) } });

describe("API", () => {
  it("requires authentication", async () => {
    expect((await req("/health")).status).toBe(200);
    expect((await req("/scenarios")).status).toBe(401);
    expect((await req("/scenarios", "rel_wrong")).status).toBe(401);
  });

  it("enforces roles: viewers are read-only, secrets are admin-only and write-only", async () => {
    expect((await req("/scenarios", viewer)).status).toBe(200);
    expect((await req("/agents", viewer, { method: "POST", body: JSON.stringify({ slug: "x", name: "x" }) })).status).toBe(403);
    expect((await req("/secrets/ANTHROPIC_API_KEY", viewer, { method: "PUT", body: JSON.stringify({ value: "sk-ant-secret-value-123456" }) })).status).toBe(403);
    expect((await req("/secrets/ANTHROPIC_API_KEY", admin, { method: "PUT", body: JSON.stringify({ value: "sk-ant-secret-value-123456" }) })).status).toBe(200);
    const list = await (await req("/secrets", admin)).text();
    expect(list).toContain("ANTHROPIC_API_KEY");
    expect(list).not.toContain("sk-ant-secret-value");
  });

  it("validates input with structured errors", async () => {
    const bad = await req("/scenarios", admin, { method: "POST", body: JSON.stringify({ ...SCN_017_INPUT, availableTools: ["nope"] }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { details: string[] }).details.join()).toContain('unknown tool "nope"');
    const run = await req("/evaluations/run", admin, { method: "POST", body: JSON.stringify({ mode: "all" }) });
    expect(run.status).toBe(400);
  });

  it("creates scenarios, compiles natural language, previews mutations, and audits writes", async () => {
    expect((await req("/scenarios", admin, { method: "POST", body: JSON.stringify(SCN_017_INPUT) })).status).toBe(201);
    const compiled = (await (
      await req("/scenarios/compile", admin, { method: "POST", body: JSON.stringify({ text: "Customer wants to cancel their subscription while a refund is pending." }) })
    ).json()) as { validation: { valid: boolean }; review: string };
    expect(compiled.validation.valid).toBe(true);
    expect(compiled.review).toContain("BILL-002");
    const muts = (await (await req("/mutations/generate", admin, { method: "POST", body: JSON.stringify({ scenario: "SCN-017" }) })).json()) as { mutations: { strategy: string }[] };
    expect(muts.mutations.map((m) => m.strategy)).toEqual(expect.arrayContaining(["tool_failure", "adversarial", "prompt_injection"]));
    const audit = (await (await req("/audit-logs", admin)).json()) as { action: string }[];
    expect(audit.map((a) => a.action)).toContain("scenario.create");
  });
});
