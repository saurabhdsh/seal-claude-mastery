/**
 * Rebuilds seed-v1 approved questions with diversified stems/answer keys.
 * Safe for live Azure: keeps trainees/assignments; skips questions locked in
 * IN_PROGRESS attempts; updates capstone target to 40.
 *
 *   docker compose exec api node dist/scripts/refreshSeedQuestionBank.js
 */
import { AttemptStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { CURRICULUM } from "../seed/curriculum.js";
import { buildQuestionsForModule, toCreateInput } from "../seed/questions.js";

const TEMPLATE_NAME = "Full curriculum capstone — adversarial";

async function main() {
  const competencies = await prisma.competency.findMany();
  const competencyIds = Object.fromEntries(competencies.map((c) => [c.code, c.id]));
  if (!Object.keys(competencyIds).length) {
    throw new Error("No competencies — run the app seed first.");
  }

  const lockedQuestionIds = new Set(
    (
      await prisma.attemptQuestion.findMany({
        where: { attempt: { status: AttemptStatus.IN_PROGRESS } },
        select: { questionId: true },
      })
    ).map((r) => r.questionId),
  );

  let deleted = 0;
  let created = 0;
  let skippedLocked = 0;

  for (const spec of CURRICULUM) {
    const module = await prisma.module.findUnique({ where: { code: spec.code } });
    if (!module) continue;

    const old = await prisma.question.findMany({
      where: {
        moduleId: module.id,
        generationPromptVersion: "seed-v1",
        status: "APPROVED",
      },
      select: { id: true },
    });
    const removable = old.filter((q) => !lockedQuestionIds.has(q.id)).map((q) => q.id);
    skippedLocked += old.length - removable.length;

    if (removable.length) {
      await prisma.questionOption.deleteMany({ where: { questionId: { in: removable } } });
      await prisma.questionCompetency.deleteMany({ where: { questionId: { in: removable } } });
      // Historical attempts keep snapshots; detach non-in-progress rows so seed rows can be replaced.
      await prisma.answer.deleteMany({
        where: {
          questionId: { in: removable },
          attempt: { status: { not: AttemptStatus.IN_PROGRESS } },
        },
      });
      await prisma.attemptQuestion.deleteMany({
        where: {
          questionId: { in: removable },
          attempt: { status: { not: AttemptStatus.IN_PROGRESS } },
        },
      });
      await prisma.question.deleteMany({ where: { id: { in: removable } } });
      deleted += removable.length;
    }

    const have = await prisma.question.count({
      where: { moduleId: module.id, status: "APPROVED" },
    });
    if (have >= 5) continue;

    const qs = buildQuestionsForModule(spec.code, spec.name, spec.level, spec.competencies);
    for (const q of qs.slice(0, 5 - have)) {
      const data = toCreateInput(q, module.id, competencyIds);
      const dup = await prisma.question.findFirst({ where: { fingerprint: data.fingerprint } });
      if (dup) continue;
      try {
        await prisma.question.create({ data: data as unknown as Prisma.QuestionCreateInput });
        created += 1;
      } catch (err) {
        console.warn("skip", spec.code, err instanceof Error ? err.message : err);
      }
    }
  }

  const approved = await prisma.question.count({ where: { status: "APPROVED" } });
  const capstone = await prisma.assessmentTemplate.findFirst({ where: { name: TEMPLATE_NAME } });
  let invalidatedAttempts = 0;
  if (capstone) {
    await prisma.assessmentTemplate.update({
      where: { id: capstone.id },
      data: {
        targetQuestionCount: 40,
        durationSeconds: Math.min(10800, Math.max(5400, 40 * 180)),
        timeBudgetSeconds: Math.min(10800, Math.max(5400, 40 * 180)),
      },
    });
    // Hard-delete open sittings (do NOT mark EXPIRED — that would consume maxAttempts=1).
    const stale = await prisma.assessmentAttempt.findMany({
      where: {
        status: { in: [AttemptStatus.IN_PROGRESS, AttemptStatus.PENDING, AttemptStatus.EXPIRED] },
        assignment: { templateId: capstone.id },
      },
      select: { id: true },
    });
    for (const row of stale) {
      await prisma.integrityEvent.deleteMany({ where: { attemptId: row.id } });
      await prisma.answer.deleteMany({ where: { attemptId: row.id } });
      await prisma.assessmentResult.deleteMany({ where: { attemptId: row.id } }).catch(() => undefined);
      await prisma.attemptQuestion.deleteMany({ where: { attemptId: row.id } });
      await prisma.assessmentAttempt.delete({ where: { id: row.id } });
    }
    invalidatedAttempts = stale.length;
  }

  console.log(
    JSON.stringify(
      {
        deleted,
        created,
        skippedLocked,
        approved,
        capstoneTarget: 40,
        invalidatedAttempts,
        note: "Capstone IN_PROGRESS/PENDING attempts were expired so trainees begin a fresh 40-item sitting.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
