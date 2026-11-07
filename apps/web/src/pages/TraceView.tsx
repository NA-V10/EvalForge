import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { api, type Overview, type RunDetail, type RunRow, type TraceDetail, type TraceStepView } from "../lib/api";
import { formatAction, humanize, ms, usd } from "../lib/format";
import { DivergenceCallout } from "../components/Trajectory";
import { Card, Code, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, StatusBadge, Table, Tag, cx, ForkMark } from "../components/ui";

const ICON: Record<string, string> = {
  user_message: "User",
  agent_message: "Agent",
  final_response: "Final response",
  tool_call: "Tool",
  tool_result: "Result",
  state_change: "State change",
  error: "Error",
};

/** Group tool_call + tool_result + state_change into one node, as engineers read them. */
interface Node {
  key: number;
  kind: "message" | "tool" | "error";
  steps: TraceStepView[];
}
function toNodes(steps: TraceStepView[]): Node[] {
  const nodes: Node[] = [];
  for (const s of steps) {
    if (s.type === "tool_result" || s.type === "state_change") {
      const parent = [...nodes].reverse().find((n) => n.kind === "tool" && n.steps[0]!.callId === s.callId);
      if (parent) {
        parent.steps.push(s);
        continue;
      }
    }
    nodes.push({ key: s.index, kind: s.type === "tool_call" ? "tool" : s.type === "error" ? "error" : "message", steps: [s] });
  }
  return nodes;
}

function StepDetail({ step, trace }: { step: TraceStepView; trace: TraceDetail }) {
  const related = trace.steps.filter((s) => s.callId && s.callId === step.callId);
  const all = related.length ? related : [step];
  const assertions = all.flatMap((s) => s.assertions);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px]">
        <span className="text-muted">step</span><span>{all.map((s) => s.index).join(", ")}</span>
        <span className="text-muted">timestamp</span><span className="truncate">{step.timestamp}</span>
        <span className="text-muted">offset</span><span>{ms(step.offsetMs)}</span>
        <span className="text-muted">duration</span><span>{ms(all.reduce((a, s) => a + s.durationMs, 0))}</span>
        {step.model && (<><span className="text-muted">model</span><span>{step.model}</span></>)}
        {step.tokens && (<><span className="text-muted">tokens</span><span>{step.tokens.prompt} in · {step.tokens.completion} out</span></>)}
        {step.costUsd !== undefined && (<><span className="text-muted">cost</span><span>{usd(step.costUsd, 5)}</span></>)}
        {step.retry ? (<><span className="text-muted">retry</span><span className="text-warn">#{step.retry}</span></>) : null}
      </div>
      {step.content && <div><div className="mb-1 text-[12px] text-muted">Content</div><div className="whitespace-pre-wrap rounded border border-line bg-bg p-2 text-fg">{step.content}</div></div>}
      {step.acts && step.acts.length > 0 && <div className="flex flex-wrap gap-1">{step.acts.map((a) => <Tag key={a}>{humanize(a)}</Tag>)}</div>}
      {all.map((s) => (
        <div key={s.index} className="space-y-2">
          {s.arguments && <div><div className="mb-1 text-[12px] text-muted">Arguments</div><Code value={s.arguments} /></div>}
          {s.type === "tool_result" && (s.error ? <div><div className="mb-1 text-[12px] text-bad">Error</div><Code value={s.error} className="text-bad" /></div> : <div><div className="mb-1 text-[12px] text-muted">Result</div><Code value={s.result ?? null} className="max-h-72" /></div>)}
          {s.stateDiff && <div><div className="mb-1 text-[12px] text-warn">State change</div><Code value={s.stateDiff} /></div>}
        </div>
      ))}
      {assertions.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] text-muted">Evaluation decisions on this step</div>
          <ul className="space-y-1">
            {assertions.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={a.passed ? "text-ok" : "text-bad"}>{a.passed ? "✓" : "✗"}</span>
                <div className="min-w-0">
                  <div className="text-fg">{a.name}</div>
                  {!a.passed && <div className="text-[12px] text-muted">{a.message}</div>}
                </div>
                {!a.passed && <SeverityBadge s={a.severity} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TraceView() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["trace", id], queryFn: () => api<TraceDetail>(`/traces/${id}`) });
  const nodes = useMemo(() => toNodes(q.data?.steps ?? []), [q.data]);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const s = Number(params.get("step"));
    if (s) setSel(s);
  }, [params]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Page title="Trace"><ErrorBox error={q.error} /></Page>;
  const t = q.data!;
  const d = t.result?.firstDivergence ?? null;
  const failedSteps = new Set(t.steps.filter((s) => s.assertions.some((a) => !a.passed && a.severity !== "low")).map((s) => s.index));
  const selected = t.steps.find((s) => s.index === sel) ?? t.steps[0];
  const select = (i: number) => (setSel(i), setParams({ step: String(i) }, { replace: true }));

  return (
    <Page
      title={<>{t.scenario?.name ?? t.scenarioCode}</>}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <L to={`/scenarios/${t.scenarioCode}`}><Mono>{t.scenarioCode}</Mono></L>
          {t.result && <StatusBadge status={t.result.status} />}
          <Mono className="text-muted">{t.agentVersion} · {t.model} · seed {t.seed}</Mono>
          <span className="text-muted">run <L to={`/runs/${t.runId}`}><Mono>{t.runId.slice(4, 12)}</Mono></L></span>
        </span>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-6">
        {[
          ["Latency", ms(t.totals.latencyMs)],
          ["First response", ms(t.totals.timeToFirstResponseMs)],
          ["Tool latency", ms(t.totals.toolLatencyMs)],
          ["Tokens", `${t.totals.promptTokens} / ${t.totals.completionTokens}`],
          ["Cost", usd(t.totals.costUsd, 5)],
          ["Tool calls", `${t.totals.toolCalls} (${t.totals.toolErrors} err, ${t.totals.retries} retry)`],
        ].map(([l, v]) => (
          <div key={l} className="bg-panel px-3 py-2">
            <div className="text-[12px] text-muted">{l}</div>
            <div className="tabular font-mono text-[13px]">{v}</div>
          </div>
        ))}
      </div>
      {d && <div className="mb-4"><DivergenceCallout d={d} /></div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card title="Execution" className="lg:col-span-3" pad={false}>
          <ol className="py-2 font-mono text-[12px]">
            {nodes.map((n, i) => {
              const head = n.steps[0]!;
              const result = n.steps.find((s) => s.type === "tool_result");
              const changed = n.steps.some((s) => s.type === "state_change");
              const isDiv = d?.traceStep === head.index;
              const bad = n.steps.some((s) => failedSteps.has(s.index));
              const active = n.steps.some((s) => s.index === selected?.index);
              const last = i === nodes.length - 1;
              return (
                <li key={n.key} className="relative pl-7 pr-3">
                  <span className={cx("absolute left-[13px] top-0 w-px bg-line-2", last ? "h-3" : "h-full")} />
                  <span className={cx("absolute left-[9px] top-[9px] size-[9px] rounded-full border", isDiv ? "border-crit bg-crit" : bad ? "border-bad bg-bad/40" : head.type === "user_message" ? "border-accent bg-accent/40" : "border-line-2 bg-panel-2")} />
                  <button onClick={() => select(head.index)} className={cx("my-0.5 w-full rounded px-2 py-1 text-left", active ? "bg-hover" : "hover:bg-hover/60", isDiv && "ring-1 ring-crit/60")}>
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-right text-faint">{head.index}</span>
                      {n.kind === "tool" ? (
                        <>
                          <span className="text-muted">Tool:</span>
                          <span className={cx("text-fg", isDiv && "text-crit")}>{head.tool}</span>
                          {result?.status === "error" && <span className="text-warn">{result.error?.code}</span>}
                          {changed && <span className="font-sans text-warn">changed state</span>}
                          {isDiv && <span className="flex items-center gap-1.5 font-sans text-bad"><ForkMark size={12} className="text-fg-2" />First divergence</span>}
                          <span className="ml-auto text-faint">{ms(result?.durationMs ?? 0)}</span>
                        </>
                      ) : (
                        <>
                          <span className={head.type === "user_message" ? "text-accent" : head.type === "error" ? "text-bad" : "text-fg"}>{ICON[head.type]}</span>
                          {head.acts && head.acts.length > 0 && <span className="truncate text-faint">{head.acts.join(" · ")}</span>}
                          {bad && <span className="text-bad">✗</span>}
                        </>
                      )}
                    </div>
                    {n.kind === "tool" ? (
                      <div className="ml-7 truncate text-faint">({Object.entries(head.arguments ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})</div>
                    ) : (
                      head.content && <div className="ml-7 line-clamp-2 font-sans text-[13px] text-fg-2">{head.content}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title={selected ? `Step ${selected.index} · ${ICON[selected.type] ?? selected.type}` : "Step"}>
            {selected ? <StepDetail step={selected} trace={t} /> : <div className="text-muted">Select a step.</div>}
          </Card>
          {t.result && t.result.judgments.length > 0 && (
            <Card title="Semantic judgments">
              {t.result.judgments.map((j) => (
                <div key={j.criterionId} className="mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-fg">{j.criterionName}</span>
                    <Mono className={j.passed ? "text-ok" : "text-bad"}>{j.score.toFixed(2)}</Mono>
                    <span className="font-mono text-[12px] text-faint">{j.judge} · conf {j.confidence.toFixed(2)}</span>
                  </div>
                  <div className="text-[12px] text-muted">{j.reason}</div>
                </div>
              ))}
            </Card>
          )}
          <details>
            <summary className="cursor-pointer text-muted">World state (initial → final, redacted)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <Code value={t.initialState} className="max-h-60" />
              <Code value={t.finalState} className="max-h-60" />
            </div>
          </details>
        </div>
      </div>
      <div className="mt-2 font-mono text-[12px] text-faint">expected path: {t.result?.expectedTrajectory.map((x) => formatAction(x)).join(" → ")}</div>
    </Page>
  );
}

export function Traces() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview") });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100") });
  const [runId, setRunId] = useState("");
  const rid = runId || overview.data?.latestRun?.id || "";
  const run = useQuery({ queryKey: ["run", rid], queryFn: () => api<RunDetail>(`/evaluations/runs/${rid}`), enabled: !!rid });
  const done = (runs.data ?? []).filter((r) => r.status === "completed");
  return (
    <Page title="Traces" subtitle="Full execution traces: every message, tool call, argument, result, state change, token and evaluator decision" actions={<Select value={rid} onChange={setRunId} options={done.map((r) => ({ value: r.id, label: `${r.agentVersion} · ${humanize(r.mode)} · ${r.id.slice(4, 12)}` }))} className="max-w-[300px]" />}>
      {run.isLoading ? <Loading /> : (
        <Card pad={false}>
          <Table head={["Trace", "Scenario", "Status", "Tool calls", "Latency", "Cost"]}>
            {(run.data?.results ?? []).map((r) => (
              <tr key={r.id}>
                <td><L to={`/traces/${r.traceId}`}><Mono>{r.traceId.slice(4, 14)}</Mono></L></td>
                <td><Mono className="text-muted">{r.scenarioId}</Mono> {r.scenarioName}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="tabular font-mono text-muted">{r.toolCalls}</td>
                <td className="tabular font-mono text-muted">{ms(r.latencyMs)}</td>
                <td className="tabular font-mono text-muted">{usd(r.costUsd)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </Page>
  );
}
