/**
 * Background job queue. The in-process implementation is the default for local/single-node use;
 * the interface is shaped so a Redis/BullMQ implementation can be dropped in for multi-worker deployments.
 */
export interface JobQueue {
  enqueue(name: string, payload: Record<string, unknown>): Promise<string>;
  process(name: string, handler: (payload: Record<string, unknown>) => Promise<void>): void;
  depth(): number;
  idle(): Promise<void>;
}

export class InProcessQueue implements JobQueue {
  private handlers = new Map<string, (p: Record<string, unknown>) => Promise<void>>();
  private pending: { id: string; name: string; payload: Record<string, unknown> }[] = [];
  private running = 0;
  private waiters: (() => void)[] = [];
  private seq = 0;

  constructor(
    private concurrency = 1,
    private onError: (err: unknown, job: { name: string; payload: Record<string, unknown> }) => void = () => {},
  ) {}

  async enqueue(name: string, payload: Record<string, unknown>) {
    const id = `job_${++this.seq}`;
    this.pending.push({ id, name, payload });
    queueMicrotask(() => this.pump());
    return id;
  }

  process(name: string, handler: (p: Record<string, unknown>) => Promise<void>) {
    this.handlers.set(name, handler);
    this.pump();
  }

  depth() {
    return this.pending.length + this.running;
  }

  idle(): Promise<void> {
    if (this.depth() === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private pump() {
    while (this.running < this.concurrency) {
      const idx = this.pending.findIndex((j) => this.handlers.has(j.name));
      if (idx < 0) break;
      const job = this.pending.splice(idx, 1)[0]!;
      this.running++;
      this.handlers
        .get(job.name)!(job.payload)
        .catch((err) => this.onError(err, job))
        .finally(() => {
          this.running--;
          if (this.depth() === 0) this.waiters.splice(0).forEach((w) => w());
          this.pump();
        });
    }
  }
}
