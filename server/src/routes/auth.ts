import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { login, rotateRefresh, revokeRefresh, refreshCookie, signAccess } from "../services/auth/authService.js";
import { validate } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { AssignmentStatus, AttemptStatus } from "@prisma/client";

export const authRouter = Router();

authRouter.post(
  "/login",
  validate(z.object({ email: z.string().min(1), password: z.string().min(1) })),
  async (req, res, next) => {
    try {
      let { email, password } = req.body as { email: string; password: string };
      // Accept plain username (no @) — convert to internal email format
      if (!email.includes("@")) email = `${email.toLowerCase().trim()}@seal.local`;
      const result = await login(email, password, { ip: req.ip, userAgent: req.get("user-agent") ?? undefined });
      res.cookie(refreshCookie.name, result.refreshToken, refreshCookie.options);
      const assignment =
        result.user.role === "TRAINEE" && result.user.traineeProfile
          ? await prisma.assessmentAssignment.findFirst({
              where: { traineeId: result.user.traineeProfile.id },
              include: { template: true, attempts: true },
              orderBy: { createdAt: "desc" },
            })
          : null;
      await audit({ actorId: result.user.id, action: "user.login", resourceType: "User", resourceId: result.user.id, req });
      res.json({
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
          trainee: result.user.traineeProfile
            ? {
                id: result.user.traineeProfile.id,
                firstName: result.user.traineeProfile.firstName,
                lastName: result.user.traineeProfile.lastName,
                assignedLevel: result.user.traineeProfile.assignedLevel,
                employeeId: result.user.traineeProfile.employeeId,
              }
            : null,
        },
        assessment: assignment
          ? {
              assignmentId: assignment.id,
              name: assignment.template.name,
              level: assignment.assignedLevel,
              status: assignment.status,
              expiresAt: assignment.expiresAt,
              attemptStatus: assignment.attempts[0]?.status ?? null,
            }
          : null,
      });
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.[refreshCookie.name];
    if (!token) return res.status(401).json({ error: "No refresh token", code: "UNAUTHORIZED" });
    const rotated = await rotateRefresh(token, { ip: req.ip, userAgent: req.get("user-agent") ?? undefined });
    res.cookie(refreshCookie.name, rotated.refreshToken, refreshCookie.options);
    res.json({ accessToken: rotated.accessToken, expiresIn: 15 * 60 });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[refreshCookie.name];
    if (token) await revokeRefresh(token);
    res.clearCookie(refreshCookie.name, { path: "/api/auth" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { traineeProfile: true },
    });
    const assignment = user?.traineeProfile
      ? await prisma.assessmentAssignment.findFirst({
          where: { traineeId: user.traineeProfile.id, status: { in: [AssignmentStatus.ACTIVE, AssignmentStatus.SCHEDULED] } },
          include: { template: true, attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
        })
      : null;
    res.json({
      user: {
        id: user!.id,
        email: user!.email,
        role: user!.role,
        trainee: user!.traineeProfile,
      },
      assessment: assignment
        ? {
            assignmentId: assignment.id,
            name: assignment.template.name,
            level: assignment.assignedLevel,
            status: assignment.status,
            expiresAt: assignment.expiresAt,
            attemptId: assignment.attempts[0]?.id,
            attemptStatus: assignment.attempts[0]?.status ?? AttemptStatus.PENDING,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

export { signAccess };
