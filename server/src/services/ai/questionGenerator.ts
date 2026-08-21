import { z } from "zod";
import {
  CurriculumLevel,
  DifficultyBand,
  QuestionType,
  QuestionStatus,
  ReviewStatus,
  AIJobStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { extractJson, getAIProvider, resolveProviderName } from "./factory.js";
import { aiModels, env } from "../../config/env.js";
import { fingerprintQuestion } from "../questions/fingerprint.js";
import { DEFAULT_DIFFICULTY_WEIGHTS } from "../scoring/engine.js";
import { Decimal } from "@prisma/client/runtime/library";
import { HttpError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const PROMPT_VERSION = "seal-qg-v5";

const QUESTION_TYPES = Object.values(QuestionType) as string[];
const DIFFICULTIES = Object.values(DifficultyBand) as string[];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

function asStringList(v: unknown): string[] {
  return asList(v)
    .map((x) => (typeof x === "string" ? x : asRecord(x).name ?? asRecord(x).code ?? asRecord(x).label))
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function coerceQuestionType(v: unknown): QuestionType {
  const s = String(v ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (QUESTION_TYPES.includes(s)) return s as QuestionType;
  if (s.includes("MULTI_SELECT") || (s.includes("MULTI") && !s.includes("MULTIPLE_CHOICE") && !s.includes("MULTIPLE CHOICE"))) {
    if (s.includes("SELECT")) return "MULTI_SELECT";
  }
  if (s.includes("SHORT") || s.includes("ESSAY") || s.includes("FREE")) return "SHORT_RESPONSE";
  if (s.includes("MCQ") || s.includes("MULTIPLE") || s.includes("SINGLE") || s.includes("CHOICE")) return "SINGLE_MCQ";
  if (s.includes("SEQUENCE") || s.includes("ORDER")) return "SEQUENCE";
  if (s.includes("MATCH")) return "MATCH";
  if (s.includes("CODE")) return "CODE_ANALYSIS";
  if (s.includes("MCP")) return "MCP_SCHEMA";
  return "SCENARIO_DECISION";
}

function coerceDifficulty(v: unknown): DifficultyBand {
  const s = String(v ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (DIFFICULTIES.includes(s)) return s as DifficultyBand;
  if (s.includes("CONCEPT")) return "CONCEPTUAL";
  if (s.includes("EASY") || s.includes("BEGIN")) return "APPLIED";
  if (s.includes("MEDIUM") || s.includes("MODERATE")) return "MODERATE";
  if (s.includes("VERY")) return "VERY_HARD";
  if (s.includes("ADVERS")) return "ADVERSARIAL";
  if (s.includes("EXPERT")) return "EXPERT";
  if (s.includes("HARD")) return "HARD";
  return "APPLIED";
}

function normalizeOptions(raw: unknown): { key: string; body: string; isCorrect: boolean }[] {
  if (Array.isArray(raw)) {
    return raw.map((o, i) => {
      if (typeof o === "string") {
        return { key: String.fromCharCode(65 + i), body: o, isCorrect: false };
      }
      const obj = asRecord(o);
      return {
        key: String(obj.key ?? obj.id ?? String.fromCharCode(65 + i)),
        body: String(obj.body ?? obj.text ?? obj.label ?? obj.option ?? ""),
        isCorrect: Boolean(obj.isCorrect ?? obj.correct ?? obj.is_correct),
      };
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
      if (typeof v === "string") return { key: k, body: v, isCorrect: false };
      const obj = asRecord(v);
      return {
        key: String(obj.key ?? k),
        body: String(obj.body ?? obj.text ?? obj.label ?? ""),
        isCorrect: Boolean(obj.isCorrect ?? obj.correct),
      };
    });
  }
  return [];
}

function normalizeCorrectAnswer(raw: unknown, options: { key: string; isCorrect: boolean }[]) {
  if (typeof raw === "string") return { keys: [raw], key: raw };
  const obj = asRecord(raw);
  const keys =
    asStringList(obj.keys).length > 0
      ? asStringList(obj.keys)
      : obj.key
        ? [String(obj.key)]
        : options.filter((o) => o.isCorrect).map((o) => o.key);
  return {
    keys,
    key: typeof obj.key === "string" ? obj.key : keys[0],
    sequence: asStringList(obj.sequence),
    pairs: obj.pairs && typeof obj.pairs === "object" ? obj.pairs : undefined,
    rubricNotes: typeof obj.rubricNotes === "string" ? obj.rubricNotes : undefined,
  };
}

function ensureLen(s: string, n: number) {
  const t = s.trim();
  if (t.length >= n) return t;
  return `${t} Enterprise Claude judgment is required to distinguish the correct control from plausible alternatives.`.trim();
}

function splitOptionsBlob(obj: Record<string, unknown>): { fields: Record<string, unknown>; choices: Record<string, unknown> } {
  const META = new Set([
    "questionType",
    "type",
    "itemType",
    "difficulty",
    "difficultyBand",
    "band",
    "questionText",
    "stem",
    "prompt",
    "text",
    "body",
    "scenario",
    "context",
    "answerExplanation",
    "explanation",
    "rationale",
    "why",
    "correctAnswer",
    "answer",
    "correct",
    "scoringRubric",
    "rubric",
    "skillsMeasured",
    "skills",
    "competencies",
    "conceptsMeasured",
    "concepts",
    "topics",
    "estimatedTimeSeconds",
    "timeSeconds",
    "time",
    "sourceReferences",
    "sources",
    "codeSnippet",
    "code",
    "codeLanguage",
    "language",
    "architectureArtifact",
  ]);
  const fields: Record<string, unknown> = {};
  const choices: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (META.has(k)) fields[k] = v;
    else choices[k] = v;
  }
  return { fields, choices };
}

function flattenQuestionItem(item: unknown): Record<string, unknown> {
  const r = asRecord(item);
  const nested = asRecord(r.question ?? r.content ?? r.item ?? r.question_data ?? r.questionData);
  let merged = Object.keys(nested).length ? { ...r, ...nested } : r;

  for (const key of ["options", "choices", "answers", "answerChoices"] as const) {
    const blob = asRecord(merged[key]);
    if (!Object.keys(blob).length) continue;
    const { fields, choices } = splitOptionsBlob(blob);
    if (Object.keys(fields).length) {
      merged = { ...merged, ...fields, [key]: Object.keys(choices).length ? choices : blob };
    }
  }

  if (Array.isArray(merged.questions) || Array.isArray(merged.items)) {
    return merged;
  }
  return merged;
}

function extractQuestionList(raw: unknown): unknown[] {
  const root = asRecord(raw);
  const nested = asRecord(root.data ?? root.result ?? root.output ?? root.response);
  const candidates = [
    root.questions,
    root.items,
    root.question_set,
    root.questionSet,
    nested.questions,
    nested.items,
    nested.question_set,
  ];
  for (const c of candidates) {
    const list = asList(c);
    if (list.length) return list;
  }
  if (Array.isArray(raw)) return raw;
  return asList(raw);
}

export function normalizeGeneratedSet(raw: unknown): unknown {
  const list = extractQuestionList(raw).flatMap((item) => {
    const flat = flattenQuestionItem(item);
    if (Array.isArray(flat.questions)) return asList(flat.questions).map(flattenQuestionItem);
    if (Array.isArray(flat.items)) return asList(flat.items).map(flattenQuestionItem);
    return [flat];
  });

  return {
    questions: list.map((item) => {
      const nested = flattenQuestionItem(item);
      const questionText = ensureLen(
        String(nested.questionText ?? nested.stem ?? nested.prompt ?? nested.text ?? nested.body ?? ""),
        40,
      );
      const options = normalizeOptions(nested.options ?? nested.choices ?? nested.answers ?? nested.answerChoices).map(
        (o) => ({ ...o, body: ensureLen(o.body, 8) }),
      );
      const skills = asStringList(nested.skillsMeasured ?? nested.skills ?? nested.competencies);
      const concepts = asStringList(nested.conceptsMeasured ?? nested.concepts ?? nested.topics ?? skills);
      const rubricRaw = asRecord(nested.scoringRubric ?? nested.rubric);
      const criteria = asList(rubricRaw.criteria).map((c, i) => {
        const row = asRecord(c);
        return {
          id: String(row.id ?? `c${i + 1}`),
          description: String(row.description ?? row.name ?? row.criterion ?? "Correctness"),
          maxPoints: Number(row.maxPoints ?? row.points ?? 1),
        };
      });
      return {
        questionType: coerceQuestionType(nested.questionType ?? nested.type ?? nested.itemType),
        difficulty: coerceDifficulty(nested.difficulty ?? nested.difficultyBand ?? nested.band),
        questionText,
        scenario: nested.scenario || nested.context ? ensureLen(String(nested.scenario ?? nested.context), 40) : null,
        codeSnippet: nested.codeSnippet ?? nested.code ?? null,
        codeLanguage: nested.codeLanguage ?? nested.language ?? null,
        architectureArtifact: nested.architectureArtifact ?? null,
        options,
        correctAnswer: normalizeCorrectAnswer(nested.correctAnswer ?? nested.answer ?? nested.correct, options),
        answerExplanation: ensureLen(
          String(nested.answerExplanation ?? nested.explanation ?? nested.rationale ?? nested.why ?? questionText),
          40,
        ),
        scoringRubric: {
          criteria:
            criteria.length > 0
              ? criteria
              : [{ id: "correctness", description: "Selects the technically correct option", maxPoints: 1 }],
        },
        skillsMeasured: skills.length ? skills : ["CLAUDE_FUNDAMENTALS"],
        conceptsMeasured: concepts.length ? concepts : skills.length ? skills : ["enterprise-claude"],
        estimatedTimeSeconds: Math.min(
          900,
          Math.max(45, Math.round(Number(nested.estimatedTimeSeconds ?? nested.timeSeconds ?? nested.time ?? 180)) || 180),
        ),
        sourceReferences: asList(nested.sourceReferences ?? nested.sources).map((s) => {
          const row = asRecord(s);
          return {
            sourceType: row.sourceType ?? "CURRICULUM",
            sourceTitle: String(row.sourceTitle ?? row.title ?? "Curriculum"),
            sourceURL: row.sourceURL ?? row.url,
            relevantConcept: row.relevantConcept ?? row.concept,
          };
        }),
      };
    }),
  };
}

const generatedQuestionSchema = z.object({
  questionType: z.nativeEnum(QuestionType),
  difficulty: z.nativeEnum(DifficultyBand),
  questionText: z.string().min(40),
  scenario: z.string().optional().nullable(),
  codeSnippet: z.string().optional().nullable(),
  codeLanguage: z.string().optional().nullable(),
  architectureArtifact: z.unknown().optional().nullable(),
  options: z
    .array(
      z.object({
        key: z.string().min(1),
        body: z.string().min(8),
        isCorrect: z.boolean(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  correctAnswer: z.object({
    keys: z.array(z.string()).optional(),
    key: z.string().optional(),
    sequence: z.array(z.string()).optional(),
    pairs: z.record(z.string()).optional(),
    rubricNotes: z.string().optional(),
  }),
  answerExplanation: z.string().min(40),
  scoringRubric: z.object({
    criteria: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        maxPoints: z.number(),
      }),
    ),
  }),
  skillsMeasured: z.array(z.string()).min(1),
  conceptsMeasured: z.array(z.string()).min(1),
  estimatedTimeSeconds: z.number().int().min(45).max(900),
  sourceReferences: z
    .array(
      z.object({
        sourceType: z.enum(["ANTHROPIC_DOC", "ORGANIZATION_CONTENT", "CURRICULUM", "ADMIN_REFERENCE", "OTHER"]),
        sourceTitle: z.string(),
        sourceURL: z.string().optional(),
        relevantConcept: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const generatedSetSchema = z.preprocess(
  (raw) => normalizeGeneratedSet(raw),
  z.object({
    questions: z.array(generatedQuestionSchema).min(1),
  }),
);

function formatStoredError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const missing = [...new Set(err.issues.map((i) => String(i.path[i.path.length - 1] ?? "field")))].slice(0, 4);
    return `The model returned questions in an unexpected format (missing or invalid: ${missing.join(", ")}). Try again with a smaller count.`;
  }
  if (err instanceof Error && /model did not return json|unexpected token|json at/i.test(err.message)) {
    return "The model response was not valid JSON. Try again with count 3 or retry in a minute.";
  }
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

function toGenerateError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof z.ZodError) {
    return new HttpError(422, formatStoredError(err), "AI_SCHEMA");
  }
  if (/api.?key|not configured|401|incorrect api/i.test(message)) {
    return new HttpError(
      502,
      "AI provider rejected the request. Check OPENAI_API_KEY, ANTHROPIC_API_KEY, or ensure BEDROCK_ENABLED=true with the EC2 IAM role.",
      "AI_AUTH",
    );
  }
  if (/model did not return json|unexpected token|json at/i.test(message)) {
    return new HttpError(
      422,
      "The model response was not valid JSON. Try again with count 3 or retry in a minute.",
      "AI_JSON",
    );
  }
  return new HttpError(502, message.slice(0, 280), "AI_GENERATE");
}

const TRIVIAL = /^(what is|define|which statement describes|which of the following is a definition)/i;

export function assertNonTrivial(q: GeneratedQuestion, level: CurriculumLevel) {
  if (level === "FOUNDATION") return;
  if (TRIVIAL.test(q.questionText.trim())) {
    throw new Error("Generated question uses a prohibited trivial stem");
  }
}

export async function generateQuestionSet(params: {
  moduleId: string;
  count: number;
  targetDifficulty?: DifficultyBand;
  typeDistribution?: Partial<Record<QuestionType, number>>;
  actorId?: string;
  provider?: "openai" | "anthropic" | "bedrock";
  generationId?: string;
}) {
  const mod = await prisma.module.findUnique({
    where: { id: params.moduleId },
    include: { domain: true },
  });
  if (!mod) throw new Error("Module not found");
  const moduleId = mod.id;
  const moduleCode = mod.code;
  const moduleLevel = mod.level;
  const moduleName = mod.name;
  const moduleDescription = mod.description;
  const moduleObjectives = mod.learningObjectives;
  const moduleTargetRole = mod.targetRole;
  const domainName = mod.domain.name;

  const generation = params.generationId
    ? await prisma.aIQuestionGeneration.update({
        where: { id: params.generationId },
        data: { status: AIJobStatus.RUNNING, model: aiModels.generation },
      })
    : await prisma.aIQuestionGeneration.create({
        data: {
          moduleId: mod.id,
          requestedCount: params.count,
          model: aiModels.generation,
          promptVersion: PROMPT_VERSION,
          status: AIJobStatus.RUNNING,
          createdById: params.actorId,
        },
      });

  const existingRows = await prisma.question.findMany({
    where: { moduleId },
    select: { questionText: true, scenario: true, fingerprint: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const existingFingerprints = new Set(existingRows.map((q) => q.fingerprint));
  const avoidStems = existingRows.map((q) => q.questionText.slice(0, 140));

  const system = `You are the Question Generator for SEAL, an enterprise Claude capability assessment platform.
You produce rigorous, scenario-driven assessment items. You never write trivia.
Prohibited stems except where Foundation level truly requires them: "What is...", "Define...", "Which statement describes...".
Every distractor must be technically credible. Avoid obvious answers.
Candidate should need real Claude / Claude Code / MCP / agentic / context-engineering judgment.
Each questionText and scenario MUST be distinct from every other item in this batch and from avoidStems.
Return a single JSON object. No markdown. Use this exact shape:

{"questions":[{
  "questionType":"SCENARIO_DECISION",
  "difficulty":"APPLIED",
  "questionText":"string, at least 40 characters",
  "scenario":"string, at least 40 characters",
  "options":[{"key":"A","body":"option text at least 8 chars","isCorrect":false}],
  "correctAnswer":{"keys":["B"]},
  "answerExplanation":"string, at least 40 characters",
  "scoringRubric":{"criteria":[{"id":"c1","description":"Correct technical choice","maxPoints":1}]},
  "skillsMeasured":["PROMPT_ENGINEERING"],
  "conceptsMeasured":["instruction hierarchy"],
  "estimatedTimeSeconds":180,
  "sourceReferences":[{"sourceType":"CURRICULUM","sourceTitle":"Module curriculum"}]
}]}

questionType must be one of: SINGLE_MCQ, MULTI_SELECT, SCENARIO_DECISION, CODE_ANALYSIS, FIND_THE_DEFECT, ARCHITECTURE_DECISION, SEQUENCE, MATCH, CONFIGURATION_ANALYSIS, PROMPT_CRITIQUE, CONTEXT_DESIGN, MCP_SCHEMA, TOOL_CALL_REASONING, JSON_STRUCTURED_OUTPUT, CLAUDE_CODE_WORKFLOW, SECURITY_INCIDENT, COST_LATENCY, EVALUATION_DESIGN, AGENT_WORKFLOW, SHORT_RESPONSE.
difficulty must be one of: CONCEPTUAL, APPLIED, MODERATE, HARD, VERY_HARD, EXPERT, ADVERSARIAL.
options MUST be a JSON array, never an object.`;

  function buildUser(instruction: string) {
    return JSON.stringify({
      instruction,
      module: {
        code: moduleCode,
        name: moduleName,
        level: moduleLevel,
        domain: domainName,
        description: moduleDescription,
        learningObjectives: moduleObjectives,
        targetRole: moduleTargetRole,
      },
      targetDifficulty: params.targetDifficulty ?? null,
      typeDistribution: params.typeDistribution ?? null,
      avoidStems,
      rules: [
        "Favor realistic enterprise incidents over definitions.",
        "Include code, JSON, YAML, or architecture artifacts where the type warrants it.",
        "Map skillsMeasured to concrete competencies (not vague labels).",
        "estimatedTimeSeconds must reflect actual cognitive load.",
        "correctAnswer.keys must match option keys for choice items.",
        "Do NOT rewrite or lightly paraphrase any avoidStems item — invent new scenarios.",
      ],
    });
  }

  try {
    const resolvedProvider = resolveProviderName(params.provider);
    const provider = getAIProvider(resolvedProvider);
    const model = resolvedProvider === "openai" ? env.OPENAI_MODEL : aiModels.generation;
    const maxTokens = Math.min(16384, Math.max(env.AI_MAX_TOKENS, 3200 + params.count * 1800));

    async function callModel(temperature: number, instruction: string) {
      return provider.complete({
        system,
        user: buildUser(instruction),
        model,
        temperature,
        maxTokens,
        purpose: "GENERATE",
        actorId: params.actorId,
        resourceType: "Module",
        resourceId: moduleId,
      });
    }

    function parseCompletion(text: string) {
      return generatedSetSchema.parse(extractJson(text));
    }

    async function saveQuestions(
      items: GeneratedQuestion[],
      generationModel: string,
    ): Promise<{
      createdIds: string[];
      skippedTrivial: number;
      skippedDuplicate: number;
      skippedCreate: number;
      parsedCount: number;
    }> {
      const createdIds: string[] = [];
      const batchFingerprints = new Set<string>();
      let skippedTrivial = 0;
      let skippedDuplicate = 0;
      let skippedCreate = 0;
      const slice = items.slice(0, params.count);

      for (const item of slice) {
        try {
          assertNonTrivial(item, moduleLevel);
        } catch {
          skippedTrivial += 1;
          continue;
        }
        const fp = fingerprintQuestion(item.questionText, item.scenario ?? "");
        if (batchFingerprints.has(fp) || existingFingerprints.has(fp)) {
          skippedDuplicate += 1;
          continue;
        }
        const duplicate = await prisma.question.findFirst({
          where: { moduleId, fingerprint: fp },
          select: { id: true },
        });
        if (duplicate) {
          skippedDuplicate += 1;
          continue;
        }
        batchFingerprints.add(fp);

        try {
          const weight = DEFAULT_DIFFICULTY_WEIGHTS[item.difficulty];
          const question = await prisma.question.create({
            data: {
              moduleId,
              level: moduleLevel,
              difficulty: item.difficulty,
              questionType: item.questionType,
              questionText: item.questionText,
              scenario: item.scenario ?? null,
              codeSnippet: item.codeSnippet ?? null,
              codeLanguage: item.codeLanguage ?? null,
              architectureArtifact: item.architectureArtifact ? (item.architectureArtifact as object) : undefined,
              correctAnswer: item.correctAnswer,
              answerExplanation: item.answerExplanation,
              scoringRubric: item.scoringRubric,
              estimatedTimeSeconds: item.estimatedTimeSeconds,
              maxPoints: item.questionType === "SHORT_RESPONSE" ? 4 : 1,
              difficultyWeight: weight,
              generationModel,
              generationPromptVersion: PROMPT_VERSION,
              fingerprint: fp,
              status: QuestionStatus.DRAFT,
              reviewStatus: ReviewStatus.PENDING,
              options: {
                create: (item.options ?? []).map((o, i) => ({
                  key: o.key,
                  body: o.body,
                  isCorrect: o.isCorrect,
                  position: i,
                })),
              },
              sources: {
                create: item.sourceReferences.map((s) => ({
                  sourceType: s.sourceType,
                  sourceTitle: s.sourceTitle,
                  sourceURL: s.sourceURL,
                  relevantConcept: s.relevantConcept,
                  retrievedAt: new Date(),
                })),
              },
            },
          });
          createdIds.push(question.id);
          existingFingerprints.add(fp);
        } catch (createErr) {
          skippedCreate += 1;
          logger.warn("question create failed", {
            module: moduleCode,
            error: createErr instanceof Error ? createErr.message : String(createErr),
          });
        }
      }

      return {
        createdIds,
        skippedTrivial,
        skippedDuplicate,
        skippedCreate,
        parsedCount: slice.length,
      };
    }

    const baseInstruction = `Generate ${params.count} unique questions for this module. Each must cover a different scenario or failure mode.`;
    let completion = await callModel(0.55, baseInstruction);
    let parsed;
    try {
      parsed = parseCompletion(completion.text);
    } catch (firstErr) {
      logger.warn("question generation parse failed, retrying once", {
        module: moduleCode,
        preview: completion.text.slice(0, 240),
        error: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });
      completion = await callModel(0.35, baseInstruction);
      try {
        parsed = parseCompletion(completion.text);
      } catch (retryErr) {
        logger.warn("question generation retry failed", {
          module: moduleCode,
          preview: completion.text.slice(0, 240),
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        throw retryErr;
      }
    }

    let saved = await saveQuestions(parsed.questions, completion.model);

    if (saved.createdIds.length === 0) {
      logger.warn("question generation saved zero items, retrying for diversity", {
        module: moduleCode,
        ...saved,
      });
      const diversityInstruction = `PREVIOUS OUTPUT WAS ALL DUPLICATES. Generate ${params.count} brand-new questions with completely different scenarios, industries, and technical artifacts than avoidStems. Vary questionType across the set.`;
      completion = await callModel(0.85, diversityInstruction);
      parsed = parseCompletion(completion.text);
      saved = await saveQuestions(parsed.questions, completion.model);
    }

    if (saved.createdIds.length === 0) {
      const parts = [
        `parsed ${saved.parsedCount}`,
        saved.skippedDuplicate ? `${saved.skippedDuplicate} duplicate` : null,
        saved.skippedTrivial ? `${saved.skippedTrivial} trivial stem` : null,
        saved.skippedCreate ? `${saved.skippedCreate} failed to save` : null,
      ].filter(Boolean);
      throw new Error(
        `No questions were saved (${parts.join(", ")}). The bank already has similar items — try again or clear old drafts for this module.`,
      );
    }

    const resultSummary = {
      parsedCount: saved.parsedCount,
      createdCount: saved.createdIds.length,
      skippedTrivial: saved.skippedTrivial,
      skippedDuplicate: saved.skippedDuplicate,
      skippedCreate: saved.skippedCreate,
    };

    await prisma.aIQuestionGeneration.update({
      where: { id: generation.id },
      data: {
        status: AIJobStatus.SUCCEEDED,
        createdCount: saved.createdIds.length,
        resultSummary,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        estimatedCostUsd: new Decimal(completion.estimatedCostUsd),
        completedAt: new Date(),
      },
    });

    return { generationId: generation.id, questionIds: saved.createdIds, ...resultSummary };
  } catch (err) {
    await prisma.aIQuestionGeneration.update({
      where: { id: generation.id },
      data: {
        status: AIJobStatus.FAILED,
        error: formatStoredError(err),
        completedAt: new Date(),
      },
    });
    throw toGenerateError(err);
  }
}
