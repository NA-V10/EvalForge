import type { Platform } from "./context";
import { executeRun } from "./runs";

export * from "./context";
export * from "./observability";
export * from "./queue";
export * from "./security";
export * from "./catalog";
export * from "./runs";
export * from "./queries";
export * from "./gates";
export * from "./bootstrap";

/** Attach queue workers. Call once per process that should execute runs. */
export function registerWorkers(p: Platform) {
  p.queue.process("evaluation-run", (payload) => executeRun(p, payload as { runId: string; projectId: string; codes: string[]; seed: number }));
}
export * from "./mutations";
