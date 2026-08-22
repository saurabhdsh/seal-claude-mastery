import { Router } from "express";
import { z } from "zod";
import Papa from "papaparse";
import {
  AIJobStatus,
  AssignmentStatus,
  CurriculumLevel,
  DifficultyBand,
  Prisma,
  QuestionStatus,
  ReviewStatus,
  Role,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/error.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { hashPassword, assertPassword } from "../../services/auth/authService.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { generateQuestionSet, PROMPT_VERSION } from "../../services/ai/questionGenerator.js";
import { critiqueQuestion } from "../../services/ai/difficultyCalibrator.js";
import { getGenerationQueue } from "../../jobs/worker.js";
import { aiModels } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { evaluateWrittenAnswer } from "../../services/ai/answerEvaluator.js";
import { defaultDifficultyMix, defaultLevelMix, levelsForTemplateMode, STANDARD_QUESTION_COUNT } from "../../services/ai/assessmentAssembler.js";
import { activeProviderName } from "../../config/env.js";
import { fingerprintQuestion } from "../../services/questions/fingerprint.js";
import { dashboardMetrics, questionQuality, competencyWeakness } from "../../services/analytics/queries.js";
import { computeBankStatus, isPendingReview } from "../../services/questions/bankStatus.js";
import { buildResultExcel, buildResultPdf, buildResultsListExcel } from "../../services/export/resultExport.js";

/** Unused non-live drafts that can be deleted before regenerating (keeps APPROVED / RETIRED). */
function clearableDraftWhere(moduleId: string): Prisma.QuestionWhereInput {
  return {
    moduleId,
    status: { in: [QuestionStatus.DRAFT, QuestionStatus.AI_VALIDATED] },
    attemptQuestions: { none: {} },
  };
}

export const adminRouter = Router();
adminRouter.use(requireAuth);

const levelZ = z.nativeEnum(CurriculumLevel);

adminRouter.get("/dashboard", requirePermission("admin.dashboard"), async (_req, res, next) => {
  try {
    res.json(await dashboardMetrics());
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/modules", requirePermission("admin.modules.read"), async (_req, res, next) => {
  try {
    const modules = await prisma.module.findMany({
      include: {
        domain: true,
        _count: { select: { questions: true } },
      },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    });
    const moduleIds = modules.map((m) => m.id);
    const [questions, generations] = await Promise.all([
      prisma.question.findMany({
        where: { moduleId: { in: moduleIds } },
        select: { moduleId: true, status: true, reviewStatus: true, updatedAt: true },
      }),
      prisma.aIQuestionGeneration.findMany({
        where: { moduleId: { in: moduleIds }, status: "SUCCEEDED", completedAt: { not: null } },
        select: { moduleId: true, completedAt: true },
        orderBy: { completedAt: "desc" },
      }),
    ]);

    const approvedCount = new Map<string, number>();
    const pendingReviewCount = new Map<string, number>();
    const clearableDraftCount = new Map<string, number>();
    const lastApprovedAt = new Map<string, Date>();
    for (const q of questions) {
      if (q.status === QuestionStatus.APPROVED) {
        approvedCount.set(q.moduleId, (approvedCount.get(q.moduleId) ?? 0) + 1);
        const prev = lastApprovedAt.get(q.moduleId);
        if (!prev || q.updatedAt > prev) lastApprovedAt.set(q.moduleId, q.updatedAt);
      }
      if (isPendingReview(q.status, q.reviewStatus)) {
        pendingReviewCount.set(q.moduleId, (pendingReviewCount.get(q.moduleId) ?? 0) + 1);
      }
      if (q.status === QuestionStatus.DRAFT || q.status === QuestionStatus.AI_VALIDATED) {
        clearableDraftCount.set(q.moduleId, (clearableDraftCount.get(q.moduleId) ?? 0) + 1);
      }
    }

    const lastGeneratedAt = new Map<string, Date>();
    for (const g of generations) {
      if (!g.completedAt || lastGeneratedAt.has(g.moduleId)) continue;
      lastGeneratedAt.set(g.moduleId, g.completedAt);
    }

    res.json(
      modules.map((m) => {
        const pending = pendingReviewCount.get(m.id) ?? 0;
        const approved = approvedCount.get(m.id) ?? 0;
        const clearable = clearableDraftCount.get(m.id) ?? 0;
        const approvedAt = lastApprovedAt.get(m.id) ?? null;
        const generatedAt = lastGeneratedAt.get(m.id) ?? null;
        const bankStatus = computeBankStatus(pending, approvedAt, generatedAt);
        return {
          ...m,
          questionCount: m._count.questions,
          approvedCount: approved,
          liveBankCount: approved,
          pendingReviewCount: pending,
          clearableDraftCount: clearable,
          bankStatus,
          lastApprovedAt: approvedAt?.toISOString() ?? null,
          lastGeneratedAt: generatedAt?.toISOString() ?? null,
        };
      }),
    );
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/competencies", requirePermission("admin.modules.read"), async (_req, res, next) => {
  try {
    res.json(await prisma.competency.findMany({ orderBy: { name: "asc" } }));
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/trainees", requirePermission("admin.trainees.read"), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "");
    const level = req.query.level as CurriculumLevel | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(100, Number(req.query.pageSize ?? 20));
    const where: Prisma.TraineeProfileWhereInput = {
      AND: [
        q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { employeeId: { contains: q, mode: "insensitive" } },
                { user: { email: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {},
        level ? { assignedLevel: level } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      prisma.traineeProfile.count({ where }),
      prisma.traineeProfile.findMany({
        where,
        include: {
          user: { select: { email: true, isActive: true, lastLoginAt: true } },
          assignments: {
            include: {
              template: true,
              attempts: { include: { result: true }, orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      total,
      page,
      pageSize,
      rows: rows.map((t) => {
        const asg = t.assignments[0];
        const att = asg?.attempts[0];
        return {
          id: t.id,
          userId: t.userId,
          employeeId: t.employeeId,
          username: t.user.email.endsWith("@seal.local") ? t.user.email.replace("@seal.local", "") : t.user.email,
          firstName: t.firstName,
          lastName: t.lastName,
          email: t.user.email,
          assignedLevel: t.assignedLevel,
          department: t.department,
          businessUnit: t.businessUnit,
          isActive: t.user.isActive && !t.disabledAt,
          lastActivity: t.user.lastLoginAt,
          assessment: asg?.template.name ?? null,
          status: asg?.status ?? null,
          score: att?.result?.overallScore ?? null,
          band: att?.result?.proficiencyBand ?? null,
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/trainees/:id", requirePermission("admin.trainees.read"), async (req, res, next) => {
  try {
    const t = await prisma.traineeProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true, isActive: true, lastLoginAt: true, createdAt: true } },
        assignments: {
          include: {
            template: true,
            attempts: { include: { result: { include: { competencies: { include: { competency: true } } } } } },
          },
        },
      },
    });
    if (!t) throw notFound("Trainee not found");
    res.json(t);
  } catch (e) {
    next(e);
  }
});

const traineeBody = z.object({
  username: z.string().min(2).regex(/^[a-z0-9._-]+$/i, "Username may only contain letters, numbers, dots, hyphens, and underscores"),
  password: z.string().min(12),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  businessUnit: z.string().optional(),
  department: z.string().optional(),
  jobRole: z.string().optional(),
  location: z.string().optional(),
  managerName: z.string().optional(),
  assignedLevel: levelZ,
  assignAssessment: z.boolean().optional().default(true),
  maxAttempts: z.number().int().min(1).max(10).optional().default(3),
});

adminRouter.post(
  "/trainees",
  requirePermission("admin.trainees.write"),
  validate(traineeBody),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof traineeBody>;
      const password = body.password;
      assertPassword(password);
      const username = body.username.toLowerCase().trim();
      const syntheticEmail = `${username}@seal.local`;
      const user = await prisma.user.create({
        data: {
          email: syntheticEmail,
          passwordHash: await hashPassword(password),
          role: Role.TRAINEE,
          traineeProfile: {
            create: {
              employeeId: username,
              firstName: body.firstName,
              lastName: body.lastName,
              businessUnit: body.businessUnit,
              department: body.department,
              jobRole: body.jobRole,
              location: body.location,
              managerName: body.managerName,
              assignedLevel: body.assignedLevel,
            },
          },
        },
        include: { traineeProfile: true },
      });
      let assignment = null;
      if (body.assignAssessment !== false && user.traineeProfile) {
        const template = await prisma.assessmentTemplate.findFirst({
          where: { targetLevel: body.assignedLevel, isActive: true },
        });
        if (template) {
          assignment = await prisma.assessmentAssignment.create({
            data: {
              templateId: template.id,
              traineeId: user.traineeProfile.id,
              assignedLevel: body.assignedLevel,
              startsAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 86400000),
              maxAttempts: body.maxAttempts ?? 3,
              assignedById: req.user!.id,
            },
          });
        }
      }
      await notify({
        userId: user.id,
        email: user.email,
        template: "trainee.onboarded",
        payload: {
          loginUrl: `${process.env.APP_URL ?? "http://localhost:5173"}/login`,
          username,
          name: `${body.firstName} ${body.lastName}`,
        },
      });
      await audit({
        actorId: req.user!.id,
        action: "trainee.onboarded",
        resourceType: "TraineeProfile",
        resourceId: user.traineeProfile!.id,
        after: { username, firstName: body.firstName, lastName: body.lastName },
        req,
      });
      res.status(201).json({
        ...user,
        assignment,
        login: { username, temporaryPasswordSet: true },
      });
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.post("/trainees/bulk", requirePermission("admin.trainees.write"), async (req, res, next) => {
  try {
    const csv = String(req.body.csv ?? "");
    if (!csv.trim()) throw badRequest("csv required");
    const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
    const created: string[] = [];
    const errors: { row: number; error: string }[] = [];
    for (const [i, row] of parsed.data.entries()) {
      try {
        const password = row.password || "SealTrainee!2026";
        const user = await prisma.user.create({
          data: {
            email: row.email.toLowerCase(),
            passwordHash: await hashPassword(password),
            role: Role.TRAINEE,
            traineeProfile: {
              create: {
                employeeId: row.employeeId,
                firstName: row.firstName,
                lastName: row.lastName,
                businessUnit: row.businessUnit,
                department: row.department,
                jobRole: row.role,
                location: row.location,
                managerName: row.manager,
                assignedLevel: (row.assignedLevel as CurriculumLevel) || "FOUNDATION",
              },
            },
          },
        });
        created.push(user.id);
      } catch (err) {
        errors.push({ row: i + 2, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await audit({
      actorId: req.user!.id,
      action: "trainee.bulk_onboarded",
      resourceType: "TraineeProfile",
      after: { created: created.length, errors: errors.length },
      req,
    });
    res.json({ created: created.length, errors });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch(
  "/trainees/:id",
  requirePermission("admin.trainees.write"),
  async (req, res, next) => {
    try {
      const t = await prisma.traineeProfile.update({
        where: { id: req.params.id },
        data: {
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          department: req.body.department,
          businessUnit: req.body.businessUnit,
          jobRole: req.body.jobRole,
          location: req.body.location,
          managerName: req.body.managerName,
          assignedLevel: req.body.assignedLevel,
          notes: req.body.notes,
        },
      });
      if (req.body.isActive === false) {
        await prisma.user.update({ where: { id: t.userId }, data: { isActive: false } });
        await prisma.traineeProfile.update({ where: { id: t.id }, data: { disabledAt: new Date() } });
      }
      if (req.body.isActive === true) {
        await prisma.user.update({ where: { id: t.userId }, data: { isActive: true } });
        await prisma.traineeProfile.update({ where: { id: t.id }, data: { disabledAt: null } });
      }
      await audit({ actorId: req.user!.id, action: "trainee.updated", resourceType: "TraineeProfile", resourceId: t.id, req });
      res.json(t);
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.post("/trainees/:id/reset-password", requirePermission("admin.trainees.write"), async (req, res, next) => {
  try {
    const password = String(req.body.password ?? "SealTrainee!2026");
    assertPassword(password);
    const t = await prisma.traineeProfile.findUnique({ where: { id: req.params.id } });
    if (!t) throw notFound();
    await prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password) } });
    await audit({ actorId: req.user!.id, action: "trainee.password_reset", resourceType: "TraineeProfile", resourceId: t.id, req });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/trainees/:id/reset-attempt", requirePermission("admin.trainees.write"), async (req, res, next) => {
  try {
    const assignmentId = String(req.body.assignmentId ?? "");
    const asg = await prisma.assessmentAssignment.findUnique({ where: { id: assignmentId } });
    if (!asg || asg.traineeId !== req.params.id) throw notFound();
    await prisma.assessmentAttempt.updateMany({
      where: { assignmentId, status: { in: ["IN_PROGRESS", "PENDING"] } },
      data: { status: "LOCKED" },
    });
    await prisma.assessmentAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.ACTIVE, maxAttempts: { increment: 1 } },
    });
    await audit({
      actorId: req.user!.id,
      action: "assessment.reset",
      resourceType: "AssessmentAssignment",
      resourceId: assignmentId,
      req,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/trainees/:id/assign",
  requirePermission("admin.assessments.write"),
  validate(
    z.object({
      templateId: z.string(),
      startsAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      maxAttempts: z.number().int().min(1).max(5).default(1),
      assignedLevel: levelZ.optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const t = await prisma.traineeProfile.findUnique({ where: { id: req.params.id } });
      if (!t) throw notFound();
      const asg = await prisma.assessmentAssignment.create({
        data: {
          templateId: req.body.templateId,
          traineeId: t.id,
          assignedLevel: req.body.assignedLevel ?? t.assignedLevel,
          startsAt: new Date(req.body.startsAt),
          expiresAt: new Date(req.body.expiresAt),
          maxAttempts: req.body.maxAttempts,
          assignedById: req.user!.id,
        },
      });
      await notify({
        userId: t.userId,
        template: "assessment.assigned",
        payload: { assignmentId: asg.id },
      });
      await audit({
        actorId: req.user!.id,
        action: "assessment.assigned",
        resourceType: "AssessmentAssignment",
        resourceId: asg.id,
        req,
      });
      res.status(201).json(asg);
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.get("/questions", requirePermission("admin.questions.read"), async (req, res, next) => {
  try {
    const moduleId = req.query.moduleId as string | undefined;
    const status = req.query.status as QuestionStatus | undefined;
    const where: Prisma.QuestionWhereInput = {
      moduleId: moduleId || undefined,
      status: status || undefined,
    };
    const questions = await prisma.question.findMany({
      where,
      include: {
        module: true,
        options: { orderBy: { position: "asc" } },
        critiques: { orderBy: { createdAt: "desc" }, take: 1 },
        competencies: { include: { competency: true } },
        _count: { select: { answers: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json(questions);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/questions/:id", requirePermission("admin.questions.read"), async (req, res, next) => {
  try {
    const q = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: {
        module: true,
        options: true,
        sources: true,
        critiques: true,
        competencies: { include: { competency: true } },
      },
    });
    if (!q) throw notFound();
    res.json(q);
  } catch (e) {
    next(e);
  }
});

adminRouter.patch("/questions/:id", requirePermission("admin.questions.write"), async (req, res, next) => {
  try {
    const before = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound();
    const data: Prisma.QuestionUpdateInput = {
      questionText: req.body.questionText,
      scenario: req.body.scenario,
      answerExplanation: req.body.answerExplanation,
      estimatedTimeSeconds: req.body.estimatedTimeSeconds,
      difficulty: req.body.difficulty,
      editedBy: { connect: { id: req.user!.id } },
    };
    if (req.body.questionText) {
      data.fingerprint = fingerprintQuestion(req.body.questionText, req.body.scenario ?? before.scenario ?? "");
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    await audit({
      actorId: req.user!.id,
      action: "question.modified",
      resourceType: "Question",
      resourceId: q.id,
      before,
      after: q,
      req,
    });
    res.json(q);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/questions/:id/approve", requirePermission("admin.questions.approve"), async (req, res, next) => {
  try {
    const q = await prisma.question.update({
      where: { id: req.params.id },
      data: { status: QuestionStatus.APPROVED, reviewStatus: ReviewStatus.APPROVED },
    });
    await audit({ actorId: req.user!.id, action: "question.approved", resourceType: "Question", resourceId: q.id, req });
    res.json(q);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/questions/:id/reject", requirePermission("admin.questions.approve"), async (req, res, next) => {
  try {
    const q = await prisma.question.update({
      where: { id: req.params.id },
      data: { status: QuestionStatus.DRAFT, reviewStatus: ReviewStatus.REJECTED },
    });
    await audit({ actorId: req.user!.id, action: "question.rejected", resourceType: "Question", resourceId: q.id, req });
    res.json(q);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/questions/:id/retire", requirePermission("admin.questions.write"), async (req, res, next) => {
  try {
    const q = await prisma.question.update({
      where: { id: req.params.id },
      data: { status: QuestionStatus.RETIRED },
    });
    await audit({ actorId: req.user!.id, action: "question.retired", resourceType: "Question", resourceId: q.id, req });
    res.json(q);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/modules/:moduleId/clear-pending-drafts",
  requirePermission("admin.questions.write"),
  async (req, res, next) => {
    try {
      const moduleId = req.params.moduleId;
      const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { id: true, code: true } });
      if (!mod) throw notFound("Module not found");

      const candidates = await prisma.question.findMany({
        where: clearableDraftWhere(moduleId),
        select: { id: true },
      });
      const ids = candidates.map((q) => q.id);
      if (ids.length === 0) {
        res.json({ moduleId, deleted: 0, message: "No unused drafts to clear." });
        return;
      }

      const deleted = await prisma.question.deleteMany({ where: { id: { in: ids } } });
      await audit({
        actorId: req.user!.id,
        action: "question.pending_drafts_cleared",
        resourceType: "Module",
        resourceId: moduleId,
        after: { deleted: deleted.count, code: mod.code },
        req,
      });
      res.json({
        moduleId,
        deleted: deleted.count,
        message: `Cleared ${deleted.count} unused draft${deleted.count === 1 ? "" : "s"}.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.post("/questions/:id/clone", requirePermission("admin.questions.write"), async (req, res, next) => {
  try {
    const src = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: { options: true, competencies: true },
    });
    if (!src) throw notFound();
    const clone = await prisma.question.create({
      data: {
        moduleId: src.moduleId,
        level: src.level,
        difficulty: src.difficulty,
        questionType: src.questionType,
        questionText: src.questionText + " (clone)",
        scenario: src.scenario,
        codeSnippet: src.codeSnippet,
        codeLanguage: src.codeLanguage,
        architectureArtifact: src.architectureArtifact ?? undefined,
        correctAnswer: src.correctAnswer as Prisma.InputJsonValue,
        answerExplanation: src.answerExplanation,
        scoringRubric: src.scoringRubric as Prisma.InputJsonValue,
        estimatedTimeSeconds: src.estimatedTimeSeconds,
        maxPoints: src.maxPoints,
        difficultyWeight: src.difficultyWeight,
        fingerprint: fingerprintQuestion(src.questionText + " (clone)", src.scenario ?? ""),
        status: QuestionStatus.DRAFT,
        options: { create: src.options.map((o) => ({ key: o.key, body: o.body, isCorrect: o.isCorrect, position: o.position })) },
        competencies: { create: src.competencies.map((c) => ({ competencyId: c.competencyId, weight: c.weight })) },
      },
    });
    res.status(201).json(clone);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/questions/generate",
  requirePermission("admin.ai"),
  validate(
    z.object({
      moduleId: z.string(),
      count: z.number().int().min(1).max(25).default(5),
      targetDifficulty: z.nativeEnum(DifficultyBand).optional(),
      runCritic: z.boolean().optional(),
      provider: z.enum(["openai", "anthropic", "bedrock"]).optional(),
      replacePendingDrafts: z.boolean().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const moduleId = req.body.moduleId as string;
      const count = req.body.count as number;
      const actorId = req.user!.id;
      const provider = req.body.provider as "openai" | "anthropic" | "bedrock" | undefined;
      const runCritic = req.body.runCritic !== false;
      const replacePendingDrafts = req.body.replacePendingDrafts === true;

      const module = await prisma.module.findUnique({ where: { id: moduleId } });
      if (!module) throw notFound("Module not found");

      let clearedPending = 0;
      if (replacePendingDrafts) {
        const pending = await prisma.question.findMany({
          where: clearableDraftWhere(moduleId),
          select: { id: true },
        });
        if (pending.length) {
          const deleted = await prisma.question.deleteMany({ where: { id: { in: pending.map((q) => q.id) } } });
          clearedPending = deleted.count;
          await audit({
            actorId,
            action: "question.pending_drafts_cleared",
            resourceType: "Module",
            resourceId: moduleId,
            after: { deleted: clearedPending, beforeGenerate: true },
            req,
          });
        }
      }

      const generation = await prisma.aIQuestionGeneration.create({
        data: {
          moduleId,
          requestedCount: count,
          model: aiModels.generation,
          promptVersion: PROMPT_VERSION,
          status: AIJobStatus.QUEUED,
          createdById: actorId,
        },
      });

      const jobData = {
        generationId: generation.id,
        moduleId,
        count,
        actorId,
        provider,
        runCritic,
      };

      try {
        const job = await getGenerationQueue().add("generate", jobData, { attempts: 1 });
        await audit({
          actorId,
          action: "question.generate.queued",
          resourceType: "AIQuestionGeneration",
          resourceId: generation.id,
          after: { jobId: job.id, count, moduleId },
          req,
        });
        res.status(202).json({
          queued: true,
          generationId: generation.id,
          jobId: job.id,
          moduleId,
          requestedCount: count,
          clearedPending,
        });
      } catch (queueErr) {
        logger.warn("generation queue unavailable, running inline", queueErr);
        const result = await generateQuestionSet({
          moduleId,
          count,
          targetDifficulty: req.body.targetDifficulty,
          actorId,
          provider,
          generationId: generation.id,
        });
        let criticFlagged = 0;
        if (runCritic) {
          for (const id of result.questionIds) {
            try {
              const scored = await critiqueQuestion(id, result.generationId, actorId);
              if (scored.reject) criticFlagged += 1;
            } catch (err) {
              logger.warn("critic failed", err);
            }
          }
        }
        if (criticFlagged > 0) {
          const gen = await prisma.aIQuestionGeneration.findUnique({ where: { id: result.generationId } });
          const summary = (gen?.resultSummary as Record<string, unknown> | null) ?? {};
          await prisma.aIQuestionGeneration.update({
            where: { id: result.generationId },
            data: { resultSummary: { ...summary, criticFlagged } },
          });
        }
        await audit({
          actorId,
          action: "question.generated",
          resourceType: "AIQuestionGeneration",
          resourceId: result.generationId,
          after: { ...result, queued: false, clearedPending },
          req,
        });
        res.json({
          queued: false,
          ...result,
          created: result.questionIds.length,
          requestedCount: count,
          moduleId,
          clearedPending,
        });
      }
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.get("/assessments", requirePermission("admin.assessments.read"), async (_req, res, next) => {
  try {
    const rows = await prisma.assessmentTemplate.findMany({
      include: {
        _count: { select: { assignments: true } },
        modules: { include: { module: { select: { id: true, code: true, name: true, level: true } } } },
        assignments: {
          select: {
            status: true,
            attempts: { select: { status: true }, take: 3 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const allModuleIds = [...new Set(rows.flatMap((t) => t.modules.map((m) => m.moduleId)))];
    const approvedByModule = allModuleIds.length
      ? await prisma.question.groupBy({
          by: ["moduleId"],
          where: { status: QuestionStatus.APPROVED, moduleId: { in: allModuleIds } },
          _count: true,
        })
      : [];
    const approvedMap = Object.fromEntries(approvedByModule.map((r) => [r.moduleId, r._count]));

    res.json(
      rows.map((t) => {
        const liveQuestionCount = t.modules.reduce((n, m) => n + (approvedMap[m.moduleId] ?? 0), 0);
        return {
          ...t,
          stats: {
            assignedCount: t._count.assignments,
            activeCount: t.assignments.filter((a) => a.status === AssignmentStatus.ACTIVE).length,
            completedCount: t.assignments.filter((a) =>
              a.attempts.some((at) => at.status === "COMPLETED"),
            ).length,
            moduleCount: t.modules.length,
            liveQuestionCount,
            bankReady: liveQuestionCount >= STANDARD_QUESTION_COUNT,
          },
        };
      }),
    );
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/assessments/:id", requirePermission("admin.assessments.read"), async (req, res, next) => {
  try {
    const t = await prisma.assessmentTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        modules: { include: { module: true } },
        assignments: {
          include: {
            trainee: { include: { user: { select: { email: true, isActive: true } } } },
            attempts: {
              include: { result: { select: { overallScore: true, proficiencyBand: true } } },
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!t) throw notFound();
    const moduleIds = t.modules.map((m) => m.moduleId);
    const liveQuestionCount = moduleIds.length
      ? await prisma.question.count({
          where: { status: QuestionStatus.APPROVED, moduleId: { in: moduleIds } },
        })
      : 0;
    const perModule = moduleIds.length
      ? await prisma.question.groupBy({
          by: ["moduleId"],
          where: { status: QuestionStatus.APPROVED, moduleId: { in: moduleIds } },
          _count: true,
        })
      : [];
    const perModuleMap = Object.fromEntries(perModule.map((r) => [r.moduleId, r._count]));
    res.json({
      ...t,
      modules: t.modules.map((m) => ({
        ...m,
        liveCount: perModuleMap[m.moduleId] ?? 0,
      })),
      stats: {
        assignedCount: t.assignments.length,
        activeCount: t.assignments.filter((a) => a.status === AssignmentStatus.ACTIVE).length,
        completedCount: t.assignments.filter((a) => a.attempts.some((at) => at.status === "COMPLETED")).length,
        moduleCount: t.modules.length,
        liveQuestionCount,
        bankReady: liveQuestionCount >= STANDARD_QUESTION_COUNT,
      },
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/assessments",
  requirePermission("admin.assessments.write"),
  validate(
    z.object({
      name: z.string().min(3),
      description: z.string().optional(),
      targetLevel: levelZ,
      mode: z.enum(["LEVEL_SPECIFIC", "PROGRESSIVE_MASTERY"]).default("LEVEL_SPECIFIC"),
      durationSeconds: z.number().int().min(600).max(18000).default(5400),
      targetQuestionCount: z.number().int().min(40).max(40).default(STANDARD_QUESTION_COUNT),
      adaptiveEnabled: z.boolean().default(false),
      allowNavigation: z.boolean().default(true),
      showAnswerKeyOnComplete: z.boolean().default(false),
      passingScore: z.number().min(0).max(100).default(70),
      moduleIds: z.array(z.string()).min(1),
      levelMix: z.record(z.number()).optional(),
      difficultyMix: z.record(z.number()).optional(),
      prohibitedToolsNote: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const t = await prisma.assessmentTemplate.create({
        data: {
          name: req.body.name,
          description: req.body.description,
          targetLevel: req.body.targetLevel,
          mode: req.body.mode,
          durationSeconds: req.body.durationSeconds,
          timeBudgetSeconds: req.body.durationSeconds,
          targetQuestionCount: STANDARD_QUESTION_COUNT,
          adaptiveEnabled: req.body.adaptiveEnabled,
          allowNavigation: req.body.allowNavigation,
          showAnswerKeyOnComplete: req.body.showAnswerKeyOnComplete,
          passingScore: req.body.passingScore,
          prohibitedToolsNote: req.body.prohibitedToolsNote,
          levelMix: req.body.levelMix ?? defaultLevelMix(req.body.targetLevel, req.body.mode),
          difficultyMix: req.body.difficultyMix ?? defaultDifficultyMix(req.body.targetLevel),
          integrityPolicy: { trackTabSwitch: true, trackCopyPaste: true, autoFail: false },
          createdById: req.user!.id,
          modules: { create: req.body.moduleIds.map((id: string) => ({ moduleId: id, weight: 1 })) },
        },
      });
      res.status(201).json(t);
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.post(
  "/assessments/:id/assign",
  requirePermission("admin.assessments.write"),
  validate(
    z.object({
      traineeId: z.string(),
      maxAttempts: z.number().int().min(1).max(5).default(1),
      expiresInDays: z.number().int().min(1).max(90).default(30),
    }),
  ),
  async (req, res, next) => {
    try {
      const template = await prisma.assessmentTemplate.findUnique({ where: { id: req.params.id } });
      if (!template) throw notFound("Assessment not found");
      const trainee = await prisma.traineeProfile.findUnique({ where: { id: req.body.traineeId } });
      if (!trainee) throw notFound("Trainee not found");

      const existing = await prisma.assessmentAssignment.findFirst({
        where: {
          templateId: template.id,
          traineeId: trainee.id,
          status: { in: [AssignmentStatus.ACTIVE, AssignmentStatus.SCHEDULED] },
        },
      });
      if (existing) throw conflict("This trainee already has an active assignment for this assessment");

      const startsAt = new Date();
      const expiresAt = new Date(Date.now() + req.body.expiresInDays * 86400000);
      const asg = await prisma.assessmentAssignment.create({
        data: {
          templateId: template.id,
          traineeId: trainee.id,
          assignedLevel: trainee.assignedLevel,
          startsAt,
          expiresAt,
          maxAttempts: req.body.maxAttempts,
          status: AssignmentStatus.ACTIVE,
          assignedById: req.user!.id,
        },
        include: {
          trainee: { include: { user: { select: { email: true } } } },
          template: true,
        },
      });
      await notify({
        userId: trainee.userId,
        template: "assessment.assigned",
        payload: { assignmentId: asg.id },
      });
      await audit({
        actorId: req.user!.id,
        action: "assessment.assigned",
        resourceType: "AssessmentAssignment",
        resourceId: asg.id,
        after: { templateId: template.id, traineeId: trainee.id },
        req,
      });
      res.status(201).json(asg);
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.get("/results", requirePermission("admin.results.read"), async (req, res, next) => {
  try {
    const rows = await prisma.assessmentResult.findMany({
      include: {
        attempt: {
          include: {
            trainee: true,
            assignment: { include: { template: { select: { name: true, passingScore: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/results/export.xlsx", requirePermission("admin.results.read"), async (_req, res, next) => {
  try {
    const file = await buildResultsListExcel();
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/results/:attemptId/export.xlsx", requirePermission("admin.results.read"), async (req, res, next) => {
  try {
    const file = await buildResultExcel(req.params.attemptId);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/results/:attemptId/export.pdf", requirePermission("admin.results.read"), async (req, res, next) => {
  try {
    const file = await buildResultPdf(req.params.attemptId);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/results/:attemptId", requirePermission("admin.results.read"), async (req, res, next) => {
  try {
    const result = await prisma.assessmentResult.findUnique({
      where: { attemptId: req.params.attemptId },
      include: {
        modules: { include: { module: true } },
        competencies: { include: { competency: true } },
        attempt: {
          include: {
            trainee: true,
            assignment: { include: { template: { select: { name: true, passingScore: true } } } },
            integrityEvents: { orderBy: { serverTs: "asc" } },
            answers: true,
            questions: { include: { question: { include: { options: true, sources: true } } } },
            evaluations: true,
          },
        },
      },
    });
    if (!result) throw notFound();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/analytics", requirePermission("admin.analytics"), async (_req, res, next) => {
  try {
    const [dash, quality, weak] = await Promise.all([dashboardMetrics(), questionQuality(), competencyWeakness()]);
    res.json({ ...dash, quality, competencyWeakness: weak });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/ai", requirePermission("admin.ai"), async (_req, res, next) => {
  try {
    const [gens, usage, rejected, critiques] = await Promise.all([
      prisma.aIQuestionGeneration.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { module: { select: { id: true, code: true, name: true } } },
      }),
      prisma.aIUsageLog.aggregate({ _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true }, _count: true }),
      prisma.question.count({ where: { reviewStatus: ReviewStatus.REJECTED } }),
      prisma.aIQuestionCritique.aggregate({ _avg: { overall: true }, _count: true }),
    ]);
    const failed = await prisma.aIQuestionGeneration.count({ where: { status: "FAILED" } });
    const generated = await prisma.question.count({ where: { generationModel: { not: null } } });
    const cfg = await prisma.systemConfiguration.findUnique({ where: { key: "ai_models" } });
    const activeName = activeProviderName();
    const providerStatus = {
      active: activeName,
      bedrock: process.env.BEDROCK_ENABLED === "true",
      bedrockRegion: process.env.AWS_REGION ?? "us-east-1",
      bedrockModel: process.env.BEDROCK_MODEL_ID ?? "",
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
      openaiConfigured: !!process.env.OPENAI_API_KEY,
      ready: activeName === "bedrock"
        ? process.env.BEDROCK_ENABLED === "true"
        : activeName === "openai"
          ? !!process.env.OPENAI_API_KEY
          : !!process.env.ANTHROPIC_API_KEY,
    };
    res.json({
      generations: gens,
      totals: {
        calls: usage._count,
        questionsGenerated: generated,
        questionsRejected: rejected,
        averageCriticScore: critiques._avg.overall,
        generationFailures: failed,
        inputTokens: usage._sum.inputTokens,
        outputTokens: usage._sum.outputTokens,
        estimatedCostUsd: usage._sum.estimatedCostUsd,
      },
      settings: cfg?.value ?? {},
      providerStatus,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch("/ai/settings", requirePermission("admin.config"), async (req, res, next) => {
  try {
    const row = await prisma.systemConfiguration.upsert({
      where: { key: "ai_models" },
      create: { key: "ai_models", value: req.body, updatedById: req.user!.id },
      update: { value: req.body, updatedById: req.user!.id },
    });
    await audit({ actorId: req.user!.id, action: "configuration.changed", resourceType: "SystemConfiguration", resourceId: "ai_models", after: req.body, req });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/audit", requirePermission("admin.audit"), async (req, res, next) => {
  try {
    const rows = await prisma.auditLog.findMany({
      include: { actor: { select: { email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/review", requirePermission("review.queue"), async (_req, res, next) => {
  try {
    const rows = await prisma.aIAnswerEvaluation.findMany({
      where: { status: { in: ["REVIEW_REQUIRED", "PENDING"] } },
      include: { question: true, attempt: { include: { trainee: true, answers: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/review/:id",
  requirePermission("review.queue"),
  validate(
    z.object({
      action: z.enum(["accept", "modify", "reevaluate"]),
      overall: z.number().optional(),
      reason: z.string().min(8),
    }),
  ),
  async (req, res, next) => {
    try {
      const ev = await prisma.aIAnswerEvaluation.findUnique({ where: { id: req.params.id } });
      if (!ev) throw notFound();
      if (req.body.action === "reevaluate") {
        await evaluateWrittenAnswer({ attemptId: ev.attemptId, questionId: ev.questionId, actorId: req.user!.id });
        return res.json({ ok: true });
      }
      if (req.body.action === "modify" && typeof req.body.overall !== "number") throw badRequest("overall required");
      const overall = req.body.action === "modify" ? req.body.overall : ev.overall;
      await prisma.aIAnswerEvaluation.update({
        where: { id: ev.id },
        data: {
          status: "HUMAN_OVERRIDDEN",
          overall,
          reviewerId: req.user!.id,
          reviewerReason: req.body.reason,
        },
      });
      if (typeof overall === "number") {
        await prisma.answer.update({
          where: { attemptId_questionId: { attemptId: ev.attemptId, questionId: ev.questionId } },
          data: { pointsAwarded: overall },
        });
      }
      await audit({
        actorId: req.user!.id,
        action: "result.overridden",
        resourceType: "AIAnswerEvaluation",
        resourceId: ev.id,
        after: req.body,
        req,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.get("/search", requirePermission("admin.dashboard"), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ trainees: [], modules: [], assessments: [] });
    const [trainees, modules, assessments] = await Promise.all([
      prisma.traineeProfile.findMany({
        where: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { employeeId: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 8,
      }),
      prisma.module.findMany({
        where: { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
        take: 8,
      }),
      prisma.assessmentTemplate.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        take: 8,
      }),
    ]);
    res.json({ trainees, modules, assessments });
  } catch (e) {
    next(e);
  }
});

// ── Staff user management ────────────────────────────────────────────────────

const STAFF_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.ASSESSMENT_MANAGER, Role.REVIEWER] as const;

adminRouter.get("/users", requirePermission("admin.config"), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: [...STAFF_ROLES] } },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

const staffUserBody = z.object({
  username: z.string().min(2).regex(/^[a-z0-9._-]+$/i, "Username may only contain letters, numbers, dots, hyphens, and underscores"),
  password: z.string().min(12),
  role: z.enum(["ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"]),
});

adminRouter.post("/users", requirePermission("admin.config"), validate(staffUserBody), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof staffUserBody>;
    assertPassword(body.password);
    const username = body.username.toLowerCase().trim();
    const email = `${username}@seal.local`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict("Username already taken");
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(body.password),
        role: body.role as Role,
      },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true },
    });
    await audit({
      actorId: req.user!.id,
      action: "user.created",
      resourceType: "User",
      resourceId: user.id,
      after: { username, role: body.role },
      req,
    });
    res.status(201).json({ ...user, username });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete("/users/:id", requirePermission("admin.config"), async (req, res, next) => {
  try {
    if (req.params.id === req.user!.id) throw badRequest("You cannot delete your own account");
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound("User not found");
    if (user.role === Role.TRAINEE) throw badRequest("Use DELETE /trainees/:id to remove trainees");
    await prisma.user.delete({ where: { id: req.params.id } });
    await audit({
      actorId: req.user!.id,
      action: "user.deleted",
      resourceType: "User",
      resourceId: req.params.id,
      after: { email: user.email, role: user.role },
      req,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete("/trainees/:id", requirePermission("admin.trainees.write"), async (req, res, next) => {
  try {
    const profile = await prisma.traineeProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!profile) throw notFound("Trainee not found");
    // Cascade: delete user (traineeProfile cascades via DB relation)
    await prisma.user.delete({ where: { id: profile.userId } });
    await audit({
      actorId: req.user!.id,
      action: "trainee.deleted",
      resourceType: "TraineeProfile",
      resourceId: req.params.id,
      after: { email: profile.user.email },
      req,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
