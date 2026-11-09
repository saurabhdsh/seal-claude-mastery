import { activeProviderName, env } from "../../config/env.js";
import { AnthropicProvider, extractJson, type AIProvider } from "./anthropicProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { BedrockProvider } from "./bedrockProvider.js";

let provider: AIProvider | null = null;
let providerName: string | null = null;

export function resolveProviderName(force?: "openai" | "anthropic" | "bedrock"): "openai" | "anthropic" | "bedrock" {
  // On AWS, "anthropic" without a direct API key can fall through to Bedrock.
  // On Azure there is no Bedrock role — never route there.
  if (
    force === "anthropic" &&
    env.SEAL_CLOUD !== "azure" &&
    env.BEDROCK_ENABLED &&
    !env.ANTHROPIC_API_KEY
  ) {
    return "bedrock";
  }
  return force ?? activeProviderName();
}

export function getAIProvider(force?: "openai" | "anthropic" | "bedrock"): AIProvider {
  const name = resolveProviderName(force);
  if (!provider || providerName !== name) {
    if (name === "openai") provider = new OpenAIProvider();
    else if (name === "bedrock") provider = new BedrockProvider();
    else provider = new AnthropicProvider();
    providerName = name;
  }
  return provider;
}

export function setAIProvider(next: AIProvider) {
  provider = next;
  providerName = "custom";
}

export { extractJson };
export type { AIProvider };
