import type { Request } from "express";
import { prisma } from "./prisma.js";
import type { Prisma } from "@prisma/client";

export async function audit(params: {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      before: (params.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (params.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: params.req?.ip,
      userAgent: params.req?.get("user-agent") ?? null,
    },
  });
}
