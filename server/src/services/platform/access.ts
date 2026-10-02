import { prisma } from "../../lib/prisma.js";
import { forbidden } from "../../lib/errors.js";

export type PlatformAccess = {
  assessmentEnabled: boolean;
  playgroundEnabled: boolean;
};

const KEY = "platform_access";

export async function getPlatformAccess(): Promise<PlatformAccess> {
  const row = await prisma.systemConfiguration.findUnique({ where: { key: KEY } });
  const value = (row?.value ?? {}) as Partial<PlatformAccess>;
  return {
    assessmentEnabled: value.assessmentEnabled !== false,
    playgroundEnabled: value.playgroundEnabled !== false,
  };
}

export async function setPlatformAccess(next: PlatformAccess, updatedById: string) {
  await prisma.systemConfiguration.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next, updatedById },
    update: { value: next, updatedById },
  });
  return next;
}

export async function assertAssessmentOpen() {
  const access = await getPlatformAccess();
  if (!access.assessmentEnabled) {
    throw forbidden("The assessment is closed. Practice in the playground until a super admin opens the sitting.");
  }
}

export async function assertPlaygroundOpen() {
  const access = await getPlatformAccess();
  if (!access.playgroundEnabled) {
    throw forbidden("The playground is closed.");
  }
}
