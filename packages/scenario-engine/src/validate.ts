import { RESPONSE_ACTS, ScenarioSpec, type Invariant, type ToolDefinition } from "@rel/core";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  spec?: ScenarioSpec;
}

/** Structural (zod) + semantic validation of a scenario against the tool and invariant libraries. */
export function validateScenario(
  input: unknown,
  tools: Map<string, ToolDefinition>,
  invariants: Map<string, Invariant>,
): ValidationReport {
  const parsed = ScenarioSpec.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`), warnings: [] };
  }
  const s = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const avail = new Set(s.availableTools);

  for (const t of s.availableTools) if (!tools.has(t)) errors.push(`availableTools: unknown tool "${t}"`);
  for (const step of s.expectedTrajectory) {
    if (step.action.startsWith("respond:")) {
      if (!(RESPONSE_ACTS as readonly string[]).includes(step.action.slice(8))) errors.push(`expectedTrajectory: unknown response act "${step.action}"`);
    } else if (!avail.has(step.action)) errors.push(`expectedTrajectory: "${step.action}" is not in availableTools`);
    if (s.forbiddenActions.includes(step.action)) errors.push(`"${step.action}" is both expected and forbidden`);
  }
  for (const f of s.forbiddenActions)
    if (!f.startsWith("respond:") && !avail.has(f)) warnings.push(`forbiddenActions: "${f}" is not exposed to the agent, so this check is vacuous`);
  for (const r of s.invariantRefs) if (!invariants.has(r)) errors.push(`invariantRefs: unknown invariant "${r}"`);
  for (const f of s.toolFaults) if (!avail.has(f.tool)) errors.push(`toolFaults: "${f.tool}" is not in availableTools`);
  for (const inv of s.invariants) if (invariants.has(inv.id)) warnings.push(`inline invariant ${inv.id} shadows the library invariant with the same id`);
  if (Object.keys(s.context).length === 0) warnings.push("context is empty — tools will have no data to operate on");
  if (s.expectedTrajectory.length === 0) warnings.push("no expectedTrajectory — trajectory/first-divergence checks are disabled");
  const o = s.expectedOutcome;
  const outcomeChecks = o.finalState.length + o.requiredActs.length + o.forbiddenActs.length + o.mustMention.length + o.mustNotMention.length + (o.escalationRequired ? 1 : 0);
  if (outcomeChecks === 0) warnings.push("expectedOutcome defines no checkable conditions — outcome correctness is unchecked");

  return { valid: errors.length === 0, errors, warnings, spec: s };
}
