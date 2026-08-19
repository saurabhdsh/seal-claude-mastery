import OpenAI from "openai";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal } from "@prisma/client/runtime/library";
import type { AIProvider, CompletionInput, CompletionResult } from "./anthropicProvider.js";

const COST_PER_MTOK = { input: 2.5, output: 10 };

export class OpenAIProvider implements AIProvider {
  private client: OpenAI | null = null;

  private getClient() {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    if (!this.client) this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    return this.client;
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const model = input.model || env.OPENAI_MODEL;
    const client = this.getClient();
    const response = await client.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.4,
      max_tokens: input.maxTokens ?? env.AI_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * COST_PER_MTOK.input + (outputTokens / 1_000_000) * COST_PER_MTOK.output;
    await prisma.aIUsageLog.create({
      data: {
        purpose: input.purpose,
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: new Decimal(estimatedCostUsd),
        actorId: input.actorId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    });
    return { text, inputTokens, outputTokens, model, estimatedCostUsd };
  }
}
