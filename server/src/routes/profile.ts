import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { assertPassword, hashPassword } from "../services/auth/authService.js";
import { z } from "zod";
import { validate } from "../middleware/error.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { traineeProfile: true },
    });
    res.json({
      id: user!.id,
      email: user!.email,
      role: user!.role,
      trainee: user!.traineeProfile,
    });
  } catch (e) {
    next(e);
  }
});

profileRouter.post(
  "/password",
  validate(z.object({ current: z.string(), next: z.string() })),
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const { verifyPassword } = await import("../services/auth/authService.js");
      if (!user || !(await verifyPassword(user.passwordHash, req.body.current))) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
      assertPassword(req.body.next);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(req.body.next), passwordChangedAt: new Date() },
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
