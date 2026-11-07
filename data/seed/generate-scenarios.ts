/** Validate the synthetic library and write it to data/scenarios/<domain>.json. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadInvariantLibrary, loadToolLibrary, validateScenario } from "@rel/scenario-engine";
import { LIBRARY } from "./library";

const tools = loadToolLibrary();
const invariants = loadInvariantLibrary();
const out = join(DATA_DIR, "scenarios");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out).filter((x) => x.endsWith(".json"))) rmSync(join(out, f));

const byDomain = new Map<string, unknown[]>();
let errors = 0;
const ids = new Set<string>();
for (const s of LIBRARY) {
  const r = validateScenario(s, tools, invariants);
  if (ids.has(s.id)) (console.error(`duplicate id ${s.id}`), errors++);
  ids.add(s.id);
  if (!r.valid) {
    errors++;
    console.error(`✗ ${s.id}: ${r.errors.join("; ")}`);
    continue;
  }
  for (const w of r.warnings) console.warn(`! ${s.id}: ${w}`);
  const list = byDomain.get(s.domain) ?? [];
  list.push(s);
  byDomain.set(s.domain, list);
}
if (errors) {
  console.error(`${errors} invalid scenario(s); nothing written.`);
  process.exit(1);
}
for (const [domain, list] of byDomain) writeFileSync(join(out, `${domain}.json`), JSON.stringify(list, null, 2) + "\n");
console.log(`wrote ${LIBRARY.length} scenarios across ${byDomain.size} files to ${out}`);
