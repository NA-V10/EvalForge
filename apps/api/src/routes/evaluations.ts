import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { RUN_MODES } from "@rel/core";
import {
  compare,
  compareVersions,
  coverage,
  evaluateGate,
  getFailure,
  getResult,
  getRun,
  getRunRow,
  getTrace,
  listFailures,
  listGates,
  listRuns,
  overview,
  startRun,
  upsertGate,
  type RunProgressEvent,
} from "@rel/platform";
import { traces } from "@rel/database";
import { eq } from "drizzle-orm";
import { audited, body, project, type Env } from "../http";

export const evaluationRoutes = new Hono<Env>();

evaluationRoutes.get("/overview", async (c) => c.json(await overview(c.get("platform"), project(c))));
evaluationRoutes.get("/coverage", async (c) => c.json(await coverage(c.get("platform"), project(c))));

const RunBody = z.object({
  agent: z.string(),
  version: z.string().optional(),
  mode: z.enum(RUN_MODES).optional(),
  scenarios: z.array(z.string()).optional(),
  scenarioSet: z.string().optional(),
  baselineRunId: z.string().optional(),
  label: z.string().max(120).optional(),
  seed: z.number().int().nonnegative().max(2_147_483_647).optional(),
});
evaluationRoutes.post("/evaluations/run", async (c) => {
  const input = await body(c, RunBody);
  const r = await startRun(c.get("platform"), project(c), input);
  await audited(c, "run.start", "evaluation_run", r.id, { agent: input.agent, version: input.version, mode: input.mode });
  return c.json(r, 202);
});
evaluationRoutes.get("/evaluations/runs", async (c) => c.json(await listRuns(c.get("platform"), project(c), { agent: c.req.query("agent"), limit: Number(c.req.query("limit") ?? 50) })));
evaluationRoutes.get("/evaluations/runs/:id", async (c) => c.json(await getRun(c.get("platform"), project(c), c.req.param("id"))));

/** Live progress over Server-Sent Events. */
evaluationRoutes.get("/evaluations/runs/:id/events", async (c) => {
  const p = c.get("platform");
  const run = await getRunRow(p, project(c), c.req.param("id"));
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ status: run.status, completed: run.progressCompleted, total: run.progressTotal }) });
    if (run.status === "completed" || run.status === "failed") return;
    await new Promise<void>((resolve) => {
      const onEvent = (e: RunProgressEvent) => {
        if (e.runId !== run.id) return;
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
        if (e.type !== "progress") finish();
      };
      const finish = () => {
        p.events.off("run", onEvent);
        resolve();
      };
      p.events.on("run", onEvent);
      stream.onAbort(finish);
    });
  });
});

evaluationRoutes.get("/runs/:id/traces", async (c) => {
  const p = c.get("platform");
  await getRunRow(p, project(c), c.req.param("id"));
  return c.json(await p.db.select().from(traces).where(eq(traces.runId, c.req.param("id"))));
});
evaluationRoutes.get("/results/:id", async (c) => c.json(await getResult(c.get("platform"), project(c), c.req.param("id"))));
evaluationRoutes.get("/traces/:id", async (c) => c.json(await getTrace(c.get("platform"), project(c), c.req.param("id"))));

evaluationRoutes.get("/failures", async (c) => {
  const q = c.req.query();
  return c.json(
    await listFailures(c.get("platform"), project(c), {
      runId: q.runId,
      severity: q.severity,
      category: q.category,
      scenario: q.scenario,
      agentVersion: q.agentVersion,
      regression: q.regression === undefined ? undefined : q.regression === "true",
    }),
  );
});
evaluationRoutes.get("/failures/:id", async (c) => c.json(await getFailure(c.get("platform"), project(c), c.req.param("id"))));

const RegressionBody = z.union([
  z.object({ baselineRunId: z.string(), candidateRunId: z.string() }),
  z.object({ agent: z.string(), baseline: z.string(), candidate: z.string() }),
]);
evaluationRoutes.post("/regression/run", async (c) => {
  const b = await body(c, RegressionBody);
  const p = c.get("platform");
  if ("baselineRunId" in b) return c.json({ report: await compare(p, project(c), b.baselineRunId, b.candidateRunId) });
  return c.json(await compareVersions(p, project(c), b.agent, b.baseline, b.candidate));
});
evaluationRoutes.get("/agents/:id/compare", async (c) =>
  c.json(await compareVersions(c.get("platform"), project(c), c.req.param("id"), c.req.query("a") ?? "", c.req.query("b") ?? "")),
);

evaluationRoutes.get("/release-gates", async (c) => c.json(await listGates(c.get("platform"), project(c))));
const GateBody = z.object({ id: z.string().optional(), name: z.string().min(1), agent: z.string().optional(), policy: z.unknown() });
evaluationRoutes.post("/release-gates", async (c) => {
  const g = await upsertGate(c.get("platform"), project(c), await body(c, GateBody));
  await audited(c, "release_gate.upsert", "release_gate", g.id);
  return c.json(g, 201);
});
const EvalGateBody = z.object({ gateId: z.string().optional(), runId: z.string(), baselineRunId: z.string().optional(), policy: z.unknown().optional() });
evaluationRoutes.post("/release-gates/evaluate", async (c) => {
  const r = await evaluateGate(c.get("platform"), project(c), await body(c, EvalGateBody));
  await audited(c, "release_gate.evaluate", "evaluation_run", r.runId, { decision: r.decision });
  return c.json(r);
});
