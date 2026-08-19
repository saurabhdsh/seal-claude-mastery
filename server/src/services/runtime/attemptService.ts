import { AttemptStatus, AssignmentStatus, Prisma, QuestionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withLock } from "../../lib/redis.js";
import { badRequest, forbidden, locked, notFound } from "../../lib/errors.js";
import {
  asDifficultyMix,
  asLevelMix,
  assembleAssessment,
  STANDARD_QUESTION_COUNT,
  type AssemblerQuestion,
} from "../ai/assessmentAssembler.js";
import { evaluateWrittenAnswer } from "../ai/answerEvaluator.js";
import { isObjective, scoreObjective, updateAbility } from "../scoring/engine.js";
import { finalizeAttemptScoring } from "../scoring/finalize.js";

function snapshotQuestion(q: {
  id: string;
  questionText: string;
  scenario: string | null;
  codeSnippet: string | null;
  codeLanguage: string | null;
  architectureArtifact: Prisma.JsonValue | null;
  questionType: string;
  estimatedTimeSeconds: number;
  level?: string;
  module?: { code: string; name: string; level: string } | null;
  options: { key: string; body: string; position: number }[];
}) {
  return {
    id: q.id,
    questionText: q.questionText,
    scenario: q.scenario,
    codeSnippet: q.codeSnippet,
    codeLanguage: q.codeLanguage,
    architectureArtifact: q.architectureArtifact,
    questionType: q.questionType,
    estimatedTimeSeconds: q.estimatedTimeSeconds,
    level: q.level ?? q.module?.level,
    moduleCode: q.module?.code,
    moduleName: q.module?.name,
    options: q.options
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ key: o.key, body: o.body })),
  };
}

export async function startAttempt(assignmentId: string, traineeId: string) {
  const assignment = await prisma.assessmentAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      template: { include: { modules: true } },
      attempts: { orderBy: { createdAt: "desc" } },
      trainee: true,
    },
  });
  if (!assignment || assignment.traineeId !== traineeId) throw notFound("Assignment not found");
  if (assignment.status === AssignmentStatus.DISABLED) throw forbidden("Assignment disabled");
  const now = new Date();
  if (now < assignment.startsAt) throw forbidden("Assessment has not opened");
  if (now > assignment.expiresAt) throw forbidden("Assessment window has expired");

  const inFlight = assignment.attempts.find((a) => a.status === AttemptStatus.IN_PROGRESS);
  if (inFlight) {
    // Resume only fully assembled template-scoped sittings; discard partial/legacy attempts.
    if (inFlight.questionCount >= STANDARD_QUESTION_COUNT) {
      return getAttemptForTrainee(inFlight.id, traineeId);
    }
    await prisma.assessmentAttempt.delete({ where: { id: inFlight.id } });
  }

  const existingPending = assignment.attempts.find((a) => a.status === AttemptStatus.PENDING);
  if (existingPending) return existingPending;

  const consumed = assignment.attempts.filter((a) =>
    (
      [
        AttemptStatus.COMPLETED,
        AttemptStatus.EXPIRED,
        AttemptStatus.LOCKED,
        AttemptStatus.SUBMITTED,
        AttemptStatus.EVALUATING,
      ] as AttemptStatus[]
    ).includes(a.status),
  ).length;
  if (consumed >= assignment.maxAttempts) {
    throw forbidden("No attempts remaining");
  }

  return prisma.assessmentAttempt.create({
    data: {
      assignmentId: assignment.id,
      traineeId,
      templateId: assignment.templateId,
      status: AttemptStatus.PENDING,
      timeBudgetSeconds: assignment.template.timeBudgetSeconds,
    },
  });
}

export async function acknowledgeAndBegin(attemptId: string, traineeId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { assignment: { include: { template: { include: { modules: true } } } } },
  });
  if (!attempt || attempt.traineeId !== traineeId) throw notFound("Attempt not found");
  if (attempt.status === AttemptStatus.IN_PROGRESS) return getAttemptForTrainee(attemptId, traineeId);
  if (attempt.status !== AttemptStatus.PENDING) throw locked("Attempt cannot be started");

  const template = attempt.assignment.template;
  const targetCount = STANDARD_QUESTION_COUNT;
  const moduleIds = template.modules.map((m) => m.moduleId);
  if (moduleIds.length === 0) {
    throw badRequest("This assessment has no curriculum modules. Add modules to the template before starting.");
  }

  const seen = await prisma.attemptQuestion.findMany({
    where: { attempt: { traineeId } },
    select: { questionId: true },
  });
  const seenIds = new Set(seen.map((s) => s.questionId));

  // Only approved questions from modules on this template.
  const bank = await prisma.question.findMany({
    where: {
      status: QuestionStatus.APPROVED,
      moduleId: { in: moduleIds },
    },
    include: { competencies: true },
  });

  const assemblerQuestions: AssemblerQuestion[] = bank.map((q) => ({
    id: q.id,
    moduleId: q.moduleId,
    level: q.level,
    difficulty: q.difficulty,
    questionType: q.questionType,
    estimatedTimeSeconds: q.estimatedTimeSeconds,
    usageCount: q.usageCount + (seenIds.has(q.id) ? 8 : 0),
    lastUsedAt: q.lastUsedAt,
    competencyIds: q.competencies.map((c) => c.competencyId),
    fingerprint: q.fingerprint,
  }));

  const moduleWeights = Object.fromEntries(
    template.modules.map((m) => [m.moduleId, m.weight > 0 ? m.weight : 1]),
  );
  const levelMix = asLevelMix(template.levelMix, template.targetLevel, template.mode);
  const difficultyMix = asDifficultyMix(template.difficultyMix, template.targetLevel);

  const assembled = assembleAssessment(
    {
      questions: assemblerQuestions,
      excludeQuestionIds: new Set(),
      timeBudgetSeconds: template.timeBudgetSeconds,
      targetCount,
      levelMix,
      difficultyMix,
      moduleIds,
      moduleWeights,
    },
    `${attemptId}:${traineeId}`,
  );

  if (assembled.selected.length < targetCount) {
    const fill = assemblerQuestions
      .filter((q) => !assembled.selected.some((s) => s.id === q.id))
      .sort((a, b) => Number(seenIds.has(a.id)) - Number(seenIds.has(b.id)));
    for (const q of fill) {
      if (assembled.selected.length >= targetCount) break;
      assembled.selected.push(q);
    }
  }

  if (assembled.selected.length < targetCount) {
    throw badRequest(
      `This assessment needs ${targetCount} approved questions across its modules, but only ${assemblerQuestions.length} are available. Approve more items in the question bank for these modules.`,
    );
  }
  assembled.selected = assembled.selected.slice(0, targetCount);

  const full = await prisma.question.findMany({
    where: { id: { in: assembled.selected.map((q) => q.id) } },
    include: { options: true, module: true },
  });
  const byId = Object.fromEntries(full.map((q) => [q.id, q]));

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + template.durationSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: AttemptStatus.IN_PROGRESS,
        startedAt,
        expiresAt,
        acknowledgementAt: startedAt,
        questionCount: assembled.selected.length,
        timeBudgetSeconds: template.durationSeconds,
      },
    });
    await tx.attemptQuestion.createMany({
      data: assembled.selected.map((q, i) => ({
        attemptId,
        questionId: q.id,
        position: i,
        assignedDifficulty: q.difficulty,
        snapshot: snapshotQuestion(byId[q.id]) as Prisma.InputJsonValue,
        revealed: !template.adaptiveEnabled || i === 0,
      })),
    });
    await tx.question.updateMany({
      where: { id: { in: assembled.selected.map((q) => q.id) } },
      data: { usageCount: { increment: 1 }, lastUsedAt: startedAt },
    });
  });

  return getAttemptForTrainee(attemptId, traineeId);
}

export async function getAttemptForTrainee(attemptId: string, traineeId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      assignment: { include: { template: true } },
      questions: { orderBy: { position: "asc" } },
      answers: true,
    },
  });
  if (!attempt || attempt.traineeId !== traineeId) throw notFound("Attempt not found");

  if (
    attempt.status === AttemptStatus.IN_PROGRESS &&
    attempt.expiresAt &&
    attempt.expiresAt.getTime() <= Date.now()
  ) {
    await finalizeAttempt(attemptId, "expired");
    return getAttemptForTrainee(attemptId, traineeId);
  }

  const allowNav = attempt.assignment.template.allowNavigation;
  const questions = attempt.questions
    .filter((q) => allowNav || q.revealed || q.position <= attempt.currentIndex)
    .map((q) => {
      const snap = q.snapshot as Record<string, unknown>;
      const answer = attempt.answers.find((a) => a.questionId === q.questionId);
      return {
        attemptQuestionId: q.id,
        questionId: q.questionId,
        position: q.position,
        snapshot: snap,
        answer: answer
          ? {
              selectedKeys: answer.selectedKeys,
              matchPairs: answer.matchPairs,
              sequence: answer.sequence,
              textResponse: answer.textResponse,
              flagged: answer.flagged,
              lastSavedAt: answer.lastSavedAt,
              timeSpentMs: answer.timeSpentMs,
            }
          : null,
      };
    });

  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    serverNow: new Date().toISOString(),
    remainingSeconds: attempt.expiresAt
      ? Math.max(0, Math.floor((attempt.expiresAt.getTime() - Date.now()) / 1000))
      : null,
    questionCount: attempt.questionCount,
    currentIndex: attempt.currentIndex,
    allowNavigation: allowNav,
    adaptive: attempt.assignment.template.adaptiveEnabled,
    questions,
  };
}

export async function saveAnswer(
  attemptId: string,
  traineeId: string,
  payload: {
    questionId: string;
    selectedKeys?: string[];
    matchPairs?: unknown;
    sequence?: unknown;
    textResponse?: string;
    flagged?: boolean;
    timeSpentMs?: number;
    currentIndex?: number;
  },
) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { questions: true, assignment: { include: { template: true } } },
  });
  if (!attempt || attempt.traineeId !== traineeId) throw notFound("Attempt not found");
  if (attempt.status !== AttemptStatus.IN_PROGRESS) throw locked("Attempt is not active");
  if (attempt.expiresAt && attempt.expiresAt.getTime() <= Date.now()) {
    await finalizeAttempt(attemptId, "expired");
    throw locked("Assessment time has expired");
  }
  const aq = attempt.questions.find((q) => q.questionId === payload.questionId);
  if (!aq) throw badRequest("Question is not part of this attempt");

  const answer = await prisma.answer.upsert({
    where: { attemptId_questionId: { attemptId, questionId: payload.questionId } },
    create: {
      attemptId,
      questionId: payload.questionId,
      attemptQuestionId: aq.id,
      selectedKeys: payload.selectedKeys ?? [],
      matchPairs: payload.matchPairs as Prisma.InputJsonValue | undefined,
      sequence: payload.sequence as Prisma.InputJsonValue | undefined,
      textResponse: payload.textResponse,
      flagged: payload.flagged ?? false,
      timeSpentMs: payload.timeSpentMs ?? 0,
    },
    update: {
      selectedKeys: payload.selectedKeys ?? [],
      matchPairs: payload.matchPairs as Prisma.InputJsonValue | undefined,
      sequence: payload.sequence as Prisma.InputJsonValue | undefined,
      textResponse: payload.textResponse,
      flagged: payload.flagged,
      timeSpentMs: payload.timeSpentMs,
      lastSavedAt: new Date(),
    },
  });

  if (typeof payload.currentIndex === "number") {
    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: { currentIndex: payload.currentIndex },
    });
    if (attempt.assignment.template.adaptiveEnabled) {
      await maybeRevealNext(attemptId, payload.currentIndex);
    }
  }

  return { saved: true, lastSavedAt: answer.lastSavedAt };
}

async function maybeRevealNext(attemptId: string, currentIndex: number) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { questions: { orderBy: { position: "asc" } }, answers: true },
  });
  if (!attempt) return;
  const answered = attempt.answers.length;
  let ability = { ability: attempt.abilityEstimate, n: answered };
  for (const a of attempt.answers) {
    const q = await prisma.question.findUnique({ where: { id: a.questionId } });
    if (!q || !isObjective(q.questionType)) continue;
    const scored = scoreObjective({
      type: q.questionType,
      correctAnswer: q.correctAnswer,
      selectedKeys: a.selectedKeys,
      sequence: a.sequence,
      matchPairs: a.matchPairs,
      maxPoints: q.maxPoints,
      difficultyWeight: q.difficultyWeight,
    });
    ability = updateAbility(ability, scored.isCorrect, q.difficultyWeight);
  }
  await prisma.assessmentAttempt.update({
    where: { id: attemptId },
    data: { abilityEstimate: ability.ability },
  });
  const next = attempt.questions.find((q) => q.position === currentIndex + 1);
  if (next && !next.revealed) {
    await prisma.attemptQuestion.update({ where: { id: next.id }, data: { revealed: true } });
  }
}

export async function recordIntegrity(
  attemptId: string,
  traineeId: string,
  type: Parameters<typeof prisma.integrityEvent.create>[0] extends never ? never : string,
  payload: unknown,
  clientTs?: string,
  ip?: string,
) {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.traineeId !== traineeId) throw notFound("Attempt not found");
  await prisma.integrityEvent.create({
    data: {
      attemptId,
      type: type as never,
      payload: payload as Prisma.InputJsonValue,
      clientTs: clientTs ? new Date(clientTs) : null,
      ip,
    },
  });
}

export async function submitAttempt(attemptId: string, traineeId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.traineeId !== traineeId) throw notFound("Attempt not found");
  if (attempt.status !== AttemptStatus.IN_PROGRESS && attempt.status !== AttemptStatus.EXPIRED) {
    throw locked("Attempt cannot be submitted");
  }
  return finalizeAttempt(attemptId, "submit");
}

export async function finalizeAttempt(attemptId: string, reason: "submit" | "expired") {
  const result = await withLock(`lock:attempt:${attemptId}:finalize`, 30_000, async () => {
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: { questions: true, answers: true },
    });
    if (!attempt) throw notFound("Attempt not found");
    if (attempt.status === AttemptStatus.COMPLETED || attempt.status === AttemptStatus.LOCKED) {
      return prisma.assessmentResult.findUnique({ where: { attemptId } });
    }

    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: AttemptStatus.EVALUATING,
        submittedAt: new Date(),
      },
    });

    for (const aq of attempt.questions) {
      const q = await prisma.question.findUnique({ where: { id: aq.questionId } });
      if (!q) continue;
      const answer = attempt.answers.find((a) => a.questionId === q.id);
      if (isObjective(q.questionType)) {
        const scored = scoreObjective({
          type: q.questionType,
          correctAnswer: q.correctAnswer,
          selectedKeys: answer?.selectedKeys ?? [],
          sequence: answer?.sequence,
          matchPairs: answer?.matchPairs,
          maxPoints: q.maxPoints,
          difficultyWeight: q.difficultyWeight,
        });
        await prisma.answer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: q.id } },
          create: {
            attemptId,
            questionId: q.id,
            attemptQuestionId: aq.id,
            selectedKeys: answer?.selectedKeys ?? [],
            isCorrect: scored.isCorrect,
            pointsAwarded: scored.points,
            maxPoints: q.maxPoints * q.difficultyWeight,
          },
          update: {
            isCorrect: scored.isCorrect,
            pointsAwarded: scored.points,
            maxPoints: q.maxPoints * q.difficultyWeight,
          },
        });
      } else if (answer?.textResponse?.trim()) {
        await evaluateWrittenAnswer({ attemptId, questionId: q.id });
      } else {
        await prisma.answer.upsert({
          where: { attemptId_questionId: { attemptId, questionId: q.id } },
          create: {
            attemptId,
            questionId: q.id,
            attemptQuestionId: aq.id,
            pointsAwarded: 0,
            maxPoints: q.maxPoints * q.difficultyWeight,
            isCorrect: false,
          },
          update: { pointsAwarded: 0, maxPoints: q.maxPoints * q.difficultyWeight, isCorrect: false },
        });
      }
    }

    const scored = await finalizeAttemptScoring(attemptId);
    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: reason === "expired" ? AttemptStatus.EXPIRED : AttemptStatus.COMPLETED,
        finalizedAt: new Date(),
      },
    });
    return scored;
  });

  if (result === null) {
    throw locked("Finalization already in progress");
  }
  return result;
}
