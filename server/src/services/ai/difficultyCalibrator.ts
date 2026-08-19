import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { extractJson, getAIProvider } from "./factory.js";
import { aiModels } from "../../config/env.js";
import { QuestionStatus } from "@prisma/client";

export const criticSchema = z.object({
  technicalCorrectness: z.number().min(0).max(100),
  difficultyConfidence: z.number().min(0).max(100),
  ambiguityRisk: z.number().min(0).max(100),
  distractorQuality: z.number().min(0).max(100),
  scenarioRealism: z.number().min(0).max(100),
  notes: z.string(),
  recommendedDifficulty: z.string().optional(),
  reject: z.boolean(),
  rejectReason: z.string().optional(),
});

export async function critiqueQuestion(questionId: string, generationId?: string, actorId?: string) {
  const q = await prisma.question.findUnique({
    where: { id: questionId },
    include: { options: true, module: true },
  });
  if (!q) throw new Error("Question not found");

  const system = `You are the Question Critic for SEAL. You did NOT author this item.
Score independently. Be severe about trivia, ambiguous keys, and implausible distractors.
Return JSON only.`;

  const user = JSON.stringify({
    module: { code: q.module.code, level: q.level, name: q.module.name },
    question: {
      type: q.questionType,
      difficulty: q.difficulty,
      questionText: q.questionText,
      scenario: q.scenario,
      codeSnippet: q.codeSnippet,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.answerExplanation,
    },
  });

  const completion = await getAIProvider().complete({
    system,
    user,
    model: aiModels.critic,
    temperature: 0.15,
    purpose: "CRITIC",
    actorId,
    resourceType: "Question",
    resourceId: q.id,
  });

  const scored = criticSchema.parse(extractJson(completion.text));
  const overall = Math.round(
    (scored.technicalCorrectness +
      scored.difficultyConfidence +
      (100 - scored.ambiguityRisk) +
      scored.distractorQuality +
      scored.scenarioRealism) /
      5,
  );

  await prisma.aIQuestionCritique.create({
    data: {
      questionId: q.id,
      generationId,
      technicalCorrectness: scored.technicalCorrectness,
      difficultyConfidence: scored.difficultyConfidence,
      ambiguityRisk: scored.ambiguityRisk,
      distractorQuality: scored.distractorQuality,
      scenarioRealism: scored.scenarioRealism,
      overall,
      notes: scored.notes,
      raw: scored,
      model: completion.model,
    },
  });

  await prisma.question.update({
    where: { id: q.id },
    data: {
      status: scored.reject ? QuestionStatus.DRAFT : QuestionStatus.AI_VALIDATED,
      reviewStatus: scored.reject ? "REJECTED" : "PENDING",
    },
  });

  return { ...scored, overall };
}
