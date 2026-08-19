import { activeProviderName } from "../../config/env.js";
import { AnthropicProvider, extractJson, type AIProvider } from "./anthropicProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";

let provider: AIProvider | null = null;
let providerName: string | null = null;

export function getAIProvider(force?: "openai" | "anthropic"): AIProvider {
  const name = force ?? activeProviderName();
  if (!provider || providerName !== name) {
    provider = name === "openai" ? new OpenAIProvider() : new AnthropicProvider();
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
