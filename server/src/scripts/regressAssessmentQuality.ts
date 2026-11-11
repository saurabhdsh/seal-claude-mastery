/**
 * Regressive quality gate for assessment sittings.
 * Run unit-style checks without a browser, then optional DB checks.
 *
 *   npm run test -w server -- src/services/ai/assessmentQuality.regress.test.ts
 *   docker compose exec api node dist/scripts/regressAssessmentQuality.js
 */
import { prisma } from "../lib/prisma.js";
import {
  assembleAssessment,
  defaultDifficultyMix,
  defaultLevelMix,
  STANDARD_QUESTION_COUNT,
} from "../services/ai/assessmentAssembler.js";
import { familyFingerprint, fingerprintQuestion } from "../services/questions/fingerprint.js";
import { CURRICULUM } from "../seed/curriculum.js";
import { buildQuestionsForModule } from "../seed/questions.js";

type Finding = { level: "FAIL" | "WARN" | "PASS"; code: string; detail: string };

const findings: Finding[] = [];
function pass(code: string, detail: string) {
  findings.push({ level: "PASS", code, detail });
}
function fail(code: string, detail: string) {
  findings.push({ level: "FAIL", code, detail });
}
function warn(code: string, detail: string) {
  findings.push({ level: "WARN", code, detail });
}

function assertOfflineBank() {
  const all = CURRICULUM.flatMap((spec) =>
    buildQuestionsForModule(spec.code, spec.name, spec.level, spec.competencies).map((q) => ({
      ...q,
      moduleCode: spec.code,
      fp: fingerprintQuestion(q.questionText, q.scenario ?? ""),
      family: familyFingerprint(q.questionText, q.scenario ?? ""),
    })),
  );

  if (all.length < STANDARD_QUESTION_COUNT) {
    fail("BANK_SIZE", `Only ${all.length} seed questions built; need >= ${STANDARD_QUESTION_COUNT}`);
  } else {
    pass("BANK_SIZE", `${all.length} seed questions built`);
  }

  const familyCounts = new Map<string, number>();
  for (const q of all) familyCounts.set(q.family, (familyCounts.get(q.family) ?? 0) + 1);
  const maxFamily = Math.max(...familyCounts.values());
  const uniqueFamilies = familyCounts.size;
  if (uniqueFamilies < STANDARD_QUESTION_COUNT) {
    fail(
      "FAMILY_DIVERSITY",
      `Only ${uniqueFamilies} unique families (largest family size ${maxFamily}). Need >= ${STANDARD_QUESTION_COUNT} for a non-repeating 40-item sitting.`,
    );
  } else {
    pass("FAMILY_DIVERSITY", `${uniqueFamilies} unique families (max family size ${maxFamily})`);
  }

  const correctKeyCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const q of all) {
    for (const key of (q.correctAnswer.keys as string[]) ?? []) {
      if (correctKeyCounts[key] != null) correctKeyCounts[key] += 1;
    }
  }
  const totalKeys = Object.values(correctKeyCounts).reduce((a, b) => a + b, 0);
  const dominant = Math.max(...Object.values(correctKeyCounts));
  if (totalKeys && dominant / totalKeys > 0.55) {
    fail("ANSWER_KEY_BIAS", `Correct keys skewed: ${JSON.stringify(correctKeyCounts)}`);
  } else {
    pass("ANSWER_KEY_BIAS", `Correct key distribution ${JSON.stringify(correctKeyCounts)}`);
  }

  // Assemble many sittings from the offline bank
  const moduleIds = [...new Set(CURRICULUM.map((c) => c.code))];
  const assemblerPool = all.map((q, i) => ({
    id: `offline-${i}`,
    moduleId: q.moduleCode,
    level: q.level,
    difficulty: q.difficulty,
    questionType: q.questionType,
    estimatedTimeSeconds: q.estimatedTimeSeconds,
    usageCount: 0,
    lastUsedAt: null as Date | null,
    competencyIds: q.skills.slice(0, 1),
    fingerprint: q.fp,
    familyFingerprint: q.family,
  }));

  for (let run = 0; run < 25; run++) {
    const result = assembleAssessment(
      {
        questions: assemblerPool,
        excludeQuestionIds: new Set(),
        timeBudgetSeconds: 7200,
        targetCount: STANDARD_QUESTION_COUNT,
        levelMix: defaultLevelMix("EXPERT", "PROGRESSIVE_MASTERY"),
        difficultyMix: defaultDifficultyMix("EXPERT"),
        moduleIds,
        moduleWeights: Object.fromEntries(moduleIds.map((id) => [id, 1])),
      },
      `regress-${run}`,
    );
    const ids = result.selected.map((q) => q.id);
    const fps = result.selected.map((q) => q.fingerprint);
    const families = result.selected.map((q) => q.familyFingerprint || q.fingerprint);
    if (result.selected.length !== STANDARD_QUESTION_COUNT) {
      fail("ASSEMBLE_COUNT", `Run ${run}: got ${result.selected.length}, want ${STANDARD_QUESTION_COUNT}`);
      break;
    }
    if (new Set(ids).size !== ids.length) {
      fail("ASSEMBLE_UNIQUE_ID", `Run ${run}: duplicate question ids`);
      break;
    }
    if (new Set(fps).size !== fps.length) {
      fail("ASSEMBLE_UNIQUE_FP", `Run ${run}: duplicate fingerprints`);
      break;
    }
    if (new Set(families).size !== families.length) {
      fail("ASSEMBLE_UNIQUE_FAMILY", `Run ${run}: duplicate families (near-duplicate stems)`);
      break;
    }
  }
  if (!findings.some((f) => f.code.startsWith("ASSEMBLE_") && f.level === "FAIL")) {
    pass("ASSEMBLE_REGRESS", "25 assemblies: unique ids/fingerprints/families at count 40");
  }
}

async function assertLiveDb() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    warn("DB", "Database not reachable — skipped live checks");
    return;
  }

  const approved = await prisma.question.findMany({
    where: { status: "APPROVED" },
    include: { options: true },
  });
  const families = new Set(
    approved.map((q) => familyFingerprint(q.questionText, q.scenario ?? "")),
  );
  if (families.size < STANDARD_QUESTION_COUNT) {
    fail(
      "DB_FAMILY_DIVERSITY",
      `Live bank has ${approved.length} approved but only ${families.size} unique families. Run refreshSeedQuestionBank.`,
    );
  } else {
    pass("DB_FAMILY_DIVERSITY", `Live bank: ${approved.length} approved, ${families.size} families`);
  }

  const keyCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const q of approved) {
    const ca = q.correctAnswer as { keys?: string[] };
    for (const k of ca.keys ?? []) if (keyCounts[k] != null) keyCounts[k] += 1;
  }
  const total = Object.values(keyCounts).reduce((a, b) => a + b, 0);
  const dominant = Math.max(...Object.values(keyCounts));
  if (total && dominant / total > 0.55) {
    fail("DB_ANSWER_KEY_BIAS", `Live correct keys skewed: ${JSON.stringify(keyCounts)}`);
  } else {
    pass("DB_ANSWER_KEY_BIAS", `Live correct keys ${JSON.stringify(keyCounts)}`);
  }

  const capstone = await prisma.assessmentTemplate.findFirst({
    where: { name: "Full curriculum capstone — adversarial" },
  });
  if (capstone && capstone.targetQuestionCount !== 40) {
    fail("DB_CAPSTONE_COUNT", `Capstone targetQuestionCount=${capstone.targetQuestionCount}, expected 40`);
  } else if (capstone) {
    pass("DB_CAPSTONE_COUNT", "Capstone targetQuestionCount=40");
  }

  // Only fail on live sittings. Historical pre-fix COMPLETED/EXPIRED papers are WARN noise.
  const live = await prisma.assessmentAttempt.findMany({
    where: { status: { in: ["IN_PROGRESS", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { questions: true },
  });
  const historical = await prisma.assessmentAttempt.findMany({
    where: { status: { in: ["COMPLETED", "EXPIRED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { questions: true },
  });

  const inspect = (
    attempt: (typeof live)[number],
    mode: "fail" | "warn",
  ) => {
    const texts = attempt.questions.map((q) => {
      const snap = q.snapshot as { questionText?: string; scenario?: string; correctKeys?: string[] };
      return {
        id: q.questionId,
        family: familyFingerprint(snap.questionText ?? "", snap.scenario ?? ""),
        correctKeys: snap.correctKeys ?? [],
      };
    });
    const familySet = new Set(texts.map((t) => t.family));
    if (texts.length >= 10 && familySet.size < texts.length * 0.8) {
      const detail = `Attempt ${attempt.id} (${attempt.status}) has ${texts.length} items but only ${familySet.size} distinct families`;
      if (mode === "fail") fail("LIVE_ATTEMPT_DUPES", detail);
      else warn("HISTORICAL_ATTEMPT_DUPES", detail + " — run resetCapstoneAttempts.js");
    }
    const firstKeys = texts.map((t) => t.correctKeys[0]).filter(Boolean);
    if (firstKeys.length >= 10) {
      const freq = firstKeys.reduce<Record<string, number>>((acc, k) => {
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const top = Math.max(...Object.values(freq));
      if (top / firstKeys.length > 0.7) {
        const detail = `Attempt ${attempt.id} (${attempt.status}) correctKeys skewed ${JSON.stringify(freq)}`;
        if (mode === "fail") fail("LIVE_ATTEMPT_KEY_BIAS", detail);
        else warn("HISTORICAL_ATTEMPT_KEY_BIAS", detail);
      }
    }
  };

  for (const attempt of live) inspect(attempt, "fail");
  for (const attempt of historical) inspect(attempt, "warn");

  if (live.length === 0 && historical.length === 0) {
    warn("LIVE_ATTEMPT", "No attempts to inspect yet — have one trainee Begin assessment, then re-run");
  } else if (!findings.some((f) => f.code.startsWith("LIVE_ATTEMPT") && f.level === "FAIL")) {
    pass("LIVE_ATTEMPT", `Live sittings OK (${live.length} in progress/pending); historical warnings are non-blocking`);
  }
}

async function main() {
  assertOfflineBank();
  await assertLiveDb();
  const failed = findings.filter((f) => f.level === "FAIL");
  const warned = findings.filter((f) => f.level === "WARN");
  console.log(JSON.stringify({ summary: { fail: failed.length, warn: warned.length, pass: findings.length - failed.length - warned.length }, findings }, null, 2));
  if (failed.length) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
