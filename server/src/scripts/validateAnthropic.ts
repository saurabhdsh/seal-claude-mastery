import { activeProviderName, env } from "../config/env.js";
import { getAIProvider } from "../services/ai/factory.js";

async function main() {
  const provider = activeProviderName();
  const model =
    provider === "openai"
      ? env.OPENAI_MODEL
      : provider === "bedrock"
        ? env.BEDROCK_MODEL_ID || env.ANTHROPIC_MODEL
        : env.ANTHROPIC_MODEL;

  console.log("=== AI Provider Validation ===");
  console.log(`provider: ${provider}`);
  console.log(`model: ${model}`);
  if (provider === "bedrock") {
    console.log(`aws_region: ${env.AWS_REGION}`);
    console.log(`bedrock_enabled: ${env.BEDROCK_ENABLED}`);
  }

  const ai = getAIProvider();
  const started = Date.now();

  const result = await ai.complete({
    system: "Return only valid JSON. No markdown.",
    user: 'Respond with exactly: {"ok":true,"source":"ai-validation"}',
    model,
    temperature: 0,
    maxTokens: 120,
    purpose: "GENERATE",
    resourceType: "System",
    resourceId: "ai-validate",
  });

  const elapsedMs = Date.now() - started;
  console.log(`latency_ms: ${elapsedMs}`);
  console.log(`input_tokens: ${result.inputTokens}`);
  console.log(`output_tokens: ${result.outputTokens}`);
  console.log(`estimated_cost_usd: ${result.estimatedCostUsd.toFixed(6)}`);
  console.log(`raw_response: ${result.text}`);

  try {
    const parsed = JSON.parse(result.text);
    if (parsed?.ok === true) {
      console.log("status: PASS");
      process.exit(0);
    }
  } catch {
    // handled below
  }

  console.error("status: FAIL");
  console.error("reason: model response was not strict JSON or missing ok=true");
  process.exit(1);
}

main().catch((err) => {
  console.error("status: FAIL");
  console.error("reason:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
