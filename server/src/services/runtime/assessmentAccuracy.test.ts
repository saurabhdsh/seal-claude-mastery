import { describe, expect, it } from "vitest";
import {
  assembleAssessment,
  defaultDifficultyMix,
  defaultLevelMix,
  STANDARD_QUESTION_COUNT,
} from "../ai/assessmentAssembler.js";
import { familyFingerprint, fingerprintQuestion } from "../questions/fingerprint.js";
import { scoreObjective } from "../scoring/engine.js";
import { CURRICULUM } from "../../seed/curriculum.js";
import { buildQuestionsForModule } from "../../seed/questions.js";
import { sanitizeTraineeSnapshot, snapshotQuestion } from "./attemptSnapshot.js";

function buildBank() {
  return CURRICULUM.flatMap((spec) =>
    buildQuestionsForModule(spec.code, spec.name, spec.level, spec.competencies).map((q) => ({
      ...q,
      moduleCode: spec.code,
      fingerprint: fingerprintQuestion(q.questionText, q.scenario ?? ""),
      familyFingerprint: familyFingerprint(q.questionText, q.scenario ?? ""),
    })),
  );
}

describe("assessment accuracy — end-to-end offline", () => {
  const bank = buildBank();

  it("has at least 40 unique stem families in the seed catalog", () => {
    const families = new Set(bank.map((q) => q.familyFingerprint));
    expect(families.size).toBeGreaterThanOrEqual(STANDARD_QUESTION_COUNT);
  });

  it("does not pin >55% of correct answers on one letter in the seed catalog", () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const q of bank) {
      for (const k of (q.correctAnswer.keys as string[]) ?? []) {
        if (counts[k] != null) counts[k] += 1;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const dominant = Math.max(...Object.values(counts));
    expect(dominant / total).toBeLessThanOrEqual(0.55);
  });

  it("assembles 50 sittings with unique ids, fingerprints, and families", () => {
    const moduleIds = [...new Set(bank.map((q) => q.moduleCode))];
    const questions = bank.map((q, i) => ({
      id: `q${i}`,
      moduleId: q.moduleCode,
      level: q.level,
      difficulty: q.difficulty,
      questionType: q.questionType,
      estimatedTimeSeconds: q.estimatedTimeSeconds,
      usageCount: 0,
      lastUsedAt: null as Date | null,
      competencyIds: q.skills.slice(0, 1),
      fingerprint: q.fingerprint,
      familyFingerprint: q.familyFingerprint,
    }));

    for (let i = 0; i < 50; i++) {
      const result = assembleAssessment(
        {
          questions,
          excludeQuestionIds: new Set(),
          timeBudgetSeconds: 7200,
          targetCount: STANDARD_QUESTION_COUNT,
          levelMix: defaultLevelMix("EXPERT", "PROGRESSIVE_MASTERY"),
          difficultyMix: defaultDifficultyMix("EXPERT"),
          moduleIds,
          moduleWeights: Object.fromEntries(moduleIds.map((id) => [id, 1])),
        },
        `accuracy-${i}`,
      );
      expect(result.selected.length).toBe(STANDARD_QUESTION_COUNT);
      expect(new Set(result.selected.map((q) => q.id)).size).toBe(STANDARD_QUESTION_COUNT);
      expect(new Set(result.selected.map((q) => q.fingerprint)).size).toBe(STANDARD_QUESTION_COUNT);
      expect(new Set(result.selected.map((q) => q.familyFingerprint)).size).toBe(STANDARD_QUESTION_COUNT);
    }
  });

  it("shuffles options but scoring still matches the remapped correctKeys", () => {
    const sample = bank.find((q) => (q.options?.length ?? 0) === 4 && ((q.correctAnswer.keys as string[])?.length ?? 0) === 1);
    expect(sample).toBeTruthy();
    const opts = sample!.options!;
    const q = {
      id: "qid",
      questionText: sample!.questionText,
      scenario: sample!.scenario ?? null,
      codeSnippet: null,
      codeLanguage: null,
      architectureArtifact: null,
      questionType: sample!.questionType,
      estimatedTimeSeconds: 90,
      level: sample!.level,
      module: { code: sample!.moduleCode, name: sample!.moduleCode, level: sample!.level },
      options: opts.map((o, i) => ({ key: o.key, body: o.body, position: i, isCorrect: o.isCorrect })),
    };

    const keyHits: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (let i = 0; i < 40; i++) {
      const snap = snapshotQuestion(q, `shuffle-${i}`);
      expect(snap.options).toHaveLength(4);
      expect(snap.correctKeys.length).toBeGreaterThan(0);
      for (const k of snap.correctKeys) keyHits[k] = (keyHits[k] ?? 0) + 1;

      const correctBody = opts.find((o) => o.isCorrect)!.body;
      const mapped = snap.options.find((o) => o.body === correctBody)!;
      expect(snap.correctKeys).toContain(mapped.key);

      const right = scoreObjective({
        type: sample!.questionType,
        correctAnswer: { keys: snap.correctKeys },
        selectedKeys: [mapped.key],
        maxPoints: 1,
        difficultyWeight: 1,
      });
      expect(right.isCorrect).toBe(true);

      const wrongKey = snap.options.find((o) => o.key !== mapped.key)!.key;
      const wrong = scoreObjective({
        type: sample!.questionType,
        correctAnswer: { keys: snap.correctKeys },
        selectedKeys: [wrongKey],
        maxPoints: 1,
        difficultyWeight: 1,
      });
      expect(wrong.isCorrect).toBe(false);
      expect(wrong.points).toBe(0);
    }
    // Across shuffles, correct letter should move around (not stuck on one key).
    const used = Object.values(keyHits).filter((n) => n > 0).length;
    expect(used).toBeGreaterThanOrEqual(2);
  });

  it("never leaks correctKeys / isCorrect to the trainee-facing snapshot", () => {
    const sample = bank.find((q) => (q.options?.length ?? 0) === 4)!;
    const snap = snapshotQuestion(
      {
        id: "qid",
        questionText: sample.questionText,
        scenario: sample.scenario ?? null,
        codeSnippet: null,
        codeLanguage: null,
        architectureArtifact: null,
        questionType: sample.questionType,
        estimatedTimeSeconds: 90,
        options: sample.options!.map((o, i) => ({
          key: o.key,
          body: o.body,
          position: i,
          isCorrect: o.isCorrect,
        })),
      },
      "leak-check",
    );
    expect(snap.correctKeys.length).toBeGreaterThan(0);
    const publicSnap = sanitizeTraineeSnapshot(snap as unknown as Record<string, unknown>);
    expect(publicSnap).not.toHaveProperty("correctKeys");
    expect(publicSnap).not.toHaveProperty("isCorrect");
    for (const o of publicSnap.options as Record<string, unknown>[]) {
      expect(o).not.toHaveProperty("isCorrect");
      expect(o).not.toHaveProperty("correct");
      expect(o).toHaveProperty("key");
      expect(o).toHaveProperty("body");
    }
  });

  it("scores bank items correctly for right and wrong keys without shuffle", () => {
    let checked = 0;
    for (const q of bank) {
      const keys = (q.correctAnswer.keys as string[]) ?? [];
      if (!keys.length || q.questionType === "SHORT_RESPONSE") continue;
      const right = scoreObjective({
        type: q.questionType,
        correctAnswer: q.correctAnswer,
        selectedKeys: keys,
        maxPoints: 1,
        difficultyWeight: 1,
      });
      expect(right.isCorrect).toBe(true);

      const distractor = ["A", "B", "C", "D"].find((k) => !keys.includes(k));
      if (distractor && q.questionType !== "MULTI_SELECT") {
        const wrong = scoreObjective({
          type: q.questionType,
          correctAnswer: q.correctAnswer,
          selectedKeys: [distractor],
          maxPoints: 1,
          difficultyWeight: 1,
        });
        expect(wrong.isCorrect).toBe(false);
      }
      checked += 1;
      if (checked >= 80) break;
    }
    expect(checked).toBeGreaterThanOrEqual(80);
  });

  it("keeps question text distinct and limits shared option bodies across a sitting", () => {
    const moduleIds = [...new Set(bank.map((q) => q.moduleCode))];
    const questions = bank.map((q, i) => ({
      id: `q${i}`,
      moduleId: q.moduleCode,
      level: q.level,
      difficulty: q.difficulty,
      questionType: q.questionType,
      estimatedTimeSeconds: q.estimatedTimeSeconds,
      usageCount: 0,
      lastUsedAt: null as Date | null,
      competencyIds: q.skills.slice(0, 1),
      fingerprint: q.fingerprint,
      familyFingerprint: q.familyFingerprint,
      questionText: q.questionText,
      optionBodies: (q.options ?? []).map((o) => o.body),
    }));
    const result = assembleAssessment(
      {
        questions,
        excludeQuestionIds: new Set(),
        timeBudgetSeconds: 7200,
        targetCount: STANDARD_QUESTION_COUNT,
        levelMix: defaultLevelMix("EXPERT", "PROGRESSIVE_MASTERY"),
        difficultyMix: defaultDifficultyMix("EXPERT"),
        moduleIds,
        moduleWeights: Object.fromEntries(moduleIds.map((id) => [id, 1])),
      },
      "text-distinct",
    );
    expect(result.selected.length).toBe(STANDARD_QUESTION_COUNT);
    const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
    const texts = result.selected.map((q) => byId[q.id].questionText);
    expect(new Set(texts).size).toBe(texts.length);

    const bodyCounts = new Map<string, number>();
    for (const q of result.selected) {
      for (const body of byId[q.id].optionBodies) {
        const key = body.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        bodyCounts.set(key, (bodyCounts.get(key) ?? 0) + 1);
      }
    }
    const heavilyReused = [...bodyCounts.values()].filter((n) => n >= 3).length;
    // Soft guard: identical option strings should not dominate the paper.
    expect(heavilyReused).toBeLessThan(6);
  });
});

describe("attempt limits", () => {
  it("does not treat EXPIRED as consuming an attempt", async () => {
    const { countsTowardAttemptLimit } = await import("./attemptLimits.js");
    expect(countsTowardAttemptLimit("EXPIRED")).toBe(false);
    expect(countsTowardAttemptLimit("COMPLETED")).toBe(true);
    expect(countsTowardAttemptLimit("IN_PROGRESS")).toBe(false);
  });
});

