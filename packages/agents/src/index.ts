export * from "./profile";
export * from "./nlu";
export * from "./support-agent";
export * from "./adapters";

import { DEMO_MODEL_PRICING } from "./profile";

/** Pricing for every model the platform can attribute cost to ($ per 1M tokens). */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  ...DEMO_MODEL_PRICING,
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
