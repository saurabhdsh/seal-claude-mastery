import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { env, aiModels } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal } from "@prisma/client/runtime/library";
import { estimateCost } from "./anthropicProvider.js";
import type { AIProvider, CompletionInput, CompletionResult } from "./anthropicProvider.js";

export class BedrockProvider implements AIProvider {
  private client: AnthropicBedrock | null = null;

  private getClient() {
    if (!this.client) {
      // Uses EC2 instance role credentials automatically (no keys needed)
      this.client = new AnthropicBedrock({ awsRegion: env.AWS_REGION });
    }
    return this.client;
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const model = input.model || env.BEDROCK_MODEL_ID || aiModels.default;
    const client = this.getClient();

    const response = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? env.AI_MAX_TOKENS,
      temperature: input.temperature ?? 0.4,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "Bedrock response was truncated (max_tokens). Try a smaller count (3) or raise AI_MAX_TOKENS.",
      );
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const estimatedCostUsd = estimateCost(inputTokens, outputTokens);

    await prisma.aIUsageLog.create({
      data: {
        model,
        purpose: input.purpose,
        inputTokens,
        outputTokens,
        estimatedCostUsd: new Decimal(estimatedCostUsd),
        actorId: input.actorId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    }).catch(() => undefined);

    return { text, inputTokens, outputTokens, model, estimatedCostUsd };
  }
}
