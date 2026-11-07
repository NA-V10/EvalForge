import { z } from "zod";

/**
 * Behaviour profile of the built-in demo agent. Each flag corresponds to a real implementation
 * difference in the agent's control flow — the evaluator has no access to these flags.
 */
export const BehaviorProfile = z.object({
  model: z.string(),
  /** Base model latency (ms) and per-output-token latency. */
  baseLatencyMs: z.number(),
  msPerToken: z.number(),
  systemPromptTokens: z.number(),
  checkRefundBeforeCancel: z.boolean(),
  retryTransientErrors: z.boolean(),
  honestOnFailure: z.boolean(),
  injectionGuard: z.boolean(),
  trustClaimedVerification: z.boolean(),
  escalateLegalThreats: z.boolean(),
  revealAddressInStatus: z.boolean(),
  preloadCustomerProfile: z.boolean(),
  checkRequesterRole: z.boolean(),
  capRefundAtOrderTotal: z.boolean(),
});
export type BehaviorProfile = z.infer<typeof BehaviorProfile>;

/** $ per 1M tokens for the simulated models used by the demo agent. */
export const DEMO_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "support-llm-large": { input: 3, output: 15 },
  "support-llm-small": { input: 0.8, output: 4 },
};

export const DEMO_PROFILES: Record<string, BehaviorProfile> = {
  "v1.0.0": {
    model: "support-llm-large",
    baseLatencyMs: 720,
    msPerToken: 11,
    systemPromptTokens: 1450,
    checkRefundBeforeCancel: false,
    retryTransientErrors: false,
    honestOnFailure: false,
    injectionGuard: false,
    trustClaimedVerification: false,
    escalateLegalThreats: true,
    revealAddressInStatus: true,
    preloadCustomerProfile: false,
    checkRequesterRole: true,
    capRefundAtOrderTotal: true,
  },
  "v1.1.0": {
    model: "support-llm-small",
    baseLatencyMs: 410,
    msPerToken: 6,
    systemPromptTokens: 1780,
    checkRefundBeforeCancel: true,
    retryTransientErrors: true,
    honestOnFailure: true,
    injectionGuard: true,
    // Regression: "streamlined verification" trusts customers who say they already verified.
    trustClaimedVerification: true,
    // Regression: new de-escalation prompt stops creating tickets for legal threats.
    escalateLegalThreats: false,
    revealAddressInStatus: false,
    preloadCustomerProfile: true,
    checkRequesterRole: true,
    capRefundAtOrderTotal: true,
  },
};
