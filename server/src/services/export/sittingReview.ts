import type { QuestionType } from "@prisma/client";
import { isObjective, scoreObjective } from "../scoring/engine.js";

type SnapOption = { key: string; body: string; isCorrect?: boolean };
type Snapshot = {
  options?: SnapOption[];
  correctKeys?: string[];
  questionText?: string;
  scenario?: string;
  moduleCode?: string;
  questionType?: string;
};

function normKeys(keys: string[] | undefined | null) {
  return [...(keys ?? [])].map((k) => String(k).trim()).filter(Boolean).sort();
}

/** Options and letters exactly as shown in the sitting (after shuffle). */
export function sittingOptionsFromSnapshot(
  snapshot: unknown,
  liveOptions: { key: string; body: string; isCorrect: boolean }[] = [],
) {
  const snap = (snapshot ?? {}) as Snapshot;
  const correctKeys = new Set(normKeys(snap.correctKeys));
  if (snap.options?.length) {
    return snap.options.map((o) => ({
      key: o.key,
      body: o.body,
      isCorrect: correctKeys.size ? correctKeys.has(o.key) : !!o.isCorrect,
    }));
  }
  return liveOptions.map((o) => ({ key: o.key, body: o.body, isCorrect: o.isCorrect }));
}

export function gradeSelectedAgainstSnapshot(params: {
  questionType: QuestionType | string;
  snapshot: unknown;
  selectedKeys?: string[] | null;
  sequence?: unknown;
  matchPairs?: unknown;
  maxPoints?: number;
  difficultyWeight?: number;
  bankCorrectAnswer?: unknown;
}) {
  const snap = (params.snapshot ?? {}) as Snapshot;
  const correctAnswer =
    Array.isArray(snap.correctKeys) && snap.correctKeys.length > 0
      ? { keys: snap.correctKeys }
      : (params.bankCorrectAnswer ?? { keys: [] });
  if (!isObjective(params.questionType as QuestionType)) {
    return { isCorrect: null as boolean | null, points: null as number | null };
  }
  return scoreObjective({
    type: params.questionType as QuestionType,
    correctAnswer,
    selectedKeys: params.selectedKeys ?? [],
    sequence: params.sequence,
    matchPairs: params.matchPairs,
    maxPoints: params.maxPoints ?? 1,
    difficultyWeight: params.difficultyWeight ?? 1,
  });
}

export function presentSittingItem(params: {
  position: number;
  snapshot: unknown;
  question: {
    questionType: QuestionType | string;
    questionText: string;
    maxPoints: number;
    difficultyWeight: number;
    correctAnswer?: unknown;
    module?: { code: string } | null;
    options?: { key: string; body: string; isCorrect: boolean }[];
  };
  answer?: {
    selectedKeys?: string[];
    textResponse?: string | null;
    sequence?: unknown;
    matchPairs?: unknown;
    isCorrect?: boolean | null;
    pointsAwarded?: number | null;
    maxPoints?: number | null;
    timeSpentMs?: number | null;
  } | null;
}) {
  const snap = (params.snapshot ?? {}) as Snapshot;
  const options = sittingOptionsFromSnapshot(params.snapshot, params.question.options ?? []);
  const correctKeys = normKeys(snap.correctKeys ?? options.filter((o) => o.isCorrect).map((o) => o.key));
  const selectedKeys = normKeys(params.answer?.selectedKeys);
  const bodies = new Map(options.map((o) => [o.key, o.body]));
  const correctOpts = options.filter((o) => o.isCorrect);
  const responseText = (() => {
    const ans = params.answer;
    if (!ans) return "No response recorded";
    if (ans.textResponse?.trim()) return ans.textResponse.trim();
    if (selectedKeys.length) {
      return selectedKeys.map((key) => (bodies.get(key) ? `${key}. ${bodies.get(key)}` : key)).join("\n");
    }
    if (ans.sequence) return `Sequence: ${JSON.stringify(ans.sequence)}`;
    if (ans.matchPairs) return `Matches: ${JSON.stringify(ans.matchPairs)}`;
    return "No response recorded";
  })();

  const keyGrade = gradeSelectedAgainstSnapshot({
    questionType: params.question.questionType,
    snapshot: params.snapshot,
    selectedKeys: params.answer?.selectedKeys,
    sequence: params.answer?.sequence,
    matchPairs: params.answer?.matchPairs,
    maxPoints: params.question.maxPoints,
    difficultyWeight: params.question.difficultyWeight,
    bankCorrectAnswer: params.question.correctAnswer,
  });

  const stored = params.answer?.isCorrect;
  const displayIsCorrect =
    keyGrade.isCorrect == null ? (stored ?? null) : keyGrade.isCorrect;
  const markMismatch =
    keyGrade.isCorrect != null && stored != null && keyGrade.isCorrect !== stored;

  return {
    position: params.position,
    moduleCode: snap.moduleCode ?? params.question.module?.code ?? "—",
    questionText: snap.questionText ?? params.question.questionText,
    scenario: snap.scenario ?? null,
    options,
    correctKeys,
    selectedKeys,
    correctText: correctOpts.length
      ? correctOpts.map((o) => `${o.key}. ${o.body}`).join("\n")
      : "—",
    responseText,
    displayIsCorrect,
    storedIsCorrect: stored ?? null,
    markMismatch,
    keyGradeIsCorrect: keyGrade.isCorrect,
    pointsAwarded: params.answer?.pointsAwarded ?? null,
    maxPoints: params.answer?.maxPoints ?? null,
    timeSpentMs: params.answer?.timeSpentMs ?? null,
  };
}
