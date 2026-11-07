import { AnthropicProvider } from "./anthropic";
import { HeuristicProvider } from "./heuristic";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { LLMProvider } from "./types";

export * from "./types";
export * from "./judge-prompt";
export { AnthropicProvider } from "./anthropic";
export { OpenAICompatibleProvider } from "./openai-compatible";
export { HeuristicProvider, extractClaims, hashEmbed, cosine } from "./heuristic";

/**
 * Resolve the judge provider from configuration:
 *  RELIABILITY_JUDGE_PROVIDER = anthropic | openai-compatible | heuristic (default: anthropic if a key exists)
 *  RELIABILITY_JUDGE_MODEL    = model id (default claude-opus-5-5 for anthropic)
 *  OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY for openai-compatible endpoints.
 */
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const kind = env.RELIABILITY_JUDGE_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "heuristic");
  if (kind === "anthropic") return new AnthropicProvider(env.RELIABILITY_JUDGE_MODEL ?? "claude-opus-5-5");
  if (kind === "openai-compatible") {
    if (!env.OPENAI_COMPAT_BASE_URL) throw new Error("OPENAI_COMPAT_BASE_URL is required for the openai-compatible provider");
    return new OpenAICompatibleProvider(env.RELIABILITY_JUDGE_MODEL ?? "default", {
      baseUrl: env.OPENAI_COMPAT_BASE_URL,
      apiKey: env.OPENAI_COMPAT_API_KEY,
    });
  }
  return new HeuristicProvider();
}
