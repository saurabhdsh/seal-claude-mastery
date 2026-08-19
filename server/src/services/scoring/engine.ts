import type { DifficultyBand, ProficiencyBand, QuestionType } from "@prisma/client";

export const DEFAULT_DIFFICULTY_WEIGHTS: Record<DifficultyBand, number> = {
  CONCEPTUAL: 1.0,
  APPLIED: 1.0,
  MODERATE: 1.15,
  HARD: 1.35,
  VERY_HARD: 1.6,
  EXPERT: 1.85,
  ADVERSARIAL: 2.0,
};

export const DEFAULT_BANDS: { min: number; max: number; band: ProficiencyBand }[] = [
  { min: 0, max: 39, band: "DEVELOPING" },
  { min: 40, max: 54, band: "FOUNDATION_READY" },
  { min: 55, max: 69, band: "PRACTITIONER" },
  { min: 70, max: 82, band: "ADVANCED_PRACTITIONER" },
  { min: 83, max: 91, band: "CLAUDE_ENGINEER" },
  { min: 92, max: 100, band: "CLAUDE_EXPERT" },
];

export const OBJECTIVE_TYPES: QuestionType[] = [
  "SINGLE_MCQ",
  "MULTI_SELECT",
  "SCENARIO_DECISION",
  "CODE_ANALYSIS",
  "FIND_THE_DEFECT",
  "ARCHITECTURE_DECISION",
  "SEQUENCE",
  "MATCH",
  "CONFIGURATION_ANALYSIS",
  "PROMPT_CRITIQUE",
  "CONTEXT_DESIGN",
  "MCP_SCHEMA",
  "TOOL_CALL_REASONING",
  "JSON_STRUCTURED_OUTPUT",
  "CLAUDE_CODE_WORKFLOW",
  "SECURITY_INCIDENT",
  "COST_LATENCY",
  "EVALUATION_DESIGN",
  "AGENT_WORKFLOW",
];

export function isObjective(type: QuestionType) {
  return type !== "SHORT_RESPONSE";
}

function norm(arr: string[]) {
  return [...arr].map((s) => s.trim()).filter(Boolean).sort();
}

export function scoreObjective(params: {
  type: QuestionType;
  correctAnswer: unknown;
  selectedKeys?: string[];
  sequence?: unknown;
  matchPairs?: unknown;
  maxPoints: number;
  difficultyWeight: number;
}): { isCorrect: boolean; points: number } {
  const { type, correctAnswer, maxPoints, difficultyWeight } = params;
  const ca = correctAnswer as Record<string, unknown>;
  let isCorrect = false;

  if (type === "SEQUENCE") {
    const expected = (ca.sequence as string[]) ?? [];
    const got = (params.sequence as string[]) ?? [];
    isCorrect = JSON.stringify(expected) === JSON.stringify(got);
  } else if (type === "MATCH") {
    const expected = (ca.pairs as Record<string, string>) ?? {};
    const got = (params.matchPairs as Record<string, string>) ?? {};
    const keys = Object.keys(expected);
    isCorrect = keys.length > 0 && keys.every((k) => expected[k] === got[k]);
  } else if (type === "MULTI_SELECT") {
    const expected = norm((ca.keys as string[]) ?? []);
    const got = norm(params.selectedKeys ?? []);
    if (expected.length === 0) {
      isCorrect = false;
    } else {
      const hit = got.filter((k) => expected.includes(k)).length;
      const extra = got.filter((k) => !expected.includes(k)).length;
      const partial = Math.max(0, hit / expected.length - extra / Math.max(expected.length, 1));
      const points = Number((partial * maxPoints * difficultyWeight).toFixed(4));
      return { isCorrect: partial === 1, points };
    }
  } else {
    const expected = norm((ca.keys as string[]) ?? (ca.key ? [String(ca.key)] : []));
    const got = norm(params.selectedKeys ?? []);
    isCorrect = expected.length > 0 && JSON.stringify(expected) === JSON.stringify(got);
  }

  return {
    isCorrect,
    points: isCorrect ? Number((maxPoints * difficultyWeight).toFixed(4)) : 0,
  };
}

export function bandFromScore(
  score: number,
  meanDifficultyWeight: number,
  bands = DEFAULT_BANDS,
): ProficiencyBand {
  const clamped = Math.max(0, Math.min(100, score));
  let band = bands.find((b) => clamped >= b.min && clamped <= b.max)?.band ?? "DEVELOPING";
  if (band === "CLAUDE_EXPERT" && meanDifficultyWeight < 1.5) {
    band = "ADVANCED_PRACTITIONER";
  }
  return band;
}

export function overallFromParts(earned: number, possible: number) {
  if (possible <= 0) return 0;
  return Number(((earned / possible) * 100).toFixed(2));
}

export type AbilityUpdate = { ability: number; n: number };

/** Transparent ability estimator: difficulty-weighted EWMA of correctness. Range 0–1. */
export function updateAbility(prev: AbilityUpdate, correct: boolean, difficultyWeight: number): AbilityUpdate {
  const observation = correct ? Math.min(1, difficultyWeight / 2) : Math.max(0, 0.35 / difficultyWeight);
  const n = prev.n + 1;
  const alpha = n < 5 ? 0.35 : 0.18;
  const ability = prev.ability * (1 - alpha) + observation * alpha;
  return { ability: Number(ability.toFixed(4)), n };
}

export function shouldAdapt(n: number) {
  return n >= 5 && n % 3 === 0;
}

export const COMPETENCY_CLUSTERS: Record<string, string[]> = {
  scenario: ["SCENARIO_DECISION", "PROMPT_CRITIQUE", "CONTEXT_DESIGN", "EVALUATION_DESIGN"],
  architecture: ["ARCHITECTURE_DECISION", "MCP_SCHEMA", "AGENT_WORKFLOW", "CONTEXT_DESIGN"],
  handsOn: ["CODE_ANALYSIS", "FIND_THE_DEFECT", "CONFIGURATION_ANALYSIS", "CLAUDE_CODE_WORKFLOW", "JSON_STRUCTURED_OUTPUT", "TOOL_CALL_REASONING"],
  security: ["SECURITY_INCIDENT"],
  context: ["CONTEXT_DESIGN", "PROMPT_CRITIQUE"],
  agentic: ["AGENT_WORKFLOW", "TOOL_CALL_REASONING", "MCP_SCHEMA"],
  claudeCode: ["CLAUDE_CODE_WORKFLOW", "CODE_ANALYSIS", "FIND_THE_DEFECT"],
};
