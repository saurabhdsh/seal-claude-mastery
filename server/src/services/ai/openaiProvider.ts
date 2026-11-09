import OpenAI from "openai";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal } from "@prisma/client/runtime/library";
import type { AIProvider, CompletionInput, CompletionResult } from "./anthropicProvider.js";

const COST_PER_MTOK = { input: 2.5, output: 10 };

function isRestrictedChatModel(model: string) {
  return /^(gpt-5|o1|o3)/i.test(model);
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI | null = null;

  private getClient() {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    if (!this.client) {
      const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey: env.OPENAI_API_KEY };
      if (env.OPENAI_BASE_URL?.trim()) opts.baseURL = env.OPENAI_BASE_URL.trim().replace(/\/$/, "");
      this.client = new OpenAI(opts);
    }
    return this.client;
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const model = input.model || env.OPENAI_MODEL;
    const client = this.getClient();
    const restricted = isRestrictedChatModel(model);
    const maxTokens = input.maxTokens ?? env.AI_MAX_TOKENS;

    const messages = [
      { role: "system" as const, content: input.system },
      { role: "user" as const, content: input.user },
    ];

    const base: Record<string, unknown> = { model, messages };
    if (restricted) {
      base.max_completion_tokens = maxTokens;
    } else {
      base.temperature = input.temperature ?? 0.4;
      base.max_tokens = maxTokens;
      base.response_format = { type: "json_object" };
    }

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create(
        base as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      );
    } catch (err) {
      // Azure gpt-5 deployments often reject temperature / response_format. Retry stripped.
      if (!restricted) throw err;
      const retry: Record<string, unknown> = {
        model,
        messages,
        max_completion_tokens: maxTokens,
      };
      response = await client.chat.completions.create(
        retry as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      );
    }

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
