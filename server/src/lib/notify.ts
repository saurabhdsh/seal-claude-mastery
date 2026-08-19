import { NotificationChannel } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import type { Prisma } from "@prisma/client";

export async function notify(params: {
  userId?: string;
  email?: string;
  template: string;
  payload: Record<string, unknown>;
}) {
  const message = {
    template: params.template,
    to: params.email,
    userId: params.userId,
    payload: params.payload,
  };
  logger.info(`[notify:${params.template}]`, message);
  await prisma.notificationLog.create({
    data: {
      userId: params.userId ?? null,
      channel: NotificationChannel.LOG,
      template: params.template,
      payload: message as Prisma.InputJsonValue,
    },
  });
}
