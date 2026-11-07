import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type FailureRow, type RunRow, type ScenarioIndexRow } from "../lib/api";
import { NAV_ITEMS } from "./Layout";
import { cx } from "./ui";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  to: string;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const scenarios = useQuery({ queryKey: ["scenarios", true], queryFn: () => api<{ scenarios: ScenarioIndexRow[] }>("/scenarios?mutations=true") });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs") });
  const failures = useQuery({ queryKey: ["failures", "palette"], queryFn: () => api<FailureRow[]>("/failures?severity=critical") });

  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...NAV_ITEMS.map((n) => ({ id: `nav:${n.to}`, group: "Go to", label: n.section ? `${n.section} › ${n.label}` : n.label, to: n.to })),
      { id: "act:new", group: "Actions", label: "Create scenario", hint: "builder + compiler", to: "/scenarios/new" },
      { id: "act:run", group: "Actions", label: "Run evaluation", to: "/runs?new=1" },
      { id: "act:gate", group: "Actions", label: "Run release gate", to: "/release-gates" },
      ...(scenarios.data?.scenarios ?? []).map((s) => ({ id: `scn:${s.code}`, group: "Scenarios", label: `${s.code} ${s.name}`, hint: s.category, to: `/scenarios/${s.code}` })),
      ...(runs.data ?? []).slice(0, 20).map((r) => ({ id: `run:${r.id}`, group: "Runs", label: `${r.agentVersion} · ${r.mode} · ${r.id}`, hint: r.status, to: `/runs/${r.id}` })),
      ...(failures.data ?? []).slice(0, 30).map((f) => ({ id: `fail:${f.id}`, group: "Critical failures", label: `${f.scenarioCode} ${f.title}`, hint: f.agentVersion, to: `/failures/${f.id}` })),
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((i) => terms.every((t) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(t))).slice(0, 60);
  }, [q, scenarios.data, runs.data, failures.data]);

  useEffect(() => setSel(0), [q]);

  const go = (i: Item | undefined) => {
    if (!i) return;
    navigate(i.to);
    onClose();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-line-2 bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            else if (e.key === "Enter") go(items[sel]);
          }}
          placeholder="Type a command or search…"
          className="h-11 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-faint"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((it, idx) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id}>
                {header && <div className="px-3 pb-1 pt-2 text-[12px] font-medium text-faint">{header}</div>}
                <button
                  onMouseEnter={() => setSel(idx)}
                  onClick={() => go(it)}
                  className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left", idx === sel ? "bg-hover text-fg" : "text-fg-2")}
                >
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="font-mono text-[12px] text-muted">{it.hint}</span>}
                </button>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-3 py-6 text-center text-muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
