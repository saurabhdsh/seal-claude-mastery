import type { NextFunction, Request, Response } from "express";
import { verifyAccess } from "../services/auth/authService.js";
import { can, type Permission } from "../services/rbac/permissions.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  traineeProfileId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw unauthorized();
    const claims = verifyAccess(token);
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      include: { traineeProfile: true },
    });
    if (!user || !user.isActive) throw unauthorized("Account disabled");
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      traineeProfileId: user.traineeProfile?.id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const ok = perms.some((p) => can(req.user!.role, p));
    if (!ok) return next(forbidden());
    next();
  };
}
