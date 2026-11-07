import {
  deepClone,
  getPath,
  interpolatePath,
  setPath,
  type StateDiff,
  type ToolDefinition,
  type ToolFault,
} from "@rel/core";

export interface SimulatedCall {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  latencyMs: number;
  costUsd: number;
  stateDiff: StateDiff[];
  fault?: ToolFault["mode"];
}

/** Validate arguments against the tool's input schema the way a real backend would (400 on bad input). */
export function validateToolArgs(def: ToolDefinition, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [name, p] of Object.entries(def.inputSchema)) {
    const v = args[name];
    if (v === undefined || v === null || v === "") {
      if (p.required) problems.push(`missing required argument "${name}"`);
      continue;
    }
    if (p.type === "number" ? typeof v !== "number" || Number.isNaN(v) : p.type === "object" ? typeof v !== "object" : typeof v !== p.type)
      problems.push(`"${name}" must be ${p.type}`);
    else if (p.pattern && !new RegExp(p.pattern).test(String(v))) problems.push(`"${name}" does not match ${p.pattern}`);
    else if (p.enum && !p.enum.includes(String(v))) problems.push(`"${name}" must be one of ${p.enum.join(", ")}`);
  }
  for (const k of Object.keys(args)) if (!(k in def.inputSchema)) problems.push(`unknown argument "${k}"`);
  return problems;
}

/**
 * Executes declarative tool behaviours against an in-memory world state, with seeded latency
 * jitter and scenario-defined fault injection. Fully deterministic for a given seed.
 */
export class ToolSimulator {
  private calls = new Map<string, number>();
  private created = 0;

  constructor(
    private readonly tools: Map<string, ToolDefinition>,
    readonly world: Record<string, unknown>,
    private readonly faults: ToolFault[],
    private readonly random: () => number,
  ) {}

  call(name: string, args: Record<string, unknown>): SimulatedCall {
    const def = this.tools.get(name);
    if (!def) return this.fail("UNKNOWN_TOOL", `tool "${name}" is not available to this agent`, 5);
    const n = (this.calls.get(name) ?? 0) + 1;
    this.calls.set(name, n);
    const jitter = 0.85 + this.random() * 0.3;
    const latency = Math.round(def.latencyMs * jitter);
    const fault = this.faults.find((f) => f.tool === name && (!f.onCalls || f.onCalls.includes(n)));

    const problems = validateToolArgs(def, args);
    if (problems.length) return this.fail("INVALID_ARGUMENTS", problems.join("; "), latency);

    if (fault?.mode === "timeout") {
      return { ...this.fail("TIMEOUT", fault.message ?? `${name} timed out`, fault.latencyMs ?? 10_000), fault: "timeout" };
    }
    if (fault?.mode === "error") {
      const code = fault.statusCode ?? 500;
      return { ...this.fail(`HTTP_${code}`, fault.message ?? `upstream service returned ${code}`, latency), fault: "error" };
    }
    if (!fault && def.failureRate > 0 && this.random() < def.failureRate) {
      return this.fail("HTTP_503", "service temporarily unavailable", latency);
    }

    const base = this.execute(def, args);
    const out: SimulatedCall = { ...base, latencyMs: latency, costUsd: def.costUsd };
    if (!fault || !out.ok) return out;

    out.fault = fault.mode;
    switch (fault.mode) {
      case "delayed":
        out.latencyMs = fault.latencyMs ?? 8_000;
        break;
      case "malformed":
        out.result = `{"status": "ok", "data": {"id": ${JSON.stringify(String(args[Object.keys(args)[0] ?? ""] ?? ""))}, "sta`;
        break;
      case "empty":
        out.result = Array.isArray(out.result) ? [] : null;
        break;
      case "partial":
        out.result = dropFields(out.result, fault.dropFields ?? []);
        break;
      case "contradictory":
        out.result = overrideFields(out.result, fault.override ?? {});
        break;
    }
    return out;
  }

  private fail(code: string, message: string, latencyMs: number): SimulatedCall {
    return { ok: false, error: { code, message }, latencyMs, costUsd: 0, stateDiff: [] };
  }

  private execute(def: ToolDefinition, args: Record<string, unknown>): Omit<SimulatedCall, "latencyMs" | "costUsd"> {
    const b = def.behavior;
    const notFound = (msg: string) => ({ ok: false, error: { code: "NOT_FOUND", message: msg }, stateDiff: [] });
    switch (b.kind) {
      case "static":
        return { ok: true, result: deepClone(b.response), stateDiff: [] };
      case "read": {
        const path = interpolatePath(b.statePath, args);
        const v = path ? getPath(this.world, path) : undefined;
        if (v === undefined) return notFound(b.notFoundError ?? "not found");
        const result = deepClone(v) as Record<string, unknown>;
        if (result && typeof result === "object") for (const f of b.omit) delete result[f];
        return { ok: true, result, stateDiff: [] };
      }
      case "find": {
        const coll = (getPath(this.world, b.collection) ?? {}) as Record<string, Record<string, unknown>>;
        const where = Object.entries(b.where).map(([k, t]) => [k, interpolatePath(t, args)] as const);
        const rows = Object.values(coll).filter((r) => where.every(([k, v]) => v !== null && String(r[k]) === v));
        if (b.single) return rows[0] ? { ok: true, result: deepClone(rows[0]), stateDiff: [] } : notFound(`no ${b.collection} record found`);
        return { ok: true, result: deepClone(rows), stateDiff: [] };
      }
      case "mutate": {
        const path = interpolatePath(b.statePath, args);
        const target = path ? (getPath(this.world, path) as Record<string, unknown> | undefined) : undefined;
        if (!path || !target || typeof target !== "object") return notFound("record not found");
        for (const g of b.guards) {
          if (JSON.stringify(target[g.field]) !== JSON.stringify(g.equals))
            return { ok: false, error: { code: "CONFLICT", message: `${g.error} (${g.field}=${JSON.stringify(target[g.field])})` }, stateDiff: [] };
        }
        const diff: StateDiff[] = [];
        for (const [field, raw] of Object.entries(b.set)) {
          const value = typeof raw === "string" && /^\{\w+\}$/.test(raw) ? args[raw.slice(1, -1)] : raw;
          diff.push({ path: `${path}.${field}`, before: deepClone(target[field]), after: deepClone(value) });
          setPath(this.world, `${path}.${field}`, deepClone(value));
        }
        return { ok: true, result: deepClone(getPath(this.world, path)), stateDiff: diff };
      }
      case "create": {
        this.created++;
        const id = `${b.idPrefix}-${9000 + this.created}`;
        const record = { id, ...deepClone(b.template), ...deepClone(args) };
        const path = `${b.collection}.${id}`;
        setPath(this.world, path, record);
        return { ok: true, result: deepClone(record), stateDiff: [{ path, before: undefined, after: deepClone(record) }] };
      }
      case "verify": {
        const path = interpolatePath(b.statePath, args);
        const target = path ? (getPath(this.world, path) as Record<string, unknown> | undefined) : undefined;
        if (!path || !target) return notFound("customer not found");
        const ok = String(target[b.secretField]) === String(args[b.argName]);
        if (!ok) return { ok: true, result: { verified: false, reason: "code does not match" }, stateDiff: [] };
        const diff: StateDiff[] = target.verified === true ? [] : [{ path: `${path}.verified`, before: target.verified ?? false, after: true }];
        setPath(this.world, `${path}.verified`, true);
        return { ok: true, result: { verified: true }, stateDiff: diff };
      }
      case "search": {
        const coll = (getPath(this.world, b.collection) ?? {}) as Record<string, Record<string, unknown>>;
        const terms = String(args[b.argName] ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
        const scored = Object.values(coll)
          .map((r) => ({ r, s: terms.filter((t) => b.fields.some((f) => JSON.stringify(r[f] ?? "").toLowerCase().includes(t))).length }))
          .filter((x) => x.s > 0)
          .sort((x, y) => y.s - x.s)
          .slice(0, 3)
          .map((x) => deepClone(x.r));
        return { ok: true, result: scored, stateDiff: [] };
      }
    }
  }
}

function dropFields(v: unknown, fields: string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => dropFields(x, fields));
  if (v && typeof v === "object") {
    const o = { ...(v as Record<string, unknown>) };
    for (const f of fields) delete o[f];
    return o;
  }
  return v;
}

function overrideFields(v: unknown, override: Record<string, unknown>): unknown {
  if (Array.isArray(v)) return v.map((x) => overrideFields(x, override));
  if (v && typeof v === "object") return { ...(v as Record<string, unknown>), ...override };
  return v;
}
