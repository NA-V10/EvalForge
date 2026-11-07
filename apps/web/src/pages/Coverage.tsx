import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { humanize } from "../lib/format";
import { PassBar } from "../components/charts";
import { Card, ErrorBox, Loading, Mono, Page, SeverityBadge, Table, Tag, cx } from "../components/ui";

interface CoverageData {
  runId: string | null;
  agentVersion: string | null;
  categories: { category: string; scenarios: number; evaluated: number; passed: number }[];
  tools: { name: string; destructive: boolean; inScenarios: number; forbiddenIn: number; faultInjected: number; exercised: boolean }[];
  invariants: { id: string; name: string; severity: "critical" | "high" | "medium" | "low"; global: boolean; referencedBy: number; evaluated: number; violated: number }[];
  failureModes: { category: string; observed: number }[];
  mutations: { strategy: string; scenarios: number }[];
  domains: { domain: string; scenarios: number }[];
}

export function Coverage() {
  const q = useQuery({ queryKey: ["coverage"], queryFn: () => api<CoverageData>("/coverage") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Page title="Coverage"><ErrorBox error={q.error} /></Page>;
  const d = q.data!;
  const gaps = [
    ...d.categories.filter((c) => c.scenarios === 0).map((c) => `No ${humanize(c.category)} scenarios`),
    ...d.tools.filter((t) => t.destructive && t.forbiddenIn === 0).map((t) => `Destructive ${t.name} is never tested as forbidden`),
    ...d.tools.filter((t) => t.faultInjected === 0 && !t.destructive && t.inScenarios > 0).map((t) => `${t.name} never fault-injected`),
    ...d.invariants.filter((i) => i.evaluated === 0).map((i) => `${i.id} never exercised`),
  ];
  return (
    <Page title="Coverage" subtitle={<>Coverage by behavior, not by count{d.agentVersion && <> · results from <Mono>{d.agentVersion}</Mono></>}.</>}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Scenario categories" pad={false}>
          <Table head={["Category", "Scenarios", "Passing (latest)"]}>
            {d.categories.map((c) => (
              <tr key={c.category}>
                <td className="text-fg-2">{humanize(c.category)}</td>
                <td className="tabular font-mono">{c.scenarios}</td>
                <td>{c.evaluated ? <PassBar passed={c.passed} total={c.evaluated} /> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Coverage gaps (${gaps.length})`}>
          {gaps.length === 0 ? <div className="text-ok">No structural gaps detected.</div> : <ul className="list-disc space-y-0.5 pl-5 text-warn">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
          <div className="mt-4 text-[12px] text-muted">Domains</div>
          <div className="mt-1 flex flex-wrap gap-1">{d.domains.map((x) => <Tag key={x.domain}>{humanize(x.domain)} · {x.scenarios}</Tag>)}</div>
          <div className="mt-4 text-[12px] text-muted">Mutation strategies</div>
          <div className="mt-1 flex flex-wrap gap-1">{d.mutations.map((x) => <Tag key={x.strategy} tone={x.scenarios ? "accent" : "default"}>{humanize(x.strategy)} · {x.scenarios}</Tag>)}</div>
        </Card>
        <Card title="Tools tested" pad={false}>
          <Table head={["Tool", "In scenarios", "Forbidden in", "Fault-injected", "Exercised"]}>
            {d.tools.map((t) => (
              <tr key={t.name}>
                <td><Mono>{t.name}</Mono> {t.destructive && <Tag tone="warn">Destructive</Tag>}</td>
                <td className="tabular font-mono">{t.inScenarios}</td>
                <td className="tabular font-mono">{t.forbiddenIn}</td>
                <td className="tabular font-mono">{t.faultInjected}</td>
                <td className={t.exercised ? "text-ok" : "text-faint"}>{t.exercised ? "yes" : "no"}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="Invariants tested" pad={false}>
            <Table head={["Invariant", "Severity", "Scope", "Evaluated", "Violated"]}>
              {d.invariants.map((i) => (
                <tr key={i.id}>
                  <td><Mono className="text-fg">{i.id}</Mono> <span className="text-fg-2">{i.name}</span></td>
                  <td><SeverityBadge s={i.severity} /></td>
                  <td className="text-muted">{i.global ? "global" : `${i.referencedBy} scenarios`}</td>
                  <td className="tabular font-mono">{i.evaluated}</td>
                  <td className={cx("tabular font-mono", i.violated ? "text-bad" : "text-faint")}>{i.violated}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Failure modes observed">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {d.failureModes.map((f) => (
                <div key={f.category} className="flex justify-between">
                  <span className="text-fg-2">{humanize(f.category)}</span>
                  <Mono className={f.observed ? "text-bad" : "text-faint"}>{f.observed}</Mono>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
