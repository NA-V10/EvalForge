import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Invariant, ScenarioSpec, ToolDefinition, type ScenarioSpecInput } from "@rel/core";

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, "../../../data");

export function loadToolLibrary(file = join(DATA_DIR, "tools/support-tools.json")): Map<string, ToolDefinition> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown[];
  return new Map(raw.map((t) => ToolDefinition.parse(t)).map((t) => [t.name, t]));
}

export function loadInvariantLibrary(file = join(DATA_DIR, "invariants/library.json")): Map<string, Invariant> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown[];
  return new Map(raw.map((i) => Invariant.parse(i)).map((i) => [i.id, i]));
}

/** Load every `*.json` scenario file in a directory (each file holds one scenario or an array). */
export function loadScenarioFiles(dir = join(DATA_DIR, "scenarios")): ScenarioSpec[] {
  if (!existsSync(dir)) return [];
  const out: ScenarioSpec[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as ScenarioSpecInput | ScenarioSpecInput[];
    for (const s of Array.isArray(raw) ? raw : [raw]) {
      const parsed = ScenarioSpec.safeParse(s);
      if (!parsed.success) throw new Error(`${f}: scenario ${(s as { id?: string }).id ?? "?"} invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      out.push(parsed.data);
    }
  }
  return out;
}

/** The global invariants applied to every scenario by default. */
export const DEFAULT_GLOBAL_INVARIANTS = ["AUTH-001", "PRIV-001", "REL-001"];
