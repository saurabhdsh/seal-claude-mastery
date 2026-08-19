import { Queue, Worker } from "bullmq";
import { AIJobStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { generateQuestionSet } from "../services/ai/questionGenerator.js";
import { critiqueQuestion } from "../services/ai/difficultyCalibrator.js";

const connection = { url: env.REDIS_URL };

let generationQueue: Queue | null = null;

export function getGenerationQueue() {
  if (!generationQueue) generationQueue = new Queue("seal-generate", { connection });
  return generationQueue;
}

export async function startWorkers() {
  try {
    const worker = new Worker(
      "seal-generate",
      async (job) => {
        const { moduleId, count, actorId, provider, runCritic, generationId } = job.data as {
          moduleId: string;
          count: number;
          actorId?: string;
          provider?: "openai" | "anthropic" | "bedrock";
          runCritic?: boolean;
          generationId?: string;
        };
        const result = await generateQuestionSet({ moduleId, count, actorId, provider, generationId });
        if (runCritic !== false) {
          for (const id of result.questionIds) {
            try {
              await critiqueQuestion(id, result.generationId, actorId);
            } catch (err) {
              logger.warn("critic failed", err);
            }
          }
        }
        return result;
      },
      { connection, concurrency: env.AI_GENERATION_CONCURRENCY, lockDuration: 10 * 60 * 1000 },
    );
    worker.on("failed", async (job, err) => {
      logger.error("generation job failed", { id: job?.id, err: err.message });
      const generationId = (job?.data as { generationId?: string } | undefined)?.generationId;
      if (!generationId) return;
      await prisma.aIQuestionGeneration.updateMany({
        where: { id: generationId, status: { in: [AIJobStatus.QUEUED, AIJobStatus.RUNNING] } },
        data: { status: AIJobStatus.FAILED, error: err.message.slice(0, 500), completedAt: new Date() },
      });
    });
    worker.on("error", (err) => logger.warn("generation worker redis error", err.message));
    return worker;
  } catch (err) {
    logger.warn("BullMQ worker not started (Redis unavailable)", err);
    return null;
  }
}
