import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/error.js";
import { forbidden, notFound } from "../lib/errors.js";
import {
  acknowledgeAndBegin,
  getAttemptForTrainee,
  recordIntegrity,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "../services/runtime/attemptService.js";
import { IntegrityEventType } from "@prisma/client";
import { STANDARD_QUESTION_COUNT } from "../services/ai/assessmentAssembler.js";

export const assessmentRouter = Router();
assessmentRouter.use(requireAuth);

assessmentRouter.get("/mine", requirePermission("assessment.take", "admin.results.read"), async (req, res, next) => {
  try {
    if (!req.user!.traineeProfileId) {
      return res.json({ assignments: [] });
    }
    const assignments = await prisma.assessmentAssignment.findMany({
      where: { traineeId: req.user!.traineeProfileId },
      include: { template: { include: { modules: { include: { module: true } } } }, attempts: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    res.json({ assignments });
  } catch (e) {
    next(e);
  }
});

assessmentRouter.get("/assignments/:id/instructions", requirePermission("assessment.take"), async (req, res, next) => {
  try {
    const asg = await prisma.assessmentAssignment.findUnique({
      where: { id: req.params.id },
      include: {
        template: { include: { modules: { include: { module: true } } } },
        trainee: true,
        attempts: true,
      },
    });
    if (!asg || asg.traineeId !== req.user!.traineeProfileId) throw notFound();
    const inProgress = asg.attempts.find((a) => a.status === "IN_PROGRESS");
    const pending = asg.attempts.find((a) => a.status === "PENDING");
    const latestDone = asg.attempts.find((a) =>
      ["COMPLETED", "EXPIRED", "LOCKED"].includes(a.status),
    );
    const consumed = asg.attempts.filter((a) =>
      ["COMPLETED", "EXPIRED", "LOCKED", "SUBMITTED", "EVALUATING"].includes(a.status),
    ).length;
    let existingLevelCount = 0;
    if (inProgress) {
      const rows = await prisma.attemptQuestion.findMany({
        where: { attemptId: inProgress.id },
        select: { question: { select: { level: true } } },
      });
      existingLevelCount = new Set(rows.map((r) => r.question.level)).size;
    }
    const modules = await prisma.module.findMany({
      select: { code: true, name: true, level: true },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    });
    res.json({
      candidate: `${asg.trainee.firstName} ${asg.trainee.lastName}`,
      employeeId: asg.trainee.employeeId,
      assignedLevel: asg.assignedLevel,
      durationSeconds: asg.template.durationSeconds,
      approximateQuestions: STANDARD_QUESTION_COUNT,
      coverage: "All levels — Foundation, Practitioner, Advanced, and Expert — across the full module catalog.",
      modules: modules.map((m) => ({ code: m.code, name: m.name, level: m.level })),
      rules: {
        timerCannotPause: true,
        autosave: true,
        refreshSafe: true,
        autoSubmit: true,
        flagAllowed: true,
        navigation: asg.template.allowNavigation,
        prohibited: asg.template.prohibitedToolsNote,
      },
      assignmentId: asg.id,
      maxAttempts: asg.maxAttempts,
      attemptsUsed: consumed,
      attemptsRemaining: Math.max(0, asg.maxAttempts - consumed),
      existingAttemptId: inProgress?.id ?? pending?.id,
      existingAttemptStatus: inProgress?.status ?? pending?.status ?? null,
      existingQuestionCount: inProgress?.questionCount ?? 0,
      existingLevelCount,
      completedAttemptId: latestDone?.id ?? null,
    });
  } catch (e) {
    next(e);
  }
});

assessmentRouter.post("/assignments/:id/start", requirePermission("assessment.take"), async (req, res, next) => {
  try {
    if (!req.user!.traineeProfileId) throw forbidden();
    const attempt = await startAttempt(req.params.id, req.user!.traineeProfileId);
    res.json({ attemptId: attempt.id, status: attempt.status });
  } catch (e) {
    next(e);
  }
});

assessmentRouter.post("/attempts/:id/begin", requirePermission("assessment.take"), async (req, res, next) => {
  try {
    const session = await acknowledgeAndBegin(req.params.id, req.user!.traineeProfileId!);
    res.json(session);
  } catch (e) {
    next(e);
  }
});

assessmentRouter.get("/attempts/:id", requirePermission("assessment.take"), async (req, res, next) => {
  try {
    res.json(await getAttemptForTrainee(req.params.id, req.user!.traineeProfileId!));
  } catch (e) {
    next(e);
  }
});

assessmentRouter.put(
  "/attempts/:id/answers",
  requirePermission("assessment.take"),
  validate(
    z.object({
      questionId: z.string(),
      selectedKeys: z.array(z.string()).optional(),
      matchPairs: z.record(z.string()).optional(),
      sequence: z.array(z.string()).optional(),
      textResponse: z.string().optional(),
      flagged: z.boolean().optional(),
      timeSpentMs: z.number().optional(),
      currentIndex: z.number().int().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      res.json(await saveAnswer(req.params.id, req.user!.traineeProfileId!, req.body));
    } catch (e) {
      next(e);
    }
  },
);

assessmentRouter.post(
  "/attempts/:id/integrity",
  requirePermission("assessment.take"),
  validate(
    z.object({
      type: z.nativeEnum(IntegrityEventType),
      payload: z.unknown().optional(),
      clientTs: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      await recordIntegrity(
        req.params.id,
        req.user!.traineeProfileId!,
        req.body.type,
        req.body.payload,
        req.body.clientTs,
        req.ip,
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

assessmentRouter.post("/attempts/:id/submit", requirePermission("assessment.take"), async (req, res, next) => {
  try {
    const result = await submitAttempt(req.params.id, req.user!.traineeProfileId!);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

assessmentRouter.get("/attempts/:id/result", requireAuth, async (req, res, next) => {
  try {
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: req.params.id },
      include: { assignment: { include: { template: true } } },
    });
    if (!attempt) throw notFound();
    const isOwner = attempt.traineeId === req.user!.traineeProfileId;
    const isStaff = ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"].includes(req.user!.role);
    if (!isOwner && !isStaff) throw forbidden();
    if (!isStaff) {
      return res.json({
        recorded: true,
        attemptId: attempt.id,
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        questionCount: attempt.questionCount,
      });
    }
    const result = await prisma.assessmentResult.findUnique({
      where: { attemptId: req.params.id },
      include: {
        modules: { include: { module: true } },
        competencies: { include: { competency: true } },
      },
    });
    if (!result) throw notFound("Result not ready");
    res.json({ ...result, showAnswerKey: true });
  } catch (e) {
    next(e);
  }
});
