/**
 * Clears bad/pre-fix capstone sittings so trainees can start a clean 40-item paper.
 * Does NOT change passwords.
 *
 *   docker compose exec api node dist/scripts/resetCapstoneAttempts.js
 */
import { AttemptStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { familyFingerprint } from "../services/questions/fingerprint.js";

const TEMPLATE_NAME = "Full curriculum capstone — adversarial";

async function isBadAttempt(attemptId: string, questionCount: number) {
  if (questionCount !== 40) return true;
  const rows = await prisma.attemptQuestion.findMany({
    where: { attemptId },
    select: { snapshot: true },
  });
  const families = new Set(
    rows.map((r) => {
      const snap = r.snapshot as { questionText?: string; scenario?: string };
      return familyFingerprint(snap.questionText ?? "", snap.scenario ?? "");
    }),
  );
  return families.size < Math.floor(rows.length * 0.8);
}

async function deleteAttempt(id: string) {
  await prisma.integrityEvent.deleteMany({ where: { attemptId: id } });
  await prisma.answer.deleteMany({ where: { attemptId: id } });
  await prisma.assessmentResult.deleteMany({ where: { attemptId: id } }).catch(() => undefined);
  await prisma.attemptQuestion.deleteMany({ where: { attemptId: id } });
  await prisma.assessmentAttempt.delete({ where: { id } });
}

async function main() {
  const template = await prisma.assessmentTemplate.findFirst({ where: { name: TEMPLATE_NAME } });
  if (!template) throw new Error(`Template not found: ${TEMPLATE_NAME}`);

  await prisma.assessmentTemplate.update({
    where: { id: template.id },
    data: {
      targetQuestionCount: 40,
      durationSeconds: Math.min(10800, Math.max(5400, 40 * 180)),
      timeBudgetSeconds: Math.min(10800, Math.max(5400, 40 * 180)),
    },
  });

  const attempts = await prisma.assessmentAttempt.findMany({
    where: { assignment: { templateId: template.id } },
    select: { id: true, status: true, questionCount: true },
  });

  let deleted = 0;
  let kept = 0;
  for (const a of attempts) {
    const force =
      a.status === AttemptStatus.IN_PROGRESS ||
      a.status === AttemptStatus.PENDING ||
      a.status === AttemptStatus.EXPIRED ||
      a.status === AttemptStatus.EVALUATING;
    const bad = force || (await isBadAttempt(a.id, a.questionCount));
    if (bad) {
      await deleteAttempt(a.id);
      deleted += 1;
    } else {
      kept += 1;
    }
  }

  // Ensure every ACTIVE assignment still has an attempt available.
  const bumped = await prisma.assessmentAssignment.updateMany({
    where: { templateId: template.id, status: "ACTIVE" },
    data: { maxAttempts: 1 },
  });

  console.log(
    JSON.stringify(
      {
        template: TEMPLATE_NAME,
        targetQuestionCount: 40,
        deletedAttempts: deleted,
        keptGoodAttempts: kept,
        assignmentsTouched: bumped.count,
        note: "Bad/old sittings removed. Trainees can Begin assessment again (password unchanged).",
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
