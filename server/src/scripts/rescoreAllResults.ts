/**
 * Rebuild every completed assessment result with current scoring rules:
 * - objective items from sitting snapshot keys
 * - retry AI eval for written answers
 * - pending written items no longer silently count as 0/full-weight
 *
 *   docker compose exec api node dist/scripts/rescoreAllResults.js
 *   # or during deploy:
 *   docker compose exec api npx tsx src/scripts/rescoreAllResults.ts
 */
import { prisma } from "../lib/prisma.js";
import { rescoreAllCompletedAttempts } from "../services/scoring/rescoreAttempt.js";

async function main() {
  const dry = process.argv.includes("--dry");
  const skipWritten = process.argv.includes("--skip-written");
  console.log(
    JSON.stringify(
      {
        action: dry ? "dry-run-list" : "rescore-all",
        retryWritten: !skipWritten,
      },
      null,
      2,
    ),
  );

  if (dry) {
    const rows = await prisma.assessmentAttempt.findMany({
      where: { status: { in: ["COMPLETED", "EVALUATING"] }, result: { isNot: null } },
      include: {
        trainee: { select: { firstName: true, lastName: true, employeeId: true } },
        result: { select: { overallScore: true } },
      },
      orderBy: { submittedAt: "asc" },
    });
    console.log(
      JSON.stringify(
        {
          count: rows.length,
          rows: rows.map((r) => ({
            attemptId: r.id,
            name: `${r.trainee.firstName} ${r.trainee.lastName}`.trim(),
            employeeId: r.trainee.employeeId,
            overallScore: r.result?.overallScore ?? null,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const rows = await rescoreAllCompletedAttempts({ retryWritten: !skipWritten });
  console.log(
    JSON.stringify(
      {
        ok: true,
        count: rows.length,
        rows: rows.map((r) => ({
          attemptId: r.attemptId,
          name: r.name,
          before: r.before,
          after: r.overallScore,
          writtenRetried: r.writtenRetried,
          writtenScored: r.writtenScored,
          writtenPending: r.writtenPending,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
