import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api, post, type AgentRow, type AssertionRow, type FailureRow, type ScenarioDetailView } from "../lib/api";
import { formatAction, humanize } from "../lib/format";
import { useScenarioIndex } from "./Scenarios";
import { DivergenceCallout, TrajectoryCompare } from "../components/Trajectory";
import { Button, Card, Code, ErrorBox, L, Loading, Mono, Page, SeverityBadge, StatusBadge, Tag, cx } from "../components/ui";

interface ResultView {
  id: string;
  runId: string;
  status: string;
  traceId: string;
  firstDivergence: import("../lib/api").FirstDivergence | null;
  expectedTrajectory: string[];
  actualTrajectory: import("../lib/api").ActualAction[];
  assertions: AssertionRow[];
  failures: FailureRow[];
}

export function ScenarioDetail() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["scenario", code], queryFn: () => api<ScenarioDetailView & { invariants: { rule: string }[] }>(`/scenarios/${code}`) });
  const index = useScenarioIndex(true);
  const latest = index.data?.scenarios.find((x) => x.code === code)?.latest;
  const result = useQuery({ queryKey: ["result", latest?.resultId], queryFn: () => api<ResultView>(`/results/${latest!.resultId}`), enabled: !!latest?.resultId });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<AgentRow[]>("/agents") });
  const run = useMutation({
    mutationFn: () => {
      const a = agents.data![0]!;
      return post<{ id: string }>("/evaluations/run", { agent: a.slug, version: a.versions.at(-1)!.version, mode: "selected", scenarios: [code], label: `single: ${code}` });
    },
    onSuccess: (r) => navigate(`/runs/${r.id}`),
  });
  const mutate = useMutation({
    mutationFn: () => post<{ mutations: unknown[] }>("/mutations/generate", { scenario: code, persist: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenario", code] });
      qc.invalidateQueries({ queryKey: ["scenarios"] });
    },
  });

  if (s.isLoading) return <Loading />;
  if (s.error) return <Page title={code}><ErrorBox error={s.error} /></Page>;
  const d = s.data!;
  const spec = d.spec;
  const invs = d.invariants as (typeof d.invariants[number] & { rule: string })[];

  return (
    <Page
      title={<span>{d.name}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Mono>{d.code}</Mono>
          <SeverityBadge s={d.severity} />
          <Tag>{humanize(d.category)}</Tag>
          <Tag>{humanize(d.domain)}</Tag>
          <span className="text-muted">version {d.currentVersion}</span>
          {spec.mutation && (
            <span>
              mutation of <L to={`/scenarios/${spec.mutation.parentId}`}><Mono>{spec.mutation.parentId}</Mono></L>
            </span>
          )}
        </span>
      }
      actions={
        <>
          <Button onClick={() => mutate.mutate()} disabled={mutate.isPending || !!spec.mutation}>
            {mutate.isPending ? "Generating…" : "Generate mutations"}
          </Button>
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending || !agents.data?.length}>
            Run this scenario
          </Button>
        </>
      }
    >
      {(run.error || mutate.error) && <div className="mb-3"><ErrorBox error={run.error ?? mutate.error} /></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Scenario">
            <p className="text-fg-2">{spec.description}</p>
            <div className="mt-3 text-[12px] text-muted">User</div>
            <blockquote className="mt-1 border-l-2 border-accent/50 pl-2.5 text-fg">{spec.userInput}</blockquote>
            {spec.turns.map((t, i) => (
              <blockquote key={i} className="mt-1.5 border-l-2 border-line-2 pl-2.5 text-fg-2">
                {t.message} {t.onlyIfAsked && <span className="text-[12px] text-faint">(if asked)</span>}
              </blockquote>
            ))}
            {spec.toolFaults.length > 0 && (
              <div className="mt-3">
                <div className="text-[12px] text-muted">Injected faults</div>
                <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-warn">
                  {spec.toolFaults.map((f, i) => <li key={i}>{f.tool} → {f.mode}{f.statusCode ? ` ${f.statusCode}` : ""}{f.latencyMs ? ` ${f.latencyMs}ms` : ""}</li>)}
                </ul>
              </div>
            )}
          </Card>
          <Card title="Expected behavior">
            <ol className="space-y-1">
              {spec.expectedTrajectory.map((st, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 text-right font-mono text-faint">{i + 1}</span>
                  <span className="font-mono text-[12px] text-fg">{formatAction(st.action)}</span>
                  {st.optional && <span className="text-[12px] text-faint">Optional</span>}
                  {st.description && <span className="truncate text-muted">— {st.description}</span>}
                </li>
              ))}
            </ol>
            <div className="mt-3 text-fg-2">{spec.expectedOutcome.summary}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {spec.expectedOutcome.requiredActs.map((a) => <Tag key={a} tone="ok">must {humanize(a)}</Tag>)}
              {spec.expectedOutcome.forbiddenActs.map((a) => <Tag key={a} tone="bad">never {humanize(a)}</Tag>)}
              {spec.forbiddenActions.map((a) => <Tag key={a} tone="bad">forbidden {a}()</Tag>)}
              {spec.expectedOutcome.escalationRequired && <Tag tone="warn">escalation required</Tag>}
            </div>
          </Card>
          <Card title="Invariants">
            <ul className="space-y-2.5">
              {invs.map((i) => (
                <li key={i.id}>
                  <div className="flex items-center gap-2">
                    <Mono className="text-fg">{i.id}</Mono>
                    <SeverityBadge s={i.severity} />
                    <span className="text-[12px] text-muted">{i.kind}</span>
                  </div>
                  <div className="mt-0.5 text-fg">{i.name}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px] text-muted">{i.rule}</pre>
                </li>
              ))}
              <li className="border-t border-line pt-2 text-muted">
                + global: {d.globalInvariants.map((g) => <Mono key={g.id} className="mr-2 text-fg-2">{g.id}</Mono>)}
              </li>
            </ul>
          </Card>
          <Card title="World state (context)">
            <Code value={spec.context} className="max-h-72" />
            <div className="mt-2 flex flex-wrap gap-1">{spec.availableTools.map((t) => <Tag key={t}>{t}</Tag>)}</div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-3">
          <Card
            title={`Latest evaluation${index.data?.agentVersion ? ` · ${index.data.agentVersion}` : ""}`}
            actions={latest && <Link to={`/traces/${latest.traceId}`} className="text-[12px] text-accent">open trace →</Link>}
          >
            {!latest ? (
              <div className="text-muted">Not evaluated yet.</div>
            ) : !result.data ? (
              <Loading />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={result.data.status} />
                  <span className="text-muted">run</span> <L to={`/runs/${result.data.runId}`}><Mono>{result.data.runId}</Mono></L>
                </div>
                {result.data.firstDivergence && <DivergenceCallout d={result.data.firstDivergence} />}
                <TrajectoryCompare expected={result.data.expectedTrajectory} actual={result.data.actualTrajectory} divergence={result.data.firstDivergence} traceId={result.data.traceId} />
                {result.data.failures.length > 0 && (
                  <div>
                    <div className="mb-1 text-[12px] text-muted">Failures</div>
                    <ul className="space-y-1">
                      {result.data.failures.map((f) => (
                        <li key={f.id} className="flex items-center gap-2">
                          <SeverityBadge s={f.severity} />
                          <L to={`/failures/${f.id}`}>{f.title}</L>
                          {f.regression && <Tag tone="bad">Regression</Tag>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <AssertionList items={result.data.assertions} />
              </div>
            )}
          </Card>
          {d.mutations.length > 0 && (
            <Card title={`Mutations (${d.mutations.length})`} pad={false}>
              <ul className="divide-y divide-line/70">
                {d.mutations.map((m) => {
                  const st = index.data?.scenarios.find((x) => x.code === m.childCode)?.latest?.status;
                  return (
                    <li key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                      <Tag tone="accent">{humanize(m.strategy)}</Tag>
                      <L to={`/scenarios/${m.childCode}`}><Mono>{m.childCode}</Mono></L>
                      <span className="truncate text-muted">{m.description}</span>
                      <span className="ml-auto"><StatusBadge status={st} /></span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

export function AssertionList({ items }: { items: AssertionRow[] }) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const sorted = [...items].sort((a, b) => Number(a.passed) - Number(b.passed) || order[a.severity] - order[b.severity]);
  return (
    <div>
      <div className="mb-1 text-[12px] text-muted">
        Assertions · {items.filter((a) => a.passed).length}/{items.length} passed
      </div>
      <ul className="divide-y divide-line/60 rounded border border-line">
        {sorted.map((a) => (
          <li key={a.id} className="flex items-start gap-2 px-2 py-1.5">
            <span className={cx("mt-0.5 font-mono text-[12px]", a.passed ? "text-ok" : a.severity === "low" ? "text-warn" : "text-bad")}>{a.passed ? "✓" : "✗"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={a.passed ? "text-fg-2" : "text-fg"}>{a.name}</span>
                <span className="font-mono text-[12px] text-faint">{a.layer} · {a.dimension}</span>
                {a.hardGate && !a.passed && <Tag tone="bad">Hard gate</Tag>}
              </div>
              {!a.passed && <div className="mt-0.5 text-[12px] text-muted">{a.message}</div>}
            </div>
            {!a.passed && <SeverityBadge s={a.severity} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
