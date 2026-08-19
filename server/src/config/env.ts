import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const parsed = dotenv.parse(fs.readFileSync(file));
  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];
    if (current == null || current.trim() === "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), "../.env"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:5173"),
  API_PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_GENERATION_MODEL: z.string().optional(),
  ANTHROPIC_EVALUATION_MODEL: z.string().optional(),
  ANTHROPIC_CRITIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  AI_PROVIDER: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.enum(["openai", "anthropic"]).optional(),
  ),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(250),
  AI_GENERATION_CONCURRENCY: z.coerce.number().default(2),
  AI_MAX_TOKENS: z.coerce.number().default(8192),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_DOMAIN: z.string().optional().default(""),
  SEED_SUPERADMIN_EMAIL: z.string().email().default("superadmin@seal.local"),
  SEED_SUPERADMIN_PASSWORD: z.string().default("SealAdmin!2026"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

export const env = (parsed.success ? parsed.data : schema.parse({
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://seal:seal@localhost:5432/seal",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test-access-secret-32-chars-min",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-32-chars-min",
})) as z.infer<typeof schema>;

export function activeProviderName(): "openai" | "anthropic" {
  if (env.AI_PROVIDER) return env.AI_PROVIDER;
  if (env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

export const aiModels = {
  get default() {
    return activeProviderName() === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL;
  },
  get generation() {
    if (activeProviderName() === "openai") return env.OPENAI_MODEL;
    return env.ANTHROPIC_GENERATION_MODEL || env.ANTHROPIC_MODEL;
  },
  get evaluation() {
    if (activeProviderName() === "openai") return env.OPENAI_MODEL;
    return env.ANTHROPIC_EVALUATION_MODEL || env.ANTHROPIC_MODEL;
  },
  get critic() {
    if (activeProviderName() === "openai") return env.OPENAI_MODEL;
    return env.ANTHROPIC_CRITIC_MODEL || env.ANTHROPIC_MODEL;
  },
};
