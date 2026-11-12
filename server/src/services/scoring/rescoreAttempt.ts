import { prisma } from "../../lib/prisma.js";
import { isObjective, scoreObjective } from "./engine.js";
import { finalizeAttemptScoring } from "./finalize.js";
import { evaluateWrittenAnswer } from "../ai/answerEvaluator.js";

export type RescoreAttemptResult = {
  attemptId: string;
  changed: number;
  writtenRetried: number;
  writtenScored: number;
  writtenPending: number;
  overallScore: number | null;
  levelMastery: unknown;
};

/** Re-grade one sitting with current snapshot keys + written AI eval rules. */
export async function rescoreAttempt(
  attemptId: string,
  opts: { actorId?: string; retryWritten?: boolean } = {},
): Promise<RescoreAttemptResult> {
  const retryWritten = opts.retryWritten !== false;
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: true,
      questions: { include: { question: true } },
      result: true,
    },
  });
  if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);

  let changed = 0;
  let writtenRetried = 0;
  let writtenScored = 0;

  for (const aq of attempt.questions) {
    const q = aq.question;
    const answer = attempt.answers.find((a) => a.questionId === q.id);

    if (isObjective(q.questionType)) {
      const snap = aq.snapshot as { correctKeys?: string[] } | null;
      const correctAnswer =
        Array.isArray(snap?.correctKeys) && snap!.correctKeys!.length > 0
          ? { keys: snap!.correctKeys }
          : q.correctAnswer;
      const scored = scoreObjective({
        type: q.questionType,
        correctAnswer,
        selectedKeys: answer?.selectedKeys ?? [],
        sequence: answer?.sequence,
        matchPairs: answer?.matchPairs,
        maxPoints: q.maxPoints,
        difficultyWeight: q.difficultyWeight,
      });
      const maxPoints = q.maxPoints * q.difficultyWeight;
      if (
        !answer ||
        answer.isCorrect !== scored.isCorrect ||
        Number(answer.pointsAwarded ?? 0) !== scored.points ||
        Number(answer.maxPoints ?? 0) !== maxPoints
      ) {
        changed += 1;
      }
      await prisma.answer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: q.id } },
        create: {
          attemptId: attempt.id,
          questionId: q.id,
          attemptQuestionId: aq.id,
          selectedKeys: answer?.selectedKeys ?? [],
          isCorrect: scored.isCorrect,
          pointsAwarded: scored.points,
          maxPoints,
        },
        update: {
          isCorrect: scored.isCorrect,
          pointsAwarded: scored.points,
          maxPoints,
        },
      });
      continue;
    }

    // Written / short response
    const maxPoints = q.maxPoints * q.difficultyWeight;
    if (answer?.textResponse?.trim()) {
      if (retryWritten) {
        writtenRetried += 1;
        const ev = await evaluateWrittenAnswer({
          attemptId: attempt.id,
          questionId: q.id,
          actorId: opts.actorId,
        });
        if (ev.overall != null) writtenScored += 1;
        changed += 1;
      }
    } else {
      await prisma.answer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId: q.id } },
        create: {
          attemptId: attempt.id,
          questionId: q.id,
          attemptQuestionId: aq.id,
          pointsAwarded: 0,
          maxPoints,
          isCorrect: false,
        },
        update: { pointsAwarded: 0, maxPoints, isCorrect: false },
      });
      changed += 1;
    }
  }

  const scored = await finalizeAttemptScoring(attempt.id);
  const lm = (scored?.levelMastery ?? {}) as { pendingWrittenCount?: number };
  return {
    attemptId: attempt.id,
    changed,
    writtenRetried,
    writtenScored,
    writtenPending: Number(lm.pendingWrittenCount ?? 0),
    overallScore: scored?.overallScore ?? null,
    levelMastery: scored?.levelMastery ?? null,
  };
}

export async function rescoreAllCompletedAttempts(opts: {
  actorId?: string;
  retryWritten?: boolean;
  limit?: number;
} = {}) {
  const attempts = await prisma.assessmentAttempt.findMany({
    where: {
      status: { in: ["COMPLETED", "EVALUATING"] },
      result: { isNot: null },
    },
    select: {
      id: true,
      trainee: { select: { firstName: true, lastName: true, employeeId: true } },
      assignment: { select: { template: { select: { name: true } } } },
      result: { select: { overallScore: true } },
    },
    orderBy: { submittedAt: "asc" },
    take: opts.limit,
  });

  const rows: Array<RescoreAttemptResult & { name: string; before: number | null }> = [];
  for (const a of attempts) {
    const before = a.result?.overallScore ?? null;
    const result = await rescoreAttempt(a.id, {
      actorId: opts.actorId,
      retryWritten: opts.retryWritten,
    });
    rows.push({
      ...result,
      name: `${a.trainee.firstName} ${a.trainee.lastName}`.trim() || a.trainee.employeeId,
      before,
    });
  }
  return rows;
}
