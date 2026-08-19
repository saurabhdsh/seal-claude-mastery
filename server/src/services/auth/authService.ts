import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { forbidden, locked, unauthorized, badRequest } from "../../lib/errors.js";

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export const PASSWORD_POLICY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export function assertPassword(password: string) {
  if (!PASSWORD_POLICY.test(password)) {
    throw badRequest(
      "Password must be at least 12 characters and include upper, lower, number, and symbol.",
    );
  }
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export type AccessClaims = {
  sub: string;
  role: Role;
  email: string;
  typ: "access";
};

export function signAccess(user: { id: string; role: Role; email: string }) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, typ: "access" } satisfies AccessClaims,
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL } as jwt.SignOptions,
  );
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefresh(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  return token;
}

export async function rotateRefresh(oldToken: string, meta: { ip?: string; userAgent?: string }) {
  const tokenHash = hashToken(oldToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw unauthorized("Invalid refresh token");
  }
  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user || !user.isActive) throw unauthorized("Account disabled");

  const next = await issueRefresh(user.id, meta);
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedById: hashToken(next) },
  });
  return { user, refreshToken: next, accessToken: signAccess(user) };
}

export async function revokeRefresh(token: string) {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { traineeProfile: true },
  });
  if (!user) throw unauthorized("Invalid email or password");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw locked("Account temporarily locked after failed sign-in attempts");
  }
  if (!user.isActive) throw forbidden("Account is disabled");

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    throw unauthorized("Invalid email or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const accessToken = signAccess(user);
  const refreshToken = await issueRefresh(user.id, meta);
  return { user, accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC };
}

export function verifyAccess(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
    if (payload.typ !== "access") throw unauthorized();
    return payload;
  } catch {
    throw unauthorized("Invalid or expired session");
  }
}

export const refreshCookie = {
  name: "seal_refresh",
  options: {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: REFRESH_TTL_SEC * 1000,
    domain: env.COOKIE_DOMAIN || undefined,
  },
};
