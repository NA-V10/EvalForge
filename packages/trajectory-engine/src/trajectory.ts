import type { ActualAction, Trace, ToolDefinition } from "@rel/core";

export const isRespond = (action: string) => action.startsWith("respond:");

/**
 * Flatten a trace into the observable action sequence: tool calls (with outcome) and
 * response acts (classified by the platform, stored on agent/final message steps).
 */
export function extractTrajectory(trace: Trace, tools: Map<string, ToolDefinition>): ActualAction[] {
  const out: ActualAction[] = [];
  for (const s of trace.steps) {
    if (s.type === "tool_call" && s.tool) {
      const result = trace.steps.find((r) => r.type === "tool_result" && r.callId === s.callId);
      out.push({
        action: s.tool,
        traceStep: s.index,
        status: result?.status ?? "error",
        destructive: tools.get(s.tool)?.destructive ?? false,
      });
    } else if ((s.type === "agent_message" || s.type === "final_response") && s.acts) {
      for (const act of s.acts) out.push({ action: `respond:${act}`, traceStep: s.index, destructive: false });
    }
  }
  return out;
}

export function formatAction(a: string | null): string {
  if (!a) return "(end of conversation)";
  return isRespond(a) ? `respond: ${a.slice(8).replace(/_/g, " ")}` : `${a}()`;
}
