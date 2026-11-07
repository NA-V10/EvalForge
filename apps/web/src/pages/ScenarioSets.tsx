import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useScenarioIndex } from "./Scenarios";
import { Card, Empty, L, Loading, Mono, Page, StatusBadge, Tag } from "../components/ui";

interface SetRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  codes: string[];
}

export function ScenarioSets() {
  const sets = useQuery({ queryKey: ["sets"], queryFn: () => api<SetRow[]>("/scenario-sets") });
  const index = useScenarioIndex(true);
  if (sets.isLoading) return <Loading />;
  const status = (c: string) => index.data?.scenarios.find((s) => s.code === c)?.latest?.status;
  return (
    <Page title="Scenario sets" subtitle="Named suites. The regression suite is what CI runs on every agent change (reliability eval run --suite <slug>).">
      <div className="space-y-4">
        {(sets.data ?? []).map((s) => {
          const passing = s.codes.filter((c) => status(c) === "passed").length;
          return (
            <Card key={s.id} title={<span className="normal-case tracking-normal text-fg">{s.name} <Mono className="text-muted">· {s.slug}</Mono></span>} actions={<Tag tone={s.kind === "regression" ? "accent" : "default"}>{s.kind}</Tag>}>
              <div className="mb-2 text-fg-2">{s.description}</div>
              <div className="mb-2 text-muted">{s.codes.length} scenarios · {passing} passing in latest run</div>
              <div className="flex flex-wrap gap-1.5">
                {s.codes.map((c) => (
                  <L key={c} to={`/scenarios/${c}`} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5">
                    <Mono className="text-[12px]">{c}</Mono>
                    <StatusBadge status={status(c)} />
                  </L>
                ))}
              </div>
            </Card>
          );
        })}
        {sets.data?.length === 0 && <Card><Empty title="No scenario sets" hint="Create one with POST /api/scenario-sets." /></Card>}
      </div>
    </Page>
  );
}
