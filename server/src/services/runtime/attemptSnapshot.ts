import type { Prisma } from "@prisma/client";

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Full snapshot kept in DB (includes correctKeys for scoring). */
export function snapshotQuestion(
  q: {
    id: string;
    questionText: string;
    scenario: string | null;
    codeSnippet: string | null;
    codeLanguage: string | null;
    architectureArtifact: Prisma.JsonValue | null;
    questionType: string;
    estimatedTimeSeconds: number;
    level?: string;
    module?: { code: string; name: string; level: string } | null;
    options: { key: string; body: string; position: number; isCorrect: boolean }[];
  },
  shuffleSeed: string,
) {
  const ordered = [...q.options].sort((a, b) => a.position - b.position);
  const rand = mulberry32(
    [...shuffleSeed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0,
  );
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  const remapped = ordered.map((o, i) => ({
    key: String.fromCharCode(65 + i),
    body: o.body,
    isCorrect: o.isCorrect,
  }));
  const correctKeys = remapped.filter((o) => o.isCorrect).map((o) => o.key);
  return {
    id: q.id,
    questionText: q.questionText,
    scenario: q.scenario,
    codeSnippet: q.codeSnippet,
    codeLanguage: q.codeLanguage,
    architectureArtifact: q.architectureArtifact,
    questionType: q.questionType,
    estimatedTimeSeconds: q.estimatedTimeSeconds,
    level: q.level ?? q.module?.level,
    moduleCode: q.module?.code,
    moduleName: q.module?.name,
    options: remapped.map((o) => ({ key: o.key, body: o.body })),
    correctKeys,
  };
}

/** Strip scoring secrets before sending a snapshot to a trainee browser. */
export function sanitizeTraineeSnapshot(snapshot: Record<string, unknown>) {
  const { correctKeys: _correctKeys, isCorrect: _isCorrect, ...safe } = snapshot;
  const options = Array.isArray(safe.options)
    ? safe.options.map((o) => {
        if (!o || typeof o !== "object") return o;
        const row = o as Record<string, unknown>;
        const { isCorrect: _ic, correct: _c, ...rest } = row;
        return rest;
      })
    : safe.options;
  return { ...safe, options };
}
