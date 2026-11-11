import { describe, expect, it } from "vitest";
import {
  assembleAssessment,
  defaultDifficultyMix,
  defaultLevelMix,
  STANDARD_QUESTION_COUNT,
} from "./assessmentAssembler.js";
import { familyFingerprint, fingerprintQuestion } from "../questions/fingerprint.js";
import { CURRICULUM } from "../../seed/curriculum.js";
import { buildQuestionsForModule } from "../../seed/questions.js";

describe("assessment sitting quality (regressive)", () => {
  const bank = CURRICULUM.flatMap((spec) =>
    buildQuestionsForModule(spec.code, spec.name, spec.level, spec.competencies).map((q) => ({
      ...q,
      moduleCode: spec.code,
      fingerprint: fingerprintQuestion(q.questionText, q.scenario ?? ""),
      familyFingerprint: familyFingerprint(q.questionText, q.scenario ?? ""),
    })),
  );

  it("builds enough unique families for a 40-item sitting", () => {
    const families = new Set(bank.map((q) => q.familyFingerprint));
    expect(families.size).toBeGreaterThanOrEqual(STANDARD_QUESTION_COUNT);
  });

  it("does not pin almost all correct answers on one key", () => {
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

  it("assembles 40 unique ids/families across many seeds", () => {
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

    for (let i = 0; i < 20; i++) {
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
        `quality-${i}`,
      );
      expect(result.selected.length).toBe(STANDARD_QUESTION_COUNT);
      expect(new Set(result.selected.map((q) => q.id)).size).toBe(STANDARD_QUESTION_COUNT);
      expect(new Set(result.selected.map((q) => q.familyFingerprint)).size).toBe(STANDARD_QUESTION_COUNT);
    }
  });

  it("collapses the same stem under different module contexts into one family", () => {
    const a = familyFingerprint(
      "What MOST directly reduces silent operational error?",
      "Fluent answers cite the wrong system of record. (Module context: F01 — Anthropic and Claude ecosystem.)",
    );
    const b = familyFingerprint(
      "What MOST directly reduces silent operational error?",
      "Fluent answers cite the wrong system of record. (Module context: F02 — LLM mechanics for practitioners.)",
    );
    expect(a).toBe(b);
    expect(a).toBe(familyFingerprint("What MOST directly reduces silent operational error?"));
  });
});
