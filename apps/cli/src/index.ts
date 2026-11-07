#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import { localBackend, remoteBackend, type Backend } from "./backend";
import { action, c, pct, sev, table } from "./format";

/** Exit codes: 0 ok · 1 gate blocked / validation failed · 2 usage or runtime error. */
const EXIT = { ok: 0, blocked: 1, error: 2 };

const program = new Command()
  .name("reliability")
  .description("ReliabilityOS — evaluate how agents behave, not just what they say.")
  .option("--api <url>", "use a deployed ReliabilityOS API instead of the local database (env RELIABILITY_API_URL)")
  .option("--json", "machine-readable output");

async function backend(): Promise<Backend> {
  const url = program.opts().api ?? process.env.RELIABILITY_API_URL;
  return url ? remoteBackend(url, process.env.RELIABILITY_API_KEY) : localBackend();
}
const json = () => Boolean(program.opts().json);
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function withBackend<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
  const b = await backend();
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

function readSpecFile(file: string): unknown {
  const text = readFileSync(file, "utf8");
  return [".yaml", ".yml"].includes(extname(file)) ? YAML.parse(text) : JSON.parse(text);
}
function specFiles(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => /\.(json|ya?ml)$/.test(f)).map((f) => join(path, f))
    : [path];
}

// ───────────────────────────── scenario ─────────────────────────────

const scenario = program.command("scenario").description("create, validate and list scenarios");

scenario
  .command("validate <path>")
  .description("validate a scenario file or directory against the tool and invariant libraries (no database needed)")
  .action(async (path: string) => {
    const { loadInvariantLibrary, loadToolLibrary, validateScenario } = await import("@rel/scenario-engine");
    const tools = loadToolLibrary();
    const invariants = loadInvariantLibrary();
    let bad = 0;
    let count = 0;
    for (const f of specFiles(path)) {
      const raw = readSpecFile(f);
      for (const s of Array.isArray(raw) ? raw : [raw]) {
        count++;
        const r = validateScenario(s, tools, invariants);
        const id = (s as { id?: string }).id ?? f;
        if (!r.valid) bad++;
        if (!json()) {
          console.log(`${r.valid ? c.green("✓") : c.red("✗")} ${id}`);
          r.errors.forEach((e) => console.log(`    ${c.red(e)}`));
          r.warnings.forEach((w) => console.log(`    ${c.yellow(w)}`));
        }
      }
    }
    if (json()) out({ scenarios: count, invalid: bad });
    else console.log(`\n${count - bad}/${count} valid`);
    process.exitCode = bad ? EXIT.blocked : EXIT.ok;
  });

scenario
  .command("create")
  .description("create a scenario from a spec file, or compile one from natural language")
  .option("-f, --file <file>", "JSON or YAML scenario spec")
  .option("-t, --text <text>", "natural-language description to compile")
  .option("--save", "with --text: save the compiled scenario (default: print it for review)")
  .action(async (o: { file?: string; text?: string; save?: boolean }) => {
    if (!o.file && !o.text) throw new Error("provide --file or --text");
    await withBackend(async (b) => {
      if (o.text) {
        const compiled = await b.compile(o.text);
        if (!o.save) {
          if (json()) return out(compiled);
          console.log(c.dim(`# compiler: ${compiled.compiler} · valid: ${compiled.validation.valid}`));
          console.log(compiled.review);
          console.log(c.dim("Re-run with --save to store it, or edit the full spec and use --file."));
          return;
        }
        const r = await b.createScenario(compiled.spec);
        return json() ? out(r) : console.log(`${c.green("✓")} created ${r.code} (v${r.version})`);
      }
      const r = await b.createScenario(readSpecFile(o.file!));
      if (json()) return out(r);
      console.log(`${c.green("✓")} created ${r.code} (v${r.version})`);
      r.warnings.forEach((w) => console.log(`  ${c.yellow(w)}`));
    });
  });

scenario
  .command("list")
  .description("list scenarios with their latest status")
  .action(() =>
    withBackend(async (b) => {
      const d = await b.scenarios();
      if (json()) return out(d);
      console.log(
        table([
          ["ID", "SEVERITY", "CATEGORY", "LATEST", "NAME"],
          ...d.scenarios.map((s: { code: string; severity: string; category: string; latest?: { status: string }; name: string }) => [
            s.code,
            sev(s.severity),
            s.category,
            s.latest?.status === "passed" ? c.green("PASS") : s.latest ? c.red("FAIL") : c.dim("—"),
            s.name,
          ]),
        ]),
      );
    }),
  );

// ───────────────────────────── agent ─────────────────────────────

const agent = program.command("agent").description("agent versions");
agent
  .command("version-create")
  .description("register a new agent version from a JSON/YAML spec (version, model, adapter, config, …)")
  .requiredOption("--agent <slug>")
  .requiredOption("-f, --file <file>")
  .option("--version <version>", "override the version in the file (e.g. a git SHA based semver)")
  .action((o: { agent: string; file: string; version?: string }) =>
    withBackend(async (b) => {
      const spec = { ...(readSpecFile(o.file) as object), ...(o.version ? { version: o.version } : {}) };
      const v = await b.createAgentVersion(o.agent, spec);
      json() ? out(v) : console.log(`${c.green("✓")} ${o.agent} ${v.version} registered`);
    }),
  );

// ───────────────────────────── eval ─────────────────────────────

const evalCmd = program.command("eval").description("run evaluations and regression comparisons");

async function printRunSummary(b: Backend, run: any) {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = run.metrics;
  console.log("");
  console.log(`${c.green("✓")} ${run.passed} passed`);
  console.log(`${c.red("✗")} ${run.failed + run.errored} failed`);
  console.log("");
  console.log(`Critical: ${run.criticalFailures ? c.red(run.criticalFailures) : run.criticalFailures}`);
  console.log(`Major: ${run.majorFailures}`);
  console.log(`Minor: ${run.minorFailures}`);
  console.log("");
  console.log(`Reliability: ${c.bold(pct(m?.reliability))}  ${c.dim(`(composite; safety ${pct(m?.dimensions.safety)} · correctness ${pct(m?.dimensions.correctness)} · trajectory ${pct(m?.dimensions.trajectory)})`)}`);
  if (run.regression) console.log(`Regressions: ${run.regression.newFailures ? c.red(run.regression.newFailures) : 0} new · ${c.green(run.regression.fixed)} fixed vs baseline`);
  const failing = run.results.filter((r: { status: string }) => r.status !== "passed");
  if (failing.length) {
    console.log("");
    console.log(
      table(
        failing.map((r: { scenarioId: string; worstSeverity: string | null; scenarioName: string; regression: boolean; firstDivergence: { position: number; actual: string | null } | null }) => [
          c.red("✗"),
          r.scenarioId,
          r.worstSeverity ? sev(r.worstSeverity) : "",
          r.regression ? c.magenta("REGRESSION") : "",
          r.firstDivergence ? c.dim(`diverged @${r.firstDivergence.position}: ${action(r.firstDivergence.actual)}`) : "",
          r.scenarioName,
        ]),
      ),
    );
  }
  void b;
}

evalCmd
  .command("run")
  .description("execute an evaluation run and print the result")
  .requiredOption("--agent <slug>", "agent slug")
  .option("--version <version>", "agent version (default: latest)")
  .option("--suite <slug>", "scenario set, e.g. production-regression")
  .option("--scenario <ids...>", "specific scenario ids (e.g. SCN-017)")
  .option("--mode <mode>", "all | selected | failed | regression_suite | mutations")
  .option("--seed <n>", "random seed", (v) => parseInt(v, 10))
  .option("--gate", "also evaluate the release gate and exit 1 if blocked")
  .action((o: { agent: string; version?: string; suite?: string; scenario?: string[]; mode?: string; seed?: number; gate?: boolean }) =>
    withBackend(async (b) => {
      const mode = o.mode ?? (o.scenario?.length ? "selected" : o.suite ? "regression_suite" : "all");
      const started = await b.startRun({ agent: o.agent, version: o.version, mode, scenarios: o.scenario, scenarioSet: o.suite, seed: o.seed, label: `cli${process.env.GITHUB_SHA ? ` ${process.env.GITHUB_SHA.slice(0, 7)}` : ""}` });
      if (!json()) console.log(`Running ${started.total} scenarios… ${c.dim(started.id)}`);
      let last = -1;
      const run = await b.waitForRun(started.id, (done, total) => {
        if (json() || done === last) return;
        last = done;
        if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${total}`);
      });
      if (process.stdout.isTTY && !json()) process.stdout.write("\r");
      if (run.status !== "completed") throw new Error(`run ${run.id} ${run.status}: ${run.error ?? ""}`);
      let gate = null;
      if (o.gate) gate = await b.evaluateGate({ runId: run.id });
      if (json()) return out({ run: { ...run, results: undefined }, gate });
      await printRunSummary(b, run);
      if (gate) {
        console.log("");
        console.log(`Release Gate: ${gate.decision === "PASS" ? c.green("PASSED") : c.red(c.bold("FAILED"))}`);
        gate.reasons.forEach((r) => console.log(`  ${c.red("•")} ${r}`));
      }
      if (gate?.decision === "BLOCKED") process.exitCode = EXIT.blocked;
    }),
  );

evalCmd
  .command("regression")
  .description("compare the latest full runs of two agent versions")
  .requiredOption("--agent <slug>")
  .requiredOption("--baseline <version>")
  .requiredOption("--candidate <version>")
  .action((o: { agent: string; baseline: string; candidate: string }) =>
    withBackend(async (b) => {
      const d = await b.compareVersions(o.agent, o.baseline, o.candidate);
      if (json()) return out(d.report);
      const r = d.report;
      console.log(`${o.baseline} → ${o.candidate}\n`);
      console.log(
        table([
          ["", o.baseline, o.candidate, ""],
          ...["correctness", "safety", "policy", "trajectory", "grounding", "recovery", "robustness", "latency", "cost"].map((k) => {
            const m = r.metrics.find((x: { key: string }) => x.key === k);
            if (!m) return [k, "—", "—", ""];
            const fmt = (v: number | null) => (v === null ? "—" : k === "latency" ? `${(v / 1000).toFixed(2)}s` : k === "cost" ? `$${v.toFixed(4)}` : pct(v));
            return [k, fmt(m.baseline), fmt(m.candidate), m.direction === "improved" ? c.green("↑") : m.direction === "regressed" ? c.red("↓") : ""];
          }),
        ]),
      );
      console.log(`\n${c.red(`${r.summary.newFailures} new failures`)} · ${c.green(`${r.summary.fixed} fixed`)} · ${r.summary.unchangedFailures} unchanged failures`);
      for (const s of r.scenarios.filter((x: { change: string }) => x.change === "new_failure"))
        console.log(`  ${c.red("PASS → FAIL")} ${s.scenarioId} ${s.scenarioName} ${c.dim(s.newFailureCategories.join(", "))}`);
      for (const s of r.scenarios.filter((x: { change: string }) => x.change === "fixed")) console.log(`  ${c.green("FAIL → PASS")} ${s.scenarioId} ${s.scenarioName}`);
    }),
  );

// ───────────────────────────── trace / failures ─────────────────────────────

const trace = program.command("trace").description("inspect execution traces");
trace
  .command("show <id>")
  .description("show a trace by trace id, or by run id with --scenario")
  .option("--scenario <id>", "scenario id when <id> is a run id")
  .action((id: string, o: { scenario?: string }) =>
    withBackend(async (b) => {
      let traceId = id;
      if (id.startsWith("run_")) {
        const run = await b.getRun(id);
        const r = run.results.find((x: { scenarioId: string; status: string }) => (o.scenario ? x.scenarioId === o.scenario : x.status !== "passed"));
        if (!r) throw new Error("no matching scenario result in run");
        traceId = r.traceId;
      }
      const t = await b.trace(traceId);
      if (json()) return out(t);
      console.log(`${c.bold(t.scenarioCode)} ${t.scenario?.name ?? ""} · ${t.agentVersion} · ${t.result?.status === "passed" ? c.green("PASS") : c.red("FAIL")}\n`);
      for (const s of t.steps) {
        const head = `${String(s.index).padStart(3)} `;
        if (s.type === "user_message") console.log(`${head}${c.blue("User")}  ${s.content}`);
        else if (s.type === "agent_message" || s.type === "final_response") console.log(`${head}${c.bold(s.type === "final_response" ? "Final" : "Agent")} ${s.content}`);
        else if (s.type === "tool_call") console.log(`${head}├── Tool: ${c.bold(s.tool)}(${JSON.stringify(s.arguments)})`);
        else if (s.type === "tool_result") console.log(`${head}│   └ ${s.status === "ok" ? c.green("ok") : c.red(`${s.error?.code} ${s.error?.message}`)} ${c.dim(`${Math.round(s.durationMs)}ms`)}`);
        else if (s.type === "state_change") console.log(`${head}│   ${c.yellow("state")} ${s.stateDiff?.map((d: { path: string; after: unknown }) => `${d.path} → ${JSON.stringify(d.after)}`).join(", ")}`);
        const bad = s.assertions?.filter((a: { passed: boolean }) => !a.passed) ?? [];
        for (const a of bad) console.log(`      ${c.red("✗")} ${a.name} ${c.dim(a.invariantCode ?? "")}`);
      }
      if (t.result?.firstDivergence) {
        const d = t.result.firstDivergence;
        console.log(`\n${c.red("FIRST DIVERGENCE")} position ${d.position}${d.traceStep ? ` (step ${d.traceStep})` : ""} · ${sev(d.severity)}`);
        console.log(`  expected ${action(d.expected)}\n  actual   ${c.red(action(d.actual))}`);
      }
    }),
  );

program
  .command("failures")
  .description("list diagnosed failures (default: latest run)")
  .option("--run <id>")
  .option("--severity <level>")
  .option("--regression", "regressions only")
  .option("--id <failureId>", "show one failure in full")
  .action((o: { run?: string; severity?: string; regression?: boolean; id?: string }) =>
    withBackend(async (b) => {
      if (o.id) {
        const f = await b.failure(o.id);
        if (json()) return out(f);
        console.log(`${sev(f.severity)} ${c.bold(f.title)}\n`);
        console.log(`SCENARIO            ${f.scenarioCode}`);
        if (f.firstDivergence) console.log(`FIRST DIVERGENCE    position ${f.firstDivergence.position}: expected ${action(f.firstDivergence.expected)}, actual ${c.red(action(f.firstDivergence.actual))}`);
        if (f.violatedInvariant) console.log(`VIOLATED INVARIANT  ${f.violatedInvariant.id} "${f.violatedInvariant.name}"`);
        console.log(`EVIDENCE`);
        for (const e of f.evidence) console.log(`  ${e.traceStep ? `step ${e.traceStep}: ` : ""}${e.explanation}`);
        console.log(`REGRESSION          ${f.history.map((h: { version: string; status: string }) => `${h.version} ${h.status === "passed" ? "PASS" : "FAIL"}`).join(" · ")}`);
        console.log(`LIKELY CAUSE        ${f.likelyCause}`);
        console.log(`RECOMMENDED FIX     ${f.recommendation}`);
        return;
      }
      const runId = o.run ?? (await b.listRuns()).find((r: { status: string; mode: string }) => r.status === "completed" && r.mode === "all")?.id;
      const list = await b.failures({ runId, severity: o.severity, regression: o.regression ? true : undefined });
      if (json()) return out(list);
      console.log(
        table([
          ["SEVERITY", "SCENARIO", "CATEGORY", "INVARIANT", "", "TITLE", "ID"],
          ...list.map((f: { severity: string; scenarioCode: string; category: string; violatedInvariant: { id: string } | null; regression: boolean; title: string; id: string }) => [
            sev(f.severity),
            f.scenarioCode,
            f.category,
            f.violatedInvariant?.id ?? "",
            f.regression ? c.magenta("REGRESSION") : "",
            f.title.slice(0, 60),
            c.dim(f.id),
          ]),
        ]),
      );
    }),
  );

// ───────────────────────────── release-check ─────────────────────────────

program
  .command("release-check")
  .description("evaluate the release gate; exits 1 when the release is blocked")
  .option("--run <id>", "run to check (default: latest completed full run of --agent/--version)")
  .option("--agent <slug>")
  .option("--version <version>")
  .option("--baseline <runId>")
  .option("--policy <file>", "YAML/JSON release policy (default: the project's gate)")
  .action((o: { run?: string; agent?: string; version?: string; baseline?: string; policy?: string }) =>
    withBackend(async (b) => {
      let runId = o.run;
      if (!runId) {
        const runs = (await b.listRuns(o.agent)).filter((r: { status: string; agentVersion: string }) => r.status === "completed" && (!o.version || r.agentVersion === o.version));
        // Prefer a full run, then a regression-suite run, then anything.
        runId = (runs.find((r: { mode: string }) => r.mode === "all") ?? runs.find((r: { mode: string }) => r.mode === "regression_suite") ?? runs[0])?.id;
      }
      if (!runId) throw new Error("no completed run found — run `reliability eval run` first");
      const policy = o.policy ? readSpecFile(o.policy) : undefined;
      const g = await b.evaluateGate({ runId, baselineRunId: o.baseline, policy });
      if (json()) out(g);
      else {
        console.log(g.decision === "PASS" ? c.green(c.bold("RELEASE APPROVED")) : c.red(c.bold("RELEASE BLOCKED")));
        console.log("");
        for (const ch of g.checks) console.log(`  ${ch.passed ? c.green("✓") : c.red("✗")} ${ch.label.padEnd(36)} ${ch.actual.padEnd(18)} ${c.dim(`required ${ch.threshold}`)}`);
        console.log("\n" + g.report.split("\n").map((l) => `  ${l}`).join("\n"));
      }
      process.exitCode = g.decision === "PASS" ? EXIT.ok : EXIT.blocked;
    }),
  );

program.parseAsync().catch((err: Error & { details?: string[] }) => {
  console.error(c.red(`error: ${err.message}`));
  err.details?.forEach((d) => console.error(`  ${d}`));
  process.exit(EXIT.error);
});
