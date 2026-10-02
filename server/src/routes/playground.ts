import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/error.js";
import { forbidden } from "../lib/errors.js";
import { assertPlaygroundOpen, getPlatformAccess } from "../services/platform/access.js";
import { beatClock, readClock, stopClock } from "../services/platform/practiceClock.js";

export const playgroundRouter = Router();
playgroundRouter.use(requireAuth);

playgroundRouter.get("/access", async (_req, res, next) => {
  try {
    res.json(await getPlatformAccess());
  } catch (e) {
    next(e);
  }
});

playgroundRouter.get("/catalog", async (req, res, next) => {
  try {
    await assertPlaygroundOpen();
    if (req.user!.role !== "TRAINEE" || !req.user!.traineeProfileId) throw forbidden();
    const modules = await prisma.module.findMany({
      include: { domain: true },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    });
    res.json({
      modules: modules.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        description: m.description,
        level: m.level,
        domain: m.domain.name,
        objectives: m.learningObjectives,
      })),
    });
  } catch (e) {
    next(e);
  }
});

playgroundRouter.get("/work", async (req, res, next) => {
  try {
    await assertPlaygroundOpen();
    if (!req.user!.traineeProfileId) throw forbidden();
    const row = await prisma.playgroundWorkspace.findUnique({ where: { traineeId: req.user!.traineeProfileId } });
    res.json(row?.state ?? { drafts: {}, completed: [] });
  } catch (e) {
    next(e);
  }
});

playgroundRouter.get("/clock", async (req, res, next) => {
  try {
    await assertPlaygroundOpen();
    if (!req.user!.traineeProfileId) throw forbidden();
    res.json(await readClock(req.user!.traineeProfileId));
  } catch (e) {
    next(e);
  }
});

playgroundRouter.post("/clock/beat", async (req, res, next) => {
  try {
    await assertPlaygroundOpen();
    if (!req.user!.traineeProfileId) throw forbidden();
    res.json(await beatClock(req.user!.traineeProfileId));
  } catch (e) {
    next(e);
  }
});

playgroundRouter.post("/clock/stop", async (req, res, next) => {
  try {
    if (!req.user!.traineeProfileId) throw forbidden();
    res.json(await stopClock(req.user!.traineeProfileId));
  } catch (e) {
    next(e);
  }
});

playgroundRouter.put(
  "/work",
  validate(
    z.object({
      drafts: z.record(z.string().max(20000)).default({}),
      completed: z.array(z.string()).max(80).default([]),
    }),
  ),
  async (req, res, next) => {
    try {
      await assertPlaygroundOpen();
      if (!req.user!.traineeProfileId) throw forbidden();
      const state = { drafts: req.body.drafts, completed: req.body.completed };
      const row = await prisma.playgroundWorkspace.upsert({
        where: { traineeId: req.user!.traineeProfileId },
        create: { traineeId: req.user!.traineeProfileId, state },
        update: { state },
      });
      res.json(row.state);
    } catch (e) {
      next(e);
    }
  },
);
