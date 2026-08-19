import { prisma } from "../../lib/prisma.js";
import { AttemptStatus, QuestionStatus } from "@prisma/client";

export async function dashboardMetrics() {
  const [
    activeTrainees,
    assigned,
    completed,
    results,
    byLevel,
    completionTrend,
    modulePerf,
  ] = await Promise.all([
    prisma.traineeProfile.count({ where: { disabledAt: null, user: { isActive: true } } }),
    prisma.assessmentAssignment.count(),
    prisma.assessmentAttempt.count({ where: { status: { in: [AttemptStatus.COMPLETED, AttemptStatus.EXPIRED] } } }),
    prisma.assessmentResult.findMany({ select: { overallScore: true, proficiencyBand: true, createdAt: true } }),
    prisma.traineeProfile.groupBy({ by: ["assignedLevel"], _count: true }),
    prisma.assessmentResult.findMany({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, overallScore: true },
      take: 90,
    }),
    prisma.moduleResult.groupBy({
      by: ["moduleId"],
      _avg: { score: true },
      _count: true,
    }),
  ]);

  const avg = results.length ? results.reduce((s, r) => s + r.overallScore, 0) / results.length : 0;
  const pass = results.filter((r) => r.overallScore >= 70).length;
  const expert = results.filter((r) => r.proficiencyBand === "CLAUDE_EXPERT").length;

  const modules = await prisma.module.findMany();
  const modMap = Object.fromEntries(modules.map((m) => [m.id, m]));
  const modulePerformance = modulePerf
    .map((m) => ({
      moduleId: m.moduleId,
      code: modMap[m.moduleId]?.code,
      name: modMap[m.moduleId]?.name,
      level: modMap[m.moduleId]?.level,
      avgScore: m._avg.score ?? 0,
      n: m._count,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  const development = await prisma.assessmentResult.findMany({
    where: { overallScore: { lt: 70 } },
    include: { attempt: { include: { trainee: true } } },
    orderBy: { overallScore: "asc" },
    take: 10,
  });

  return {
    metrics: {
      activeTrainees,
      assessmentsAssigned: assigned,
      assessmentsCompleted: completed,
      averageScore: Number(avg.toFixed(1)),
      passRate: results.length ? Number(((pass / results.length) * 100).toFixed(1)) : 0,
      claudeExpertRate: results.length ? Number(((expert / results.length) * 100).toFixed(1)) : 0,
    },
    levelDistribution: byLevel.map((l) => ({ level: l.assignedLevel, count: l._count })),
    candidateDistribution: results.reduce(
      (acc, r) => {
        acc[r.proficiencyBand] = (acc[r.proficiencyBand] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    completionTrend,
    modulePerformance,
    hardestModules: modulePerformance.slice(0, 8),
    candidatesRequiringDevelopment: development.map((d) => ({
      trainee: `${d.attempt.trainee.firstName} ${d.attempt.trainee.lastName}`,
      employeeId: d.attempt.trainee.employeeId,
      score: d.overallScore,
      band: d.proficiencyBand,
      attemptId: d.attemptId,
    })),
  };
}

export async function questionQuality() {
  const questions = await prisma.question.findMany({
    where: { status: QuestionStatus.APPROVED, usageCount: { gt: 0 } },
    include: { module: true, answers: { where: { isCorrect: { not: null } } } },
  });

  return questions
    .map((q) => {
      const n = q.answers.length;
      const correct = q.answers.filter((a) => a.isCorrect).length;
      const p = n ? correct / n : null;
      const times = q.answers.map((a) => a.timeSpentMs).filter((t) => t > 0);
      const avgTime = times.length ? times.reduce((s, t) => s + t, 0) / times.length : null;
      const flags = q.answers.filter((a) => a.flagged).length;
      return {
        id: q.id,
        module: q.module.code,
        type: q.questionType,
        difficulty: q.difficulty,
        usageCount: q.usageCount,
        n,
        p,
        discriminationScore: q.discriminationScore,
        avgResponseMs: avgTime,
        flagRate: n ? flags / n : 0,
        qualityFlag:
          p != null && n >= 8 && (p > 0.95 || p < 0.12)
            ? p > 0.95
              ? "too_easy"
              : "too_hard"
            : q.discriminationScore < 0 && n >= 8
              ? "poor_discrimination"
              : null,
      };
    })
    .sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
}

export async function recalculateQuestionAnalytics() {
  const questions = await prisma.question.findMany({
    include: {
      answers: { include: { attempt: { include: { result: true } } } },
    },
  });
  for (const q of questions) {
    const scored = q.answers.filter((a) => a.isCorrect !== null && a.attempt.result);
    const n = scored.length;
    const p = n ? scored.filter((a) => a.isCorrect).length / n : null;
    let disc = 0;
    if (n >= 8) {
      const sorted = [...scored].sort(
        (a, b) => (a.attempt.result?.overallScore ?? 0) - (b.attempt.result?.overallScore ?? 0),
      );
      const cut = Math.max(1, Math.floor(n * 0.27));
      const low = sorted.slice(0, cut);
      const high = sorted.slice(-cut);
      const pLow = low.filter((a) => a.isCorrect).length / low.length;
      const pHigh = high.filter((a) => a.isCorrect).length / high.length;
      disc = pHigh - pLow;
    }
    const times = q.answers.map((a) => a.timeSpentMs).filter((t) => t > 0);
    await prisma.question.update({
      where: { id: q.id },
      data: {
        correctAnswerRate: p,
        discriminationScore: disc,
        avgResponseMs: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
      },
    });
  }
}

export async function competencyWeakness() {
  const rows = await prisma.competencyResult.groupBy({
    by: ["competencyId"],
    _avg: { mastery: true },
    _count: true,
  });
  const comps = await prisma.competency.findMany();
  const map = Object.fromEntries(comps.map((c) => [c.id, c]));
  return rows
    .map((r) => ({
      competency: map[r.competencyId]?.name,
      code: map[r.competencyId]?.code,
      avgMastery: r._avg.mastery ?? 0,
      n: r._count,
    }))
    .sort((a, b) => a.avgMastery - b.avgMastery);
}
