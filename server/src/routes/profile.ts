import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { assertPassword, hashPassword, verifyPassword } from "../services/auth/authService.js";
import { badRequest } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
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
    const email = user!.email;
    res.json({
      id: user!.id,
      email,
      username: email.endsWith("@seal.local") ? email.replace("@seal.local", "") : email,
      role: user!.role,
      passwordChangedAt: user!.passwordChangedAt,
      trainee: user!.traineeProfile,
    });
  } catch (e) {
    next(e);
  }
});

profileRouter.post(
  "/password",
  validate(
    z.object({
      current: z.string().min(1),
      next: z.string().min(1),
      confirm: z.string().min(1),
    }),
  ),
  async (req, res, next) => {
    try {
      if (req.body.next !== req.body.confirm) throw badRequest("New password and confirmation do not match");
      if (req.body.current === req.body.next) throw badRequest("Choose a new password that is different from the current one");
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user || !(await verifyPassword(user.passwordHash, req.body.current))) {
        throw badRequest("Current password is incorrect");
      }
      assertPassword(req.body.next);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(req.body.next), passwordChangedAt: new Date() },
      });
      await audit({
        actorId: req.user!.id,
        action: "profile.password_changed",
        resourceType: "User",
        resourceId: user.id,
        req,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
