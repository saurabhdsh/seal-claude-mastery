import { prisma } from "../../lib/prisma.js";
import {
  bandFromScore,
  COMPETENCY_CLUSTERS,
  overallFromParts,
} from "./engine.js";
import { fallbackNarrative, generateFeedback } from "../ai/feedbackGenerator.js";
import { aiProviderReady } from "../../config/env.js";
import type { DifficultyBand, QuestionType } from "@prisma/client";

function clusterScore(
  rows: { type: QuestionType; earned: number; possible: number }[],
  cluster: keyof typeof COMPETENCY_CLUSTERS,
) {
  const types = COMPETENCY_CLUSTERS[cluster];
  const subset = rows.filter((r) => types.includes(r.type));
  const earned = subset.reduce((s, r) => s + r.earned, 0);
  const possible = subset.reduce((s, r) => s + r.possible, 0);
  return overallFromParts(earned, possible);
}

export async function finalizeAttemptScoring(attemptId: string) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: true,
      questions: { include: { question: { include: { competencies: true, module: true } } } },
      assignment: true,
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const rows = attempt.questions.map((aq) => {
    const q = aq.question;
    const a = attempt.answers.find((x) => x.questionId === q.id);
    const fullPossible = a?.maxPoints ?? q.maxPoints * q.difficultyWeight;
    // Written item with text but no AI score yet must NOT silently count as 0 / full weight.
    const pendingWritten =
      q.questionType === "SHORT_RESPONSE" &&
      !!a?.textResponse?.trim() &&
      a.pointsAwarded == null;
    const earned = pendingWritten ? 0 : (a?.pointsAwarded ?? 0);
    const possible = pendingWritten ? 0 : fullPossible;
    return {
      q,
      a,
      earned,
      possible,
      fullPossible,
      pendingWritten,
      type: q.questionType,
    };
  });

  const pendingWritten = rows.filter((r) => r.pendingWritten);
  const earned = rows.reduce((s, r) => s + r.earned, 0);
  const possible = rows.reduce((s, r) => s + r.possible, 0);
  const overall = overallFromParts(earned, possible);
  const objectiveRows = rows.filter((r) => r.type !== "SHORT_RESPONSE");
  const writtenRows = rows.filter((r) => r.type === "SHORT_RESPONSE" && !r.pendingWritten);
  const objectiveScore = overallFromParts(
    objectiveRows.reduce((s, r) => s + r.earned, 0),
    objectiveRows.reduce((s, r) => s + r.possible, 0),
  );
  const writtenScore = overallFromParts(
    writtenRows.reduce((s, r) => s + r.earned, 0),
    writtenRows.reduce((s, r) => s + r.possible, 0),
  );
  const meanWeight =
    rows.reduce((s, r) => s + r.q.difficultyWeight, 0) / Math.max(1, rows.length);

  const config = await prisma.systemConfiguration.findUnique({ where: { key: "proficiency_bands" } });
  const band = bandFromScore(overall, meanWeight);

  const byModule = new Map<string, { earned: number; possible: number; items: number; correct: number }>();
  for (const r of rows) {
    const cur = byModule.get(r.q.moduleId) ?? { earned: 0, possible: 0, items: 0, correct: 0 };
    cur.earned += r.earned;
    cur.possible += r.possible;
    cur.items += 1;
    if (r.a?.isCorrect) cur.correct += 1;
    byModule.set(r.q.moduleId, cur);
  }

  const byComp = new Map<
    string,
    { earned: number; possible: number; seen: number; maxDiff: DifficultyBand | null }
  >();
  const order: DifficultyBand[] = [
    "CONCEPTUAL",
    "APPLIED",
    "MODERATE",
    "HARD",
    "VERY_HARD",
    "EXPERT",
    "ADVERSARIAL",
  ];
  for (const r of rows) {
    for (const c of r.q.competencies) {
      const cur = byComp.get(c.competencyId) ?? {
        earned: 0,
        possible: 0,
        seen: 0,
        maxDiff: null,
      };
      cur.earned += r.earned * c.weight;
      cur.possible += r.possible * c.weight;
      cur.seen += 1;
      if (!cur.maxDiff || order.indexOf(r.q.difficulty) > order.indexOf(cur.maxDiff)) {
        cur.maxDiff = r.q.difficulty;
      }
      byComp.set(c.competencyId, cur);
    }
  }

  const competencyScores = [...byComp.entries()].map(([id, v]) => ({
    id,
    mastery: overallFromParts(v.earned, v.possible),
    confidence: Math.min(1, v.seen / 6),
    questionsSeen: v.seen,
    difficultyReached: v.maxDiff,
  }));
  competencyScores.sort((a, b) => b.mastery - a.mastery);
  const strongest = competencyScores.slice(0, 4);
  const weakest = [...competencyScores].sort((a, b) => a.mastery - b.mastery).slice(0, 4);

  const comps = await prisma.competency.findMany();
  const nameOf = Object.fromEntries(comps.map((c) => [c.id, c.name]));

  let narrative;
  const profile = {
    overallScore: overall,
    band,
    meanDifficultyWeight: meanWeight,
    strongest: strongest.map((s) => nameOf[s.id] ?? s.id),
    weakest: weakest.map((s) => nameOf[s.id] ?? s.id),
    moduleScores: [...byModule.entries()].map(([id, v]) => ({
      moduleId: id,
      score: overallFromParts(v.earned, v.possible),
    })),
  };
  if (aiProviderReady()) {
    try {
      narrative = await generateFeedback({ attemptId, profile });
    } catch {
      narrative = fallbackNarrative(profile);
    }
  } else {
    narrative = fallbackNarrative(profile);
  }

  const answered = rows.filter((r) => r.a && ((r.a.selectedKeys?.length ?? 0) > 0 || r.a.textResponse)).length;
  const confidence = Math.min(1, 0.35 + (answered / Math.max(1, rows.length)) * 0.5 + Math.min(0.15, rows.length / 200));

  const existing = await prisma.assessmentResult.findUnique({ where: { attemptId } });
  const data = {
    overallScore: overall,
    difficultyWeightedScore: overall,
    proficiencyBand: band,
    confidence,
    scenarioScore: clusterScore(rows, "scenario"),
    architectureScore: clusterScore(rows, "architecture"),
    handsOnScore: clusterScore(rows, "handsOn"),
    securityScore: clusterScore(rows, "security"),
    contextScore: clusterScore(rows, "context"),
    agenticScore: clusterScore(rows, "agentic"),
    claudeCodeScore: clusterScore(rows, "claudeCode"),
    levelMastery: {
      meanDifficultyWeight: meanWeight,
      items: rows.length,
      answered,
      earnedPoints: Number(earned.toFixed(2)),
      possiblePoints: Number(possible.toFixed(2)),
      objectiveScore,
      writtenScore,
      pendingWrittenCount: pendingWritten.length,
      pendingWrittenMaxPoints: Number(
        pendingWritten.reduce((s, r) => s + r.fullPossible, 0).toFixed(2),
      ),
      scoreNote:
        pendingWritten.length > 0
          ? `${pendingWritten.length} written item(s) pending AI evaluation and excluded from the overall until scored.`
          : undefined,
    },
    narrative,
  };

  const result = existing
    ? await prisma.assessmentResult.update({ where: { attemptId }, data })
    : await prisma.assessmentResult.create({ data: { attemptId, ...data } });

  await prisma.moduleResult.deleteMany({ where: { resultId: result.id } });
  await prisma.competencyResult.deleteMany({ where: { resultId: result.id } });
  await prisma.moduleResult.createMany({
    data: [...byModule.entries()].map(([moduleId, v]) => ({
      resultId: result.id,
      moduleId,
      score: overallFromParts(v.earned, v.possible),
      items: v.items,
      correct: v.correct,
    })),
  });
  await prisma.competencyResult.createMany({
    data: competencyScores.map((c) => ({
      resultId: result.id,
      competencyId: c.id,
      mastery: c.mastery,
      confidence: c.confidence,
      questionsSeen: c.questionsSeen,
      difficultyReached: c.difficultyReached ?? undefined,
    })),
  });

  const assignment = await prisma.assessmentAssignment.findUnique({
    where: { id: attempt.assignmentId },
    include: { attempts: true },
  });
  if (assignment) {
    const consumed = assignment.attempts.filter((a) =>
      ["COMPLETED", "LOCKED", "SUBMITTED", "EVALUATING"].includes(a.status),
    ).length;
    await prisma.assessmentAssignment.update({
      where: { id: assignment.id },
      data: { status: consumed >= assignment.maxAttempts ? "COMPLETED" : "ACTIVE" },
    });
  }

  return prisma.assessmentResult.findUnique({
    where: { id: result.id },
    include: {
      modules: { include: { module: true } },
      competencies: { include: { competency: true } },
      attempt: { include: { trainee: true, assignment: { include: { template: true } } } },
    },
  });
}
