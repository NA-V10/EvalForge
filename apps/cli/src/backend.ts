import type { GateResult } from "./types";

/** What the CLI needs from the platform — implemented in-process (local DB) or over HTTP (deployed instance). */
export interface Backend {
  kind: "local" | "remote";
  startRun(input: Record<string, unknown>): Promise<{ id: string; total: number }>;
  waitForRun(id: string, onProgress: (done: number, total: number) => void): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  getRun(id: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  listRuns(agent?: string): Promise<any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  failures(filter: Record<string, string | boolean | undefined>): Promise<any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  failure(id: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  trace(id: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  compareVersions(agent: string, a: string, b: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  evaluateGate(input: { runId: string; baselineRunId?: string; policy?: unknown }): Promise<GateResult>;
  createScenario(spec: unknown): Promise<{ code: string; version: number; warnings: string[] }>;
  createAgentVersion(agent: string, spec: unknown): Promise<{ version: string }>;
  compile(text: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  scenarios(): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): Promise<void>;
}

export async function localBackend(): Promise<Backend> {
  const pl = await import("@rel/platform");
  const { compileScenario } = await import("@rel/scenario-engine");
  const p = await pl.createPlatform({ log: pl.createLogger({ service: "cli" }, (process.env.LOG_LEVEL as "info") ?? "error") });
  pl.registerWorkers(p);
  const project = await pl.bootstrap(p);
  const pid = project.id;
  const actor = { projectId: pid, actor: `cli:${process.env.USER ?? process.env.USERNAME ?? "local"}` };
  return {
    kind: "local",
    async startRun(input) {
      const r = await pl.startRun(p, pid, input as never);
      await pl.audit(p.db, actor, "run.start", "evaluation_run", r.id, input);
      return r;
    },
    async waitForRun(id, onProgress) {
      const listener = (e: { runId: string; completed: number; total: number }) => e.runId === id && onProgress(e.completed, e.total);
      p.events.on("run", listener);
      await p.queue.idle();
      p.events.off("run", listener);
      return pl.getRun(p, pid, id);
    },
    getRun: (id) => pl.getRun(p, pid, id),
    listRuns: (agent) => pl.listRuns(p, pid, { agent }),
    failures: (f) => pl.listFailures(p, pid, f as never),
    failure: (id) => pl.getFailure(p, pid, id),
    trace: (id) => pl.getTrace(p, pid, id),
    compareVersions: (agent, a, b) => pl.compareVersions(p, pid, agent, a, b),
    async evaluateGate(input) {
      const g = await pl.evaluateGate(p, pid, input);
      await pl.audit(p.db, actor, "release_gate.evaluate", "evaluation_run", input.runId, { decision: g.decision });
      return g;
    },
    createScenario: (spec) => pl.createScenario(p, pid, spec),
    createAgentVersion: (agent, spec) => pl.createAgentVersion(p, pid, agent, spec as never),
    compile: (text) => compileScenario(text, { tools: p.tools, invariants: p.invariants, provider: p.provider }),
    scenarios: () => pl.scenarioIndex(p, pid),
    close: () => p.close(),
  };
}

export function remoteBackend(baseUrl: string, apiKey: string | undefined): Backend {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), { details: (body as { details?: string[] }).details });
    return body;
  };
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
  const qs = (f: Record<string, unknown>) => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return {
    kind: "remote",
    startRun: (input) => post("/evaluations/run", input),
    async waitForRun(id, onProgress) {
      for (;;) {
        const r = await call(`/evaluations/runs/${id}`);
        onProgress(r.progress.completed, r.progress.total);
        if (r.status === "completed" || r.status === "failed") return r;
        await new Promise((res) => setTimeout(res, 1500));
      }
    },
    getRun: (id) => call(`/evaluations/runs/${id}`),
    listRuns: (agent) => call(`/evaluations/runs${agent ? `?agent=${agent}` : ""}`),
    failures: (f) => call(`/failures?${qs(f)}`),
    failure: (id) => call(`/failures/${id}`),
    trace: (id) => call(`/traces/${id}`),
    compareVersions: (agent, a, b) => call(`/agents/${agent}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
    evaluateGate: (input) => post("/release-gates/evaluate", input),
    createScenario: (spec) => post("/scenarios", spec),
    createAgentVersion: (agent, spec) => post(`/agents/${agent}/versions`, spec),
    compile: (text) => post("/scenarios/compile", { text }),
    scenarios: () => call("/scenarios"),
    close: async () => {},
  };
}
