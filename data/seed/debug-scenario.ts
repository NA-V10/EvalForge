/** Debug helper: run one scenario against a demo version and print trace + failures. Usage: tsx data/seed/debug-scenario.ts SCN-028 v1.1.0 */
import { DEMO_PROFILES, MODEL_PRICING, createSupportAgent } from "@rel/agents";
import { HeuristicProvider } from "@rel/llm";
import { DEFAULT_GLOBAL_INVARIANTS, loadInvariantLibrary, loadScenarioFiles, loadToolLibrary } from "@rel/scenario-engine";
import { evaluateTrace, executeScenario } from "@rel/evaluation-engine";

const [id = "SCN-017", version = "v1.1.0"] = process.argv.slice(2);
const spec = loadScenarioFiles().find((s) => s.id === id)!;
const tools = loadToolLibrary();
const profile = DEMO_PROFILES[version]!;
const trace = await executeScenario(spec, tools, createSupportAgent(version, profile), { runId: "dbg", seed: 1, agentVersion: version, model: profile.model, pricing: MODEL_PRICING });
for (const s of trace.steps) console.log(`#${s.index} ${s.type} ${s.tool ?? ""} ${s.status ?? ""} ${s.error?.code ?? ""} ${s.content ? JSON.stringify(s.content) : s.arguments ? JSON.stringify(s.arguments) : ""} ${s.acts ? `[${s.acts}]` : ""}`);
const r = await evaluateTrace(spec, trace, tools, { provider: new HeuristicProvider(), invariantLibrary: loadInvariantLibrary(), globalInvariants: DEFAULT_GLOBAL_INVARIANTS }, { runId: "dbg", resultId: "r", agentVersion: version, scenarioVersion: 1 });
console.log(`status=${r.status} divergence=${JSON.stringify(r.firstDivergence)}`);
for (const a of r.assertions.filter((x) => !x.passed)) console.log(`  ✗ [${a.severity}] ${a.kind} ${a.name}: ${a.message}`);
