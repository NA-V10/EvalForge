import { createHash, randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function stableHash(input: unknown, length = 12): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, length);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** Read a dotted path (`customers.CUS-1.verified`). Keys containing dots are not supported by design. */
export function getPath(obj: unknown, path: string): unknown {
  if (path === "" || path === ".") return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Resolve a path that may contain `*` segments. Returns a flat array of matched values when wildcards are used. */
export function resolvePath(obj: unknown, path: string): unknown {
  if (!path.includes("*")) return getPath(obj, path);
  let frontier: unknown[] = [obj];
  for (const part of path.split(".")) {
    const next: unknown[] = [];
    for (const cur of frontier) {
      if (cur === null || typeof cur !== "object") continue;
      if (part === "*") next.push(...Object.values(cur as Record<string, unknown>));
      else if ((cur as Record<string, unknown>)[part] !== undefined) next.push((cur as Record<string, unknown>)[part]);
    }
    frontier = next;
  }
  return frontier;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Interpolate `{arg}` placeholders. Returns null when an arg is missing. */
export function interpolatePath(template: string, args: Record<string, unknown>): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = args[k];
    if (v === undefined || v === null || v === "") {
      missing = true;
      return "";
    }
    return String(v);
  });
  return missing ? null : out;
}

/** Mulberry32 — small, fast, seedable PRNG for reproducible simulation. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(...parts: (string | number)[]): number {
  // 31-bit so seeds fit a Postgres integer column.
  return parseInt(createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 8), 16) & 0x7fffffff;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Collect all primitive leaf values in an object (used for grounding + leak checks). */
export function leafValues(obj: unknown, out: unknown[] = []): unknown[] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object") {
    out.push(obj);
    return out;
  }
  for (const v of Array.isArray(obj) ? obj : Object.values(obj as Record<string, unknown>)) leafValues(v, out);
  return out;
}
