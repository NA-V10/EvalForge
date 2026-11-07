import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, type FailureDetail } from "../lib/api";
import { humanize } from "../lib/format";
import { DivergenceCallout, TrajectoryCompare } from "../components/Trajectory";
import { Card, ErrorBox, L, Loading, Mono, Page, SeverityBadge, StatusBadge, Tag, cx, primaryLink, secondaryLink } from "../components/ui";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1 text-[12px] font-medium text-muted">{children}</div>;

export function FailureDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["failure", id], queryFn: () => api<FailureDetail>(`/failures/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Page title="Failure"><ErrorBox error={q.error} /></Page>;
  const f = q.data!;
  const traceId = f.result?.traceId;

  return (
    <Page
      title={f.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <SeverityBadge s={f.severity} label={`${cap(f.severity)} failure`} />
          <Tag>{cap(humanize(f.category))}</Tag>
          <Tag>{cap(humanize(f.subcategory))}</Tag>
          {f.regression && <Tag tone="bad">Regression</Tag>}
          <span className="text-muted">
            <Mono>{f.agentVersion}</Mono> · run <L to={`/runs/${f.runId}`}><Mono>{f.runId.slice(4, 12)}</Mono></L>
          </span>
        </span>
      }
      actions={traceId && <Link to={`/traces/${traceId}${f.firstDivergenceStep ? `?step=${f.firstDivergenceStep}` : ""}`} className={secondaryLink}>Open trace</Link>}
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          {f.scenario && (
            <Card>
              <Label>Scenario</Label>
              <div className="flex items-center gap-2">
                <L to={`/scenarios/${f.scenario.id}`}><Mono>{f.scenario.id}</Mono></L>
                <span className="text-fg">{f.scenario.name}</span>
                <SeverityBadge s={f.scenario.severity} />
              </div>
              <div className="mt-1 text-fg-2">{f.scenario.description}</div>
            </Card>
          )}
          {f.firstDivergence && <DivergenceCallout d={f.firstDivergence} />}
          {f.result && (
            <Card title="Trajectory">
              <TrajectoryCompare expected={f.result.expectedTrajectory} actual={f.result.actualTrajectory} divergence={f.firstDivergence} traceId={f.result.traceId} />
            </Card>
          )}
          <Card title="Expected vs actual">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>Expected</Label>
                <pre className="whitespace-pre-wrap font-mono text-[12px] text-fg">{f.expectedBehavior}</pre>
              </div>
              <div>
                <Label>Actual</Label>
                <pre className="whitespace-pre-wrap font-mono text-[12px] text-bad">{f.actualBehavior}</pre>
              </div>
            </div>
          </Card>
          <Card title={`Evidence (${f.evidence.length})`} pad={false}>
            <ul className="divide-y divide-line/70">
              {f.evidence.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                  {e.traceStep && traceId ? (
                    <L to={`/traces/${traceId}?step=${e.traceStep}`} className="shrink-0"><Mono className="text-fg">step {e.traceStep}</Mono></L>
                  ) : (
                    <Mono className="shrink-0 text-faint">fact</Mono>
                  )}
                  <div className="min-w-0">
                    <div className="text-fg">{e.explanation}</div>
                    {e.fact && <div className="mt-0.5 font-mono text-[12px] text-muted">{e.fact.path} = {JSON.stringify(e.fact.value)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          {f.violatedInvariant && (
            <Card>
              <Label>Violated invariant</Label>
              <Mono className="text-[14px] text-fg">{f.violatedInvariant.id}</Mono>
              <div className="mt-1 text-fg">"{f.violatedInvariant.name}"</div>
              <div className="mt-1 text-muted">{f.violatedInvariant.description}</div>
            </Card>
          )}
          <Card>
            <Label>Regression</Label>
            <ul className="space-y-1">
              {f.history.map((h) => (
                <li key={h.runId} className={cx("flex items-center gap-3", h.version === f.agentVersion && "font-medium")}>
                  <Mono className="w-16">{h.version}</Mono>
                  <StatusBadge status={h.status} />
                  <L to={`/runs/${h.runId}`} className="text-[12px] text-muted">run</L>
                </li>
              ))}
            </ul>
            {f.regression && f.previousPassingVersion && (
              <div className="mt-2 text-bad">
                Passed in <Mono>{f.previousPassingVersion}</Mono>, fails in <Mono>{f.agentVersion}</Mono>
              </div>
            )}
            {!f.regression && <div className="mt-2 text-muted">Pre-existing failure (not introduced by this version).</div>}
          </Card>
          <Card>
            <Label>Likely cause</Label>
            <div className="text-fg">{f.likelyCause}</div>
          </Card>
          <Card className="border-accent/40">
            <Label>Recommended fix</Label>
            <div className="text-fg">{f.recommendation}</div>
          </Card>
          <div className="font-mono text-[12px] text-faint">fingerprint {f.fingerprint}</div>
        </div>
      </div>
    </Page>
  );
}
