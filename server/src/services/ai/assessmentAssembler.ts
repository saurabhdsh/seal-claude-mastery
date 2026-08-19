import type { CurriculumLevel, DifficultyBand, QuestionType } from "@prisma/client";

export type AssemblerQuestion = {
  id: string;
  moduleId: string;
  level: CurriculumLevel;
  difficulty: DifficultyBand;
  questionType: QuestionType;
  estimatedTimeSeconds: number;
  usageCount: number;
  lastUsedAt: Date | null;
  competencyIds: string[];
  fingerprint: string;
};

export type AssemblerInput = {
  questions: AssemblerQuestion[];
  excludeQuestionIds: Set<string>;
  timeBudgetSeconds: number;
  targetCount?: number | null;
  levelMix: Partial<Record<CurriculumLevel, number>>;
  difficultyMix: Partial<Record<DifficultyBand, number>>;
  moduleIds: string[];
  moduleWeights: Record<string, number>;
  adaptiveAbility?: number;
};

export type AssemblerResult = {
  selected: AssemblerQuestion[];
  totalTime: number;
  coverage: Record<string, number>;
};

export const STANDARD_QUESTION_COUNT = 40;

export const MIXED_LEVEL_MIX: Partial<Record<CurriculumLevel, number>> = {
  FOUNDATION: 0.25,
  PRACTITIONER: 0.25,
  ADVANCED: 0.25,
  EXPERT: 0.25,
};

export const MIXED_DIFFICULTY_MIX: Partial<Record<DifficultyBand, number>> = {
  CONCEPTUAL: 0.15,
  APPLIED: 0.15,
  MODERATE: 0.15,
  HARD: 0.2,
  VERY_HARD: 0.15,
  EXPERT: 0.12,
  ADVERSARIAL: 0.08,
};

const LEVEL_ORDER: CurriculumLevel[] = ["FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(parts: string[]) {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function assembleAssessment(input: AssemblerInput, seedKey = "seal"): AssemblerResult {
  const rand = mulberry32(seedFrom([seedKey, String(input.timeBudgetSeconds), ...input.moduleIds]));
  const moduleSet = new Set(input.moduleIds);
  const pool = input.questions.filter(
    (q) => moduleSet.has(q.moduleId) && !input.excludeQuestionIds.has(q.id),
  );
  const selected: AssemblerQuestion[] = [];
  const selectedIds = new Set<string>();
  let time = 0;
  const moduleCount: Record<string, number> = Object.fromEntries(input.moduleIds.map((id) => [id, 0]));
  const levelCount: Record<string, number> = {};
  const diffCount: Record<string, number> = {};
  const typeCount: Record<string, number> = {};
  const competencyCount: Record<string, number> = {};

  const targetTime = input.timeBudgetSeconds;
  const hardCap = input.targetCount ?? STANDARD_QUESTION_COUNT;

  const proportionScore = (actual: number, desired: number, total: number) => {
    if (total === 0) return desired;
    const current = actual / total;
    return Math.max(0, desired - current);
  };

  while (selected.length < hardCap) {
    const unused = pool.filter((q) => !selectedIds.has(q.id));
    if (!unused.length) break;
    const remaining = targetTime - time;
    const fitting = unused.filter((q) => q.estimatedTimeSeconds <= remaining);
    const candidates = fitting.length ? fitting : unused;

    const total = selected.length;
    let best: AssemblerQuestion | null = null;
    let bestScore = -Infinity;

    for (const q of candidates) {
      const modNeed = proportionScore(moduleCount[q.moduleId] ?? 0, input.moduleWeights[q.moduleId] ?? 1, total || 1);
      const levelNeed = proportionScore(levelCount[q.level] ?? 0, input.levelMix[q.level] ?? 0.1, total || 1);
      const diffNeed = proportionScore(diffCount[q.difficulty] ?? 0, input.difficultyMix[q.difficulty] ?? 0.1, total || 1);
      const typeNeed = 1 / (1 + (typeCount[q.questionType] ?? 0));
      const freshness = 1 / (1 + q.usageCount * 0.35);
      const recency = q.lastUsedAt ? Math.min(1, (Date.now() - q.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24 * 21)) : 1;
      const competencyNeed =
        q.competencyIds.reduce((s, c) => s + 1 / (1 + (competencyCount[c] ?? 0)), 0) /
        Math.max(1, q.competencyIds.length);
      const abilityFit =
        input.adaptiveAbility == null
          ? 0.2
          : 1 - Math.abs(input.adaptiveAbility - difficultyToAbility(q.difficulty));
      const jitter = rand() * 0.08;
      const score =
        modNeed * 2.4 +
        levelNeed * 1.8 +
        diffNeed * 1.6 +
        typeNeed * 1.1 +
        freshness * 0.9 +
        recency * 0.4 +
        competencyNeed * 1.3 +
        abilityFit * 0.7 +
        jitter;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }

    if (!best) break;
    selected.push(best);
    selectedIds.add(best.id);
    time += best.estimatedTimeSeconds;
    moduleCount[best.moduleId] = (moduleCount[best.moduleId] ?? 0) + 1;
    levelCount[best.level] = (levelCount[best.level] ?? 0) + 1;
    diffCount[best.difficulty] = (diffCount[best.difficulty] ?? 0) + 1;
    typeCount[best.questionType] = (typeCount[best.questionType] ?? 0) + 1;
    for (const c of best.competencyIds) competencyCount[c] = (competencyCount[c] ?? 0) + 1;
  }

  selected.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.moduleId.localeCompare(b.moduleId));

  return { selected, totalTime: time, coverage: moduleCount };
}

export function difficultyToAbility(d: DifficultyBand): number {
  const map: Record<DifficultyBand, number> = {
    CONCEPTUAL: 0.28,
    APPLIED: 0.36,
    MODERATE: 0.45,
    HARD: 0.58,
    VERY_HARD: 0.72,
    EXPERT: 0.86,
    ADVERSARIAL: 0.94,
  };
  return map[d];
}

export function defaultDifficultyMix(level: CurriculumLevel): Partial<Record<DifficultyBand, number>> {
  switch (level) {
    case "FOUNDATION":
      return { CONCEPTUAL: 0.3, APPLIED: 0.4, HARD: 0.2, VERY_HARD: 0.1 };
    case "PRACTITIONER":
      return { MODERATE: 0.15, HARD: 0.45, VERY_HARD: 0.3, EXPERT: 0.1 };
    case "ADVANCED":
      return { HARD: 0.1, VERY_HARD: 0.5, EXPERT: 0.3, ADVERSARIAL: 0.1 };
    case "EXPERT":
      return { VERY_HARD: 0.2, EXPERT: 0.55, ADVERSARIAL: 0.25 };
  }
}

export function defaultLevelMix(
  target: CurriculumLevel,
  mode: "LEVEL_SPECIFIC" | "PROGRESSIVE_MASTERY",
): Partial<Record<CurriculumLevel, number>> {
  if (mode === "PROGRESSIVE_MASTERY") {
    if (target === "FOUNDATION") return { FOUNDATION: 1 };
    if (target === "PRACTITIONER") return { FOUNDATION: 0.25, PRACTITIONER: 0.75 };
    if (target === "ADVANCED") return { FOUNDATION: 0.15, PRACTITIONER: 0.25, ADVANCED: 0.45, EXPERT: 0.15 };
    return { FOUNDATION: 0.05, PRACTITIONER: 0.15, ADVANCED: 0.4, EXPERT: 0.4 };
  }
  if (target === "FOUNDATION") return { FOUNDATION: 1 };
  if (target === "PRACTITIONER") return { PRACTITIONER: 0.85, FOUNDATION: 0.15 };
  if (target === "ADVANCED") return { ADVANCED: 0.8, PRACTITIONER: 0.2 };
  return { EXPERT: 0.75, ADVANCED: 0.25 };
}

/** Levels included when picking curriculum modules for a template. */
export function levelsForTemplateMode(
  target: CurriculumLevel,
  mode: "LEVEL_SPECIFIC" | "PROGRESSIVE_MASTERY",
): CurriculumLevel[] {
  if (mode === "LEVEL_SPECIFIC") return [target];
  const idx = LEVEL_ORDER.indexOf(target);
  return LEVEL_ORDER.slice(0, Math.max(0, idx) + 1);
}

export function asLevelMix(raw: unknown, target: CurriculumLevel, mode: "LEVEL_SPECIFIC" | "PROGRESSIVE_MASTERY") {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([k, v]) => LEVEL_ORDER.includes(k as CurriculumLevel) && typeof v === "number" && (v as number) > 0,
    );
    if (entries.length) {
      return Object.fromEntries(entries) as Partial<Record<CurriculumLevel, number>>;
    }
  }
  return defaultLevelMix(target, mode);
}

export function asDifficultyMix(raw: unknown, target: CurriculumLevel) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([, v]) => typeof v === "number" && (v as number) > 0,
    );
    if (entries.length) {
      return Object.fromEntries(entries) as Partial<Record<DifficultyBand, number>>;
    }
  }
  return defaultDifficultyMix(target);
}
