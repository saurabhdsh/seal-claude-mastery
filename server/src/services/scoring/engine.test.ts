import { describe, expect, it } from "vitest";
import {
  bandFromScore,
  scoreObjective,
  updateAbility,
  overallFromParts,
} from "./engine.js";
import { assembleAssessment, defaultDifficultyMix, defaultLevelMix } from "../ai/assessmentAssembler.js";
import { fingerprintQuestion } from "../questions/fingerprint.js";
import { can } from "../rbac/permissions.js";
import { criticSchema } from "../ai/difficultyCalibrator.js";
import { evaluationSchema } from "../ai/answerEvaluator.js";
import { generatedSetSchema } from "../ai/questionGenerator.js";
import { PASSWORD_POLICY } from "../auth/authService.js";

describe("scoring", () => {
  it("scores single key items", () => {
    const r = scoreObjective({
      type: "SCENARIO_DECISION",
      correctAnswer: { keys: ["B"] },
      selectedKeys: ["B"],
      maxPoints: 1,
      difficultyWeight: 1.6,
    });
    expect(r.isCorrect).toBe(true);
    expect(r.points).toBe(1.6);
  });

  it("partial-credits multi-select and penalizes extras", () => {
    const r = scoreObjective({
      type: "MULTI_SELECT",
      correctAnswer: { keys: ["A", "C"] },
      selectedKeys: ["A", "C", "D"],
      maxPoints: 1,
      difficultyWeight: 1,
    });
    expect(r.isCorrect).toBe(false);
    expect(r.points).toBeLessThan(1);
    expect(r.points).toBeGreaterThan(0);
  });

  it("caps expert band when difficulty is too low", () => {
    expect(bandFromScore(95, 1.1)).toBe("ADVANCED_PRACTITIONER");
    expect(bandFromScore(95, 1.7)).toBe("CLAUDE_EXPERT");
  });

  it("computes overall", () => {
    expect(overallFromParts(8, 10)).toBe(80);
  });

  it("updates ability conservatively", () => {
    let a = { ability: 0.5, n: 0 };
    for (let i = 0; i < 6; i++) a = updateAbility(a, true, 1.6);
    expect(a.ability).toBeGreaterThan(0.5);
    expect(a.n).toBe(6);
  });
});

describe("assembler", () => {
  it("respects time budget and covers modules", () => {
    const questions = Array.from({ length: 80 }, (_, i) => ({
      id: `q${i}`,
      moduleId: i % 2 === 0 ? "m1" : "m2",
      level: i % 2 === 0 ? ("ADVANCED" as const) : ("PRACTITIONER" as const),
      difficulty: (["HARD", "VERY_HARD", "EXPERT", "ADVERSARIAL"] as const)[i % 4],
      questionType: "SCENARIO_DECISION" as const,
      estimatedTimeSeconds: 120,
      usageCount: i % 5,
      lastUsedAt: null,
      competencyIds: ["c1"],
      fingerprint: `f${i}`,
    }));
    const result = assembleAssessment({
      questions,
      excludeQuestionIds: new Set(["q0"]),
      timeBudgetSeconds: 5400,
      targetCount: 40,
      levelMix: defaultLevelMix("ADVANCED", "PROGRESSIVE_MASTERY"),
      difficultyMix: defaultDifficultyMix("ADVANCED"),
      moduleIds: ["m1", "m2"],
      moduleWeights: { m1: 1, m2: 1 },
    });
    expect(result.selected.length).toBe(40);
    expect(result.selected.find((q) => q.id === "q0")).toBeUndefined();
    expect(result.coverage.m1).toBeGreaterThan(0);
    expect(result.coverage.m2).toBeGreaterThan(0);
  });

  it("does not select questions outside template modules", () => {
    const questions = [
      {
        id: "in",
        moduleId: "m1",
        level: "FOUNDATION" as const,
        difficulty: "APPLIED" as const,
        questionType: "SCENARIO_DECISION" as const,
        estimatedTimeSeconds: 120,
        usageCount: 0,
        lastUsedAt: null,
        competencyIds: ["c1"],
        fingerprint: "a",
      },
      {
        id: "out",
        moduleId: "m99",
        level: "FOUNDATION" as const,
        difficulty: "APPLIED" as const,
        questionType: "SCENARIO_DECISION" as const,
        estimatedTimeSeconds: 120,
        usageCount: 0,
        lastUsedAt: null,
        competencyIds: ["c1"],
        fingerprint: "b",
      },
    ];
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...questions[0],
      id: `q${i}`,
      fingerprint: `f${i}`,
    }));
    const result = assembleAssessment({
      questions: [...many, questions[1]],
      excludeQuestionIds: new Set(),
      timeBudgetSeconds: 5400,
      targetCount: 40,
      levelMix: defaultLevelMix("FOUNDATION", "LEVEL_SPECIFIC"),
      difficultyMix: defaultDifficultyMix("FOUNDATION"),
      moduleIds: ["m1"],
      moduleWeights: { m1: 1 },
    });
    expect(result.selected.every((q) => q.moduleId === "m1")).toBe(true);
    expect(result.selected.find((q) => q.id === "out")).toBeUndefined();
  });
});

describe("fingerprint", () => {
  it("is stable for equivalent text", () => {
    expect(fingerprintQuestion("Hello, world!", "")).toBe(fingerprintQuestion("hello world", ""));
  });
});

describe("rbac", () => {
  it("denies trainees from AI control", () => {
    expect(can("TRAINEE", "admin.ai")).toBe(false);
    expect(can("SUPER_ADMIN", "admin.ai")).toBe(true);
    expect(can("REVIEWER", "review.queue")).toBe(true);
  });
});

describe("ai schemas", () => {
  it("rejects evaluator output that is not rubric-bound", () => {
    expect(() => evaluationSchema.parse({ overall: 100, confidence: 1 })).toThrow();
  });

  it("parses critic scores", () => {
    const r = criticSchema.parse({
      technicalCorrectness: 80,
      difficultyConfidence: 70,
      ambiguityRisk: 20,
      distractorQuality: 75,
      scenarioRealism: 90,
      notes: "ok",
      reject: false,
    });
    expect(r.technicalCorrectness).toBe(80);
  });

  it("normalizes OpenAI option objects into the bank schema", () => {
    const parsed = generatedSetSchema.parse({
      questions: [
        {
          type: "multiple choice",
          difficulty: "medium",
          stem: "A claims team’s Claude agent keeps mixing deploy runbooks into a local refactor. Which change best restores instruction scope?",
          choices: {
            A: "Keep one 900-line CLAUDE.md and add retrieval over the same file.",
            B: "Split invariants into root CLAUDE.md and path-scoped instruction files.",
          },
          answer: "B",
          explanation: "Hierarchical instruction files keep deploy guidance out of local refactors.",
        },
      ],
    });
    expect(parsed.questions[0].questionType).toBe("SINGLE_MCQ");
    expect(parsed.questions[0].difficulty).toBe("MODERATE");
    expect(parsed.questions[0].options).toHaveLength(2);
    expect(parsed.questions[0].correctAnswer.keys).toContain("B");
  });

  it("hoists question metadata accidentally nested inside options objects", () => {
    const parsed = generatedSetSchema.parse({
      questions: [
        {
          options: {
            questionType: "SCENARIO_DECISION",
            difficulty: "HARD",
            questionText:
              "Your incident bot keeps citing production deploy steps during a local refactor ticket. Which Claude Code change best narrows scope?",
            A: "Keep one monolithic CLAUDE.md and rely on retrieval over the same file for every task.",
            B: "Split invariants into root CLAUDE.md plus path-scoped instruction files for deploy vs refactor.",
            correctAnswer: { keys: ["B"] },
            answerExplanation:
              "Path-scoped instruction files prevent deploy runbooks from polluting local refactor workflows.",
          },
        },
      ],
    });
    expect(parsed.questions[0].questionType).toBe("SCENARIO_DECISION");
    expect(parsed.questions[0].options).toHaveLength(2);
    expect(parsed.questions[0].correctAnswer.keys).toContain("B");
  });
});

describe("password policy", () => {
  it("rejects short or simple passwords", () => {
    expect(PASSWORD_POLICY.test("password")).toBe(false);
    expect(PASSWORD_POLICY.test("SealTrainee!2026")).toBe(true);
  });
});
