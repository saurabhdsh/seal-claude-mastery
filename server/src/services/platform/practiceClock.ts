import { prisma } from "../../lib/prisma.js";

/** Playground practice block. The wider program is 200 hours; this clock is the 60-hour studio. */
export const PRACTICE_BUDGET_SECONDS = 60 * 60 * 60;

/** A heartbeat may add at most two minutes. A closed laptop cannot dump the gap on the next login. */
const MAX_CREDIT_SECONDS = 120;

/** No heartbeat for three minutes means the page is gone. Close the session and do not credit the gap. */
const STALE_AFTER_SECONDS = 180;

export type ClockSnapshot = {
  budgetSeconds: number;
  spentSeconds: number;
  remainingSeconds: number;
  open: boolean;
};

function creditForGap(gapSeconds: number) {
  if (gapSeconds <= 0) return 0;
  if (gapSeconds > STALE_AFTER_SECONDS) return 0;
  return Math.min(gapSeconds, MAX_CREDIT_SECONDS);
}

function gapSeconds(from: Date, now: Date) {
  return Math.floor((now.getTime() - from.getTime()) / 1000);
}

async function spentSeconds(traineeId: string) {
  const total = await prisma.playgroundSession.aggregate({
    where: { traineeId },
    _sum: { activeSeconds: true },
  });
  return total._sum.activeSeconds ?? 0;
}

export function toClock(spent: number, open: boolean): ClockSnapshot {
  const spentSeconds = Math.max(0, spent);
  return {
    budgetSeconds: PRACTICE_BUDGET_SECONDS,
    spentSeconds,
    remainingSeconds: Math.max(0, PRACTICE_BUDGET_SECONDS - spentSeconds),
    open,
  };
}

async function closeSession(id: string, activeSeconds: number, lastBeatAt: Date, now: Date) {
  const credit = creditForGap(gapSeconds(lastBeatAt, now));
  const endedAt = new Date(lastBeatAt.getTime() + credit * 1000);
  await prisma.playgroundSession.update({
    where: { id },
    data: {
      activeSeconds: activeSeconds + credit,
      endedAt: endedAt > now ? now : endedAt,
    },
  });
}

/** Close sessions whose page stopped heartbeating. Safe to call from the admin log. */
export async function sweepStaleSessions(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);
  const stale = await prisma.playgroundSession.findMany({
    where: { endedAt: null, lastBeatAt: { lt: staleBefore } },
  });
  for (const row of stale) {
    await closeSession(row.id, row.activeSeconds, row.lastBeatAt, now);
  }
}

async function openSession(traineeId: string) {
  const rows = await prisma.playgroundSession.findMany({
    where: { traineeId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  for (const row of rows) {
    await closeSession(row.id, row.activeSeconds, row.lastBeatAt, new Date());
  }
  return prisma.playgroundSession.create({ data: { traineeId } });
}

export async function readClock(traineeId: string): Promise<ClockSnapshot> {
  await sweepStaleSessions();
  const open = await prisma.playgroundSession.findFirst({
    where: { traineeId, endedAt: null },
    select: { id: true },
  });
  return toClock(await spentSeconds(traineeId), !!open);
}

/** Record real time since the previous heartbeat and return the saved clock. */
export async function beatClock(traineeId: string): Promise<ClockSnapshot> {
  const now = new Date();
  const open = await prisma.playgroundSession.findFirst({
    where: { traineeId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!open) {
    await openSession(traineeId);
    return toClock(await spentSeconds(traineeId), true);
  }
  const gap = gapSeconds(open.lastBeatAt, now);
  if (gap > STALE_AFTER_SECONDS) {
    await closeSession(open.id, open.activeSeconds, open.lastBeatAt, now);
    await openSession(traineeId);
    return toClock(await spentSeconds(traineeId), true);
  }
  const credit = creditForGap(gap);
  await prisma.playgroundSession.update({
    where: { id: open.id },
    data: {
      activeSeconds: open.activeSeconds + credit,
      lastBeatAt: now,
    },
  });
  return toClock(await spentSeconds(traineeId), true);
}

/** Stop the open session. Later visits continue from the stored total. */
export async function stopClock(traineeId: string): Promise<ClockSnapshot> {
  const now = new Date();
  const rows = await prisma.playgroundSession.findMany({
    where: { traineeId, endedAt: null },
  });
  for (const row of rows) {
    await closeSession(row.id, row.activeSeconds, row.lastBeatAt, now);
  }
  return toClock(await spentSeconds(traineeId), false);
}

export async function practiceLog() {
  await sweepStaleSessions();
  const [trainees, totals, recent] = await Promise.all([
    prisma.traineeProfile.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true },
    }),
    prisma.playgroundSession.groupBy({
      by: ["traineeId"],
      _sum: { activeSeconds: true },
      _count: { _all: true },
      _max: { lastBeatAt: true },
    }),
    prisma.playgroundSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 2000,
      select: {
        id: true,
        traineeId: true,
        startedAt: true,
        endedAt: true,
        lastBeatAt: true,
        activeSeconds: true,
      },
    }),
  ]);
  const byTrainee = new Map(totals.map((row) => [row.traineeId, row]));
  const sessionsByTrainee = new Map<string, typeof recent>();
  for (const session of recent) {
    const list = sessionsByTrainee.get(session.traineeId) ?? [];
    if (list.length < 30) list.push(session);
    sessionsByTrainee.set(session.traineeId, list);
  }
  const rows = trainees.map((trainee) => {
    const total = byTrainee.get(trainee.id);
    const spent = total?._sum.activeSeconds ?? 0;
    const sessions = sessionsByTrainee.get(trainee.id) ?? [];
    return {
      id: trainee.id,
      name: `${trainee.firstName} ${trainee.lastName}`.trim(),
      employeeId: trainee.employeeId,
      spentSeconds: spent,
      remainingSeconds: Math.max(0, PRACTICE_BUDGET_SECONDS - spent),
      sessionCount: total?._count._all ?? 0,
      lastActiveAt: total?._max.lastBeatAt ?? null,
      inPlayground: sessions.some((session) => session.endedAt == null),
      sessions: sessions.map((session) => ({
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        activeSeconds: session.activeSeconds,
        open: session.endedAt == null,
      })),
    };
  });
  const spentSeconds = rows.reduce((sum, row) => sum + row.spentSeconds, 0);
  return {
    budgetSeconds: PRACTICE_BUDGET_SECONDS,
    programHours: 200,
    practiceHours: 60,
    traineeCount: rows.length,
    inPlayground: rows.filter((row) => row.inPlayground).length,
    spentSeconds,
    trainees: rows,
  };
}
