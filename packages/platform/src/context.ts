import { EventEmitter } from "node:events";
import { createRedactor, type Invariant, type RedactionRule, type ToolDefinition } from "@rel/core";
import { createDatabase, type DatabaseHandle, type Db } from "@rel/database";
import { createProviderFromEnv, type LLMProvider } from "@rel/llm";
import { DEFAULT_GLOBAL_INVARIANTS, loadInvariantLibrary, loadToolLibrary } from "@rel/scenario-engine";
import { createLogger, Telemetry, type Logger } from "./observability";
import { InProcessQueue, type JobQueue } from "./queue";

export interface RunProgressEvent {
  runId: string;
  type: "progress" | "completed" | "failed";
  completed: number;
  total: number;
  scenarioId?: string;
  status?: string;
}

export interface Platform {
  handle: DatabaseHandle;
  db: Db;
  provider: LLMProvider;
  tools: Map<string, ToolDefinition>;
  invariants: Map<string, Invariant>;
  globalInvariants: string[];
  queue: JobQueue;
  events: EventEmitter;
  telemetry: Telemetry;
  log: Logger;
  redactorFor(rules: RedactionRule[]): ReturnType<typeof createRedactor>;
  close(): Promise<void>;
}

export async function createPlatform(opts: { databaseUrl?: string; provider?: LLMProvider; log?: Logger } = {}): Promise<Platform> {
  const log = opts.log ?? createLogger({ service: "reliability-os" });
  const handle = await createDatabase({ url: opts.databaseUrl });
  const provider = opts.provider ?? createProviderFromEnv();
  const queue = new InProcessQueue(1, (err, job) => log.error("job failed", { job: job.name, error: err instanceof Error ? err.message : String(err) }));
  const events = new EventEmitter();
  events.setMaxListeners(200);
  log.info("platform ready", { database: handle.kind, judge: `${provider.id}:${provider.model}` });
  return {
    handle,
    db: handle.db,
    provider,
    tools: loadToolLibrary(),
    invariants: loadInvariantLibrary(),
    globalInvariants: DEFAULT_GLOBAL_INVARIANTS,
    queue,
    events,
    telemetry: new Telemetry(),
    log,
    redactorFor: (rules) => createRedactor({ custom: rules }),
    close: async () => {
      await queue.idle();
      await handle.close();
    },
  };
}
