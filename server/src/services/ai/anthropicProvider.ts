import Anthropic from "@anthropic-ai/sdk";
import { env, aiModels } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AIUsagePurpose } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export type CompletionInput = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  purpose: AIUsagePurpose;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
};

export type CompletionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  estimatedCostUsd: number;
};

export interface AIProvider {
  complete(input: CompletionInput): Promise<CompletionResult>;
}

const COST_PER_MTOK = { input: 3, output: 15 };

export function estimateCost(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * COST_PER_MTOK.input + (outputTokens / 1_000_000) * COST_PER_MTOK.output;
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;

  private getClient() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    if (!this.client) this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return this.client;
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const model = input.model || aiModels.default;
    const client = this.getClient();
    const response = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? env.AI_MAX_TOKENS,
      temperature: input.temperature ?? 0.4,
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: input.user }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const estimatedCostUsd = estimateCost(inputTokens, outputTokens);
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

function extractBalancedSlice(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Model did not return JSON");

  const candidates: string[] = [];
  for (const block of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const inner = block[1]?.trim();
    if (inner) candidates.push(inner);
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try balanced slices */
    }
    for (const [open, close] of [
      ["{", "}"],
      ["[", "]"],
    ] as const) {
      const slice = extractBalancedSlice(candidate, open, close);
      if (!slice) continue;
      try {
        return JSON.parse(slice);
      } catch {
        /* next strategy */
      }
    }
  }

  throw new Error("Model did not return JSON");
}
