import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  AlertTriangle,
  Boxes,
  ChevronsLeftRight,
  FlaskConical,
  GitCompare,
  Gauge,
  LayoutDashboard,
  ListTree,
  Menu,
  Settings,
  ShieldCheck,
  Shuffle,
  Waypoints,
  Bot,
  Target,
  Layers,
} from "lucide-react";
import { api } from "../lib/api";
import { CommandPalette } from "./CommandPalette";
import { cx, ForkMark, Kbd } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  key?: string;
}
const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "Overview", icon: <LayoutDashboard size={16} strokeWidth={1.5} />, key: "o" }] },
  {
    section: "Agents",
    items: [
      { to: "/agents", label: "Agent list", icon: <Bot size={16} strokeWidth={1.5} />, key: "a" },
      { to: "/agents/versions", label: "Versions", icon: <Layers size={16} strokeWidth={1.5} /> },
      { to: "/compare", label: "Compare", icon: <GitCompare size={16} strokeWidth={1.5} />, key: "c" },
    ],
  },
  {
    section: "Scenarios",
    items: [
      { to: "/scenarios", label: "All scenarios", icon: <ListTree size={16} strokeWidth={1.5} />, key: "s" },
      { to: "/scenario-sets", label: "Scenario sets", icon: <Boxes size={16} strokeWidth={1.5} /> },
      { to: "/mutations", label: "Mutations", icon: <Shuffle size={16} strokeWidth={1.5} /> },
      { to: "/coverage", label: "Coverage", icon: <Target size={16} strokeWidth={1.5} /> },
    ],
  },
  {
    section: "Evaluations",
    items: [
      { to: "/runs", label: "Runs", icon: <FlaskConical size={16} strokeWidth={1.5} />, key: "r" },
      { to: "/regression", label: "Regression", icon: <ChevronsLeftRight size={16} strokeWidth={1.5} /> },
      { to: "/release-gates", label: "Release gates", icon: <ShieldCheck size={16} strokeWidth={1.5} />, key: "g" },
    ],
  },
  {
    section: "Failures",
    items: [
      { to: "/failures", label: "All failures", icon: <AlertTriangle size={16} strokeWidth={1.5} />, key: "f" },
      { to: "/failures?severity=critical", label: "Critical", icon: <AlertTriangle size={16} strokeWidth={1.5} /> },
      { to: "/failures?regression=true", label: "Regressions", icon: <AlertTriangle size={16} strokeWidth={1.5} /> },
    ],
  },
  {
    items: [
      { to: "/traces", label: "Traces", icon: <Waypoints size={16} strokeWidth={1.5} />, key: "t" },
      { to: "/metrics", label: "Metrics", icon: <Gauge size={16} strokeWidth={1.5} />, key: "m" },
      { to: "/settings", label: "Settings", icon: <Settings size={16} strokeWidth={1.5} /> },
    ],
  },
];
export const NAV_ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.section })));

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useQuery({ queryKey: ["system"], queryFn: () => api<{ judge: string; judgeOffline: boolean; database: string }>("/system/metrics"), refetchInterval: 30_000 });
  return (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-5">
        <ForkMark size={16} className="text-accent" />
        <span className="text-[15px] font-medium">ReliabilityOS</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((s, i) => (
          <div key={i} className={s.section ? "mt-6 first:mt-0" : i === 0 ? "" : "mt-6"}>
            {s.section && <div className="mb-2 px-2 text-[12px] text-muted">{s.section}</div>}
            {s.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/" || it.to === "/agents"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    "group mt-0.5 flex h-8 items-center gap-2.5 rounded-lg px-2 text-[14px]",
                    isActive && !it.to.includes("?") ? "bg-hover text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-fg-2 hover:bg-hover/60 hover:text-fg",
                  )
                }
              >
                <span className="flex w-4 justify-center text-muted">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.key && (
                  <span className="hidden gap-0.5 group-hover:flex">
                    <Kbd>G</Kbd>
                    <Kbd>{it.key.toUpperCase()}</Kbd>
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-line px-5 py-4 text-[12px] text-muted">
        <div className="flex justify-between gap-2" title="Semantic judge provider">
          <span>Judge</span>
          <span className="truncate font-mono text-fg-2">{data ? (data.judgeOffline ? "heuristic (offline)" : data.judge) : "…"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Database</span>
          <span className="font-mono text-fg-2">{data?.database ?? "…"}</span>
        </div>
      </div>
    </nav>
  );
}

export function Layout() {
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (pendingG) {
        const item = NAV_ITEMS.find((i) => i.key === e.key);
        pendingG = false;
        if (item) navigate(item.to);
        return;
      }
      if (e.key === "g") {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => (pendingG = false), 900);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-[248px] shrink-0 border-r border-line bg-sidebar md:block">
        <Sidebar />
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileNav(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute inset-y-0 left-0 w-[248px] border-r border-line bg-sidebar" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 md:px-8">
          <button className="rounded-lg p-1.5 text-muted hover:bg-hover md:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
            <Menu size={16} />
          </button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-8 w-full max-w-[400px] items-center gap-2 rounded-lg border border-line bg-panel px-3 text-left text-[13px] text-muted hover:border-line-2"
          >
            <Search size={16} strokeWidth={1.5} />
            <span className="flex-1 truncate">Search</span>
            <Kbd>Ctrl K</Kbd>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
