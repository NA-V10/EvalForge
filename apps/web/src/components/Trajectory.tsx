import { Link } from "react-router";
import type { ActualAction, FirstDivergence } from "../lib/api";
import { formatAction } from "../lib/format";
import { ForkMark, cx } from "./ui";

/**
 * Expected vs actual trajectory with the first divergence marked by the fork.
 * This is the product's core moment: the answer can look fine while the path is unsafe.
 */
export function TrajectoryCompare({
  expected,
  actual,
  divergence,
  traceId,
}: {
  expected: string[];
  actual: ActualAction[];
  divergence: FirstDivergence | null;
  traceId?: string;
}) {
  const divPos = divergence?.position ?? null;
  const row = "flex h-8 items-center gap-3 rounded-lg px-3 font-mono text-[12px]";

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 text-[12px] text-muted">Expected</div>
        <ol className="space-y-1">
          {expected.map((e, i) => {
            const isDiv = divergence?.expected && e.replace(/\?$/, "") === divergence.expected;
            return (
              <li key={i} className={cx(row, isDiv ? "bg-accent/10 text-fg ring-1 ring-accent/30 ring-inset" : "bg-bg text-fg-2")}>
                <span className="w-4 text-right text-faint">{i + 1}</span>
                <span className="truncate">{formatAction(e)}</span>
                {e.endsWith("?") && <span className="ml-auto font-sans text-faint">optional</span>}
              </li>
            );
          })}
          {expected.length === 0 && <li className="text-[13px] text-muted">No expected trajectory defined</li>}
        </ol>
      </div>
      <div>
        <div className="mb-2 text-[12px] text-muted">Actual</div>
        <ol className="space-y-1">
          {actual.map((a, idx) => {
            const position = idx + 1;
            const isDiv = divPos === position;
            const after = divPos !== null && position > divPos;
            const inner = (
              <>
                {isDiv ? <ForkMark className="text-fg-2" /> : <span className="w-4 text-right text-faint">{position}</span>}
                <span className={cx("truncate", isDiv && "text-bad")}>{formatAction(a.action)}</span>
                {a.status === "error" && <span className="font-sans text-warn">error</span>}
                {a.destructive && <span className="shrink-0 font-sans text-muted">destructive</span>}
                <span className="ml-auto shrink-0 whitespace-nowrap text-faint">step {a.traceStep}</span>
              </>
            );
            const cls = cx(row, isDiv ? "bg-bad/10 ring-1 ring-bad/30 ring-inset text-fg" : after ? "bg-bg text-faint" : "bg-bg text-fg-2");
            return (
              <li key={position}>
                {traceId ? (
                  <Link to={`/traces/${traceId}?step=${a.traceStep}`} className={cx(cls, "hover:bg-hover")}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
          {divergence && divergence.actual === null && (
            <li className={cx(row, "bg-bad/10 text-fg ring-1 ring-bad/30 ring-inset")}>
              <ForkMark className="text-fg-2" />
              <span className="text-bad">Conversation ended</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

export function DivergenceCallout({ d }: { d: FirstDivergence }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ForkMark size={16} className="text-fg-2" />
        <span className="text-[14px] font-medium text-fg">First divergence at position {d.position}</span>
        {d.traceStep && <span className="text-[13px] text-muted">trace step {d.traceStep}</span>}
        <span className="text-[13px] text-muted">{d.kind.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-4 grid grid-cols-[72px_1fr] gap-x-4 gap-y-2 font-mono text-[13px]">
        <span className="font-sans text-[13px] text-muted">Expected</span>
        <span className="text-fg">{formatAction(d.expected)}</span>
        <span className="font-sans text-[13px] text-muted">Actual</span>
        <span className="text-bad">{formatAction(d.actual)}</span>
      </div>
      <div className="mt-4 text-[13px] text-fg-2">{d.reason.replace(/\.$/, "")}</div>
    </div>
  );
}
