import { createRedactor } from "@rel/core";

const { redactString } = createRedactor({ maskContacts: false });

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON logger. Messages and string fields pass through the secret redactor — secrets are never logged. */
export function createLogger(base: Record<string, unknown> = {}, minLevel: Level = (process.env.LOG_LEVEL as Level) ?? "info") {
  const emit = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const clean = Object.fromEntries(Object.entries({ ...base, ...fields }).map(([k, v]) => [k, typeof v === "string" ? redactString(v) : v]));
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: redactString(msg), ...clean });
    (level === "error" ? process.stderr : process.stdout).write(line + "\n");
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
    info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
    error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
    child: (f: Record<string, unknown>) => createLogger({ ...base, ...f }, minLevel),
  };
}
export type Logger = ReturnType<typeof createLogger>;

/** In-process platform telemetry (exposed at GET /system/metrics). */
export class Telemetry {
  counters: Record<string, number> = {
    runs_started: 0,
    runs_completed: 0,
    runs_failed: 0,
    scenarios_executed: 0,
    scenario_execution_failures: 0,
    evaluator_executions: 0,
    evaluator_failures: 0,
  };
  evaluatorCostUsd = 0;
  private evaluatorLatency: number[] = [];
  private scenarioTime: number[] = [];

  inc(name: string, by = 1) {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }
  observeScenario(ms: number) {
    this.scenarioTime.push(ms);
    if (this.scenarioTime.length > 2000) this.scenarioTime.shift();
  }
  observeEvaluator(ms: number, cost: number, failed: boolean) {
    this.inc("evaluator_executions");
    if (failed) this.inc("evaluator_failures");
    this.evaluatorCostUsd += cost;
    this.evaluatorLatency.push(ms);
    if (this.evaluatorLatency.length > 2000) this.evaluatorLatency.shift();
  }
  snapshot(queueDepth: number) {
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      counters: this.counters,
      queue_depth: queueDepth,
      avg_scenario_execution_ms: Math.round(avg(this.scenarioTime) * 10) / 10,
      avg_evaluator_latency_ms: Math.round(avg(this.evaluatorLatency) * 10) / 10,
      evaluator_cost_usd: Math.round(this.evaluatorCostUsd * 1e6) / 1e6,
    };
  }
}
