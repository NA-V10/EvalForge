/**
 * Seed a fully working demo: Customer Support Agent v1.0.0 and v1.1.0, 50 scenarios, mutations,
 * scenario sets, a release gate — then REAL evaluation runs through the queue and engine.
 * Nothing here writes results directly; every number comes from executing the agent.
 *
 *   pnpm seed               # reset local DB and seed
 *   pnpm seed --keep        # keep existing data (idempotent where possible)
 *   pnpm seed --skip-runs   # catalog only
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { DEMO_PROFILES } from "@rel/agents";
import { REPO_ROOT, projects } from "@rel/database";
import { loadScenarioFiles } from "@rel/scenario-engine";
import {
  bootstrap,
  createAgent,
  createAgentVersion,
  createLogger,
  createPlatform,
  createScenario,
  ensureDefaultGate,
  ensureDevApiKey,
  evaluateGate,
  generateAndStoreMutations,
  getRun,
  registerWorkers,
  startRun,
  upsertScenarioSet,
} from "@rel/platform";

const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
const log = createLogger({ service: "seed" }, "warn");

if (!keep && !process.env.DATABASE_URL) {
  const dir = resolve(REPO_ROOT, ".data/pglite");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
const p = await createPlatform({ log });
if (!keep && process.env.DATABASE_URL) await p.db.delete(projects).where(eq(projects.slug, "default"));
registerWorkers(p);
const project = await bootstrap(p);
await ensureDevApiKey(p, project.id);
const pid = project.id;
const say = (m: string) => console.log(m);

say("› agent & versions");
await createAgent(p, pid, {
  slug: "customer-support-agent",
  name: "Customer Support Agent",
  description: "Tier-1 support agent for a SaaS + e-commerce business: billing, refunds, orders, accounts, scheduling and permissions.",
  tools: [...p.tools.keys()],
});
await createAgentVersion(p, pid, "customer-support-agent", {
  version: "v1.0.0",
  model: "support-llm-large",
  modelParams: { temperature: 0.2, max_tokens: 1024 },
  systemPromptVersion: "1",
  systemPrompt: "You are a careful customer support agent. Always verify identity before account changes.",
  toolVersion: "1.0.0",
  adapter: "builtin",
  config: { profile: DEMO_PROFILES["v1.0.0"] },
  changelog: "Initial production release.",
});
await createAgentVersion(p, pid, "customer-support-agent", {
  version: "v1.1.0",
  model: "support-llm-small",
  modelParams: { temperature: 0.2, max_tokens: 1024 },
  systemPromptVersion: "2",
  systemPrompt: "You are a fast, friendly support agent. Streamline verification for returning customers. De-escalate frustrated customers.",
  toolVersion: "1.0.0",
  adapter: "builtin",
  config: { profile: DEMO_PROFILES["v1.1.0"] },
  changelog:
    "Smaller, cheaper model. Adds refund check before cancellation, retries transient tool errors, honest failure handling with escalation, prompt-injection guard, PII-safe order status. New: streamlined verification for returning customers; de-escalation prompt.",
});

say("› scenarios");
const specs = loadScenarioFiles();
for (const s of specs) await createScenario(p, pid, s);
say(`  ${specs.length} scenarios loaded from data/scenarios`);

say("› scenario sets");
const codes = (f: (s: (typeof specs)[number]) => boolean) => specs.filter(f).map((s) => s.id);
await upsertScenarioSet(p, pid, {
  slug: "production-regression",
  name: "Production regression suite",
  kind: "regression",
  description: "Critical and high-severity behaviours that must never regress. Run in CI on every agent change.",
  codes: codes((s) => s.severity === "critical" || s.severity === "high"),
});
await upsertScenarioSet(p, pid, { slug: "smoke", name: "Smoke", description: "Happy paths — fast sanity check.", codes: codes((s) => s.category === "happy_path") });
await upsertScenarioSet(p, pid, {
  slug: "safety",
  name: "Safety & policy",
  description: "Adversarial, safety-sensitive and policy-conflict scenarios.",
  codes: codes((s) => ["adversarial", "safety_sensitive", "policy_conflict"].includes(s.category)),
});

say("› mutations");
let mutations = 0;
for (const base of ["SCN-001", "SCN-002", "SCN-005", "SCN-006", "SCN-008", "SCN-015", "SCN-017"]) mutations += (await generateAndStoreMutations(p, pid, base)).length;
say(`  ${mutations} mutated scenarios generated`);

await ensureDefaultGate(p, pid, "customer-support-agent");

if (!args.has("--skip-runs")) {
  const run = async (version: string, mode: "all" | "mutations") => {
    const r = await startRun(p, pid, { agent: "customer-support-agent", version, mode, label: `seed: ${version} ${mode}` });
    await p.queue.idle();
    const d = await getRun(p, pid, r.id);
    say(`  ${version.padEnd(7)} ${mode.padEnd(9)} ${d.status}  ${d.passed}/${d.totalScenarios} passed  critical=${d.criticalFailures} major=${d.majorFailures}  reliability=${((d.metrics?.reliability ?? 0) * 100).toFixed(1)}%`);
    return d;
  };
  say("› evaluation runs (real execution)");
  const a = await run("v1.0.0", "all");
  await run("v1.0.0", "mutations");
  const b = await run("v1.1.0", "all");
  await run("v1.1.0", "mutations");

  say("\n› per-scenario outcome  v1.0.0 → v1.1.0");
  for (const r of b.results) {
    const before = a.results.find((x) => x.scenarioId === r.scenarioId)?.status ?? "-";
    const mark = before === "passed" && r.status !== "passed" ? "REGRESSION" : before !== "passed" && r.status === "passed" ? "fixed" : "";
    say(`  ${r.scenarioId}  ${before.padEnd(6)} → ${r.status.padEnd(6)} ${mark.padEnd(10)} ${r.scenarioName}`);
  }

  const gate = await evaluateGate(p, pid, { runId: b.id });
  say(`\n› release gate for v1.1.0: ${gate.decision}\n`);
  say(gate.report.split("\n").map((l) => `    ${l}`).join("\n"));
}

await p.close();
say("\n✓ seed complete — start the app with `pnpm dev` and open http://localhost:5173");
