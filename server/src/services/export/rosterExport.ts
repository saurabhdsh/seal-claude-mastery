import ExcelJS from "exceljs";
import { prisma } from "../../lib/prisma.js";
import { PRACTICE_BUDGET_SECONDS, practiceLog } from "../platform/practiceClock.js";

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F7" } };
}

function usernameFromEmail(email: string) {
  return email.endsWith("@seal.local") ? email.replace("@seal.local", "") : email;
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function hoursFromSeconds(totalSeconds: number) {
  return Number((Math.max(0, totalSeconds) / 3600).toFixed(2));
}

export async function buildTraineesExcel() {
  const rows = await prisma.traineeProfile.findMany({
    include: {
      user: { select: { email: true, isActive: true, lastLoginAt: true, createdAt: true } },
      assignments: {
        include: {
          template: { select: { name: true } },
          attempts: { include: { result: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAL Claude Mastery";
  const sheet = wb.addWorksheet("Trainees");
  sheet.columns = [
    { header: "First name", width: 16 },
    { header: "Last name", width: 16 },
    { header: "Full name", width: 28 },
    { header: "Username", width: 22 },
    { header: "Email", width: 28 },
    { header: "Employee ID", width: 18 },
    { header: "Level", width: 14 },
    { header: "Department", width: 18 },
    { header: "Business unit", width: 18 },
    { header: "Active", width: 10 },
    { header: "Assessment", width: 36 },
    { header: "Assignment status", width: 16 },
    { header: "Latest score", width: 12 },
    { header: "Band", width: 20 },
    { header: "Last login", width: 22 },
    { header: "Created", width: 22 },
  ];

  for (const t of rows) {
    const asg = t.assignments[0];
    const att = asg?.attempts[0];
    sheet.addRow([
      t.firstName,
      t.lastName,
      `${t.firstName} ${t.lastName}`.trim(),
      usernameFromEmail(t.user.email),
      t.user.email,
      t.employeeId,
      t.assignedLevel,
      t.department ?? "",
      t.businessUnit ?? "",
      t.user.isActive && !t.disabledAt ? "Yes" : "No",
      asg?.template.name ?? "",
      asg?.status ?? "",
      att?.result?.overallScore == null ? "" : Number(att.result.overallScore.toFixed(2)),
      att?.result?.proficiencyBand?.replaceAll("_", " ") ?? "",
      t.user.lastLoginAt ? new Date(t.user.lastLoginAt).toLocaleString() : "",
      new Date(t.user.createdAt).toLocaleString(),
    ]);
  }
  styleHeader(sheet);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const date = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `SEAL_Trainees_${date}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function buildPracticeLogExcel() {
  const log = await practiceLog();
  const [workspaces, sessions, profiles] = await Promise.all([
    prisma.playgroundWorkspace.findMany({
      select: { traineeId: true, state: true, updatedAt: true },
    }),
    prisma.playgroundSession.findMany({
      orderBy: [{ traineeId: "asc" }, { startedAt: "asc" }],
      include: {
        trainee: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            user: { select: { email: true } },
          },
        },
      },
    }),
    prisma.traineeProfile.findMany({
      select: { id: true, employeeId: true, user: { select: { email: true } } },
    }),
  ]);

  const completedByTrainee = new Map<string, string[]>();
  for (const row of workspaces) {
    const state = (row.state ?? {}) as { completed?: string[] };
    completedByTrainee.set(row.traineeId, state.completed ?? []);
  }
  const usernameByTrainee = new Map(
    profiles.map((p) => [p.id, usernameFromEmail(p.user.email)]),
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAL Claude Mastery";

  const summary = wb.addWorksheet("Summary by trainee");
  summary.columns = [
    { header: "Name", width: 28 },
    { header: "Username", width: 22 },
    { header: "Employee ID", width: 18 },
    { header: "Spent (HH:MM:SS)", width: 16 },
    { header: "Spent hours", width: 12 },
    { header: "Remaining (HH:MM:SS)", width: 18 },
    { header: "Remaining hours", width: 14 },
    { header: "Budget hours", width: 12 },
    { header: "Session count", width: 14 },
    { header: "Stations practiced", width: 16 },
    { header: "Practiced station codes", width: 48 },
    { header: "In playground now", width: 16 },
    { header: "Last active", width: 22 },
  ];
  for (const trainee of log.trainees) {
    const completed = completedByTrainee.get(trainee.id) ?? [];
    summary.addRow([
      trainee.name,
      usernameByTrainee.get(trainee.id) ?? trainee.employeeId,
      trainee.employeeId,
      formatClock(trainee.spentSeconds),
      hoursFromSeconds(trainee.spentSeconds),
      formatClock(trainee.remainingSeconds),
      hoursFromSeconds(trainee.remainingSeconds),
      hoursFromSeconds(PRACTICE_BUDGET_SECONDS),
      trainee.sessionCount,
      completed.length,
      completed.join(", "),
      trainee.inPlayground ? "Yes" : "No",
      trainee.lastActiveAt ? new Date(trainee.lastActiveAt).toLocaleString() : "",
    ]);
  }
  styleHeader(summary);

  const detail = wb.addWorksheet("All sessions");
  detail.columns = [
    { header: "Name", width: 28 },
    { header: "Username", width: 22 },
    { header: "Employee ID", width: 18 },
    { header: "Session ID", width: 28 },
    { header: "Started", width: 22 },
    { header: "Ended", width: 22 },
    { header: "Last heartbeat", width: 22 },
    { header: "Status", width: 10 },
    { header: "Counted (HH:MM:SS)", width: 16 },
    { header: "Counted seconds", width: 14 },
    { header: "Counted hours", width: 12 },
  ];
  for (const session of sessions) {
    const username = usernameFromEmail(session.trainee.user.email);
    detail.addRow([
      `${session.trainee.firstName} ${session.trainee.lastName}`.trim(),
      username,
      session.trainee.employeeId,
      session.id,
      new Date(session.startedAt).toLocaleString(),
      session.endedAt ? new Date(session.endedAt).toLocaleString() : "",
      new Date(session.lastBeatAt).toLocaleString(),
      session.endedAt ? "Closed" : "Open",
      formatClock(session.activeSeconds),
      session.activeSeconds,
      hoursFromSeconds(session.activeSeconds),
    ]);
  }
  styleHeader(detail);

  const overview = wb.addWorksheet("Overview");
  overview.columns = [{ width: 28 }, { width: 40 }];
  const overviewRows: [string, string | number][] = [
    ["SEAL Claude Mastery — Practice log", ""],
    ["Program hours", log.programHours],
    ["Playground practice hours", log.practiceHours],
    ["Budget seconds", log.budgetSeconds],
    ["Trainee count", log.traineeCount],
    ["In playground now", log.inPlayground],
    ["Cohort spent (HH:MM:SS)", formatClock(log.spentSeconds)],
    ["Cohort spent hours", hoursFromSeconds(log.spentSeconds)],
    ["Exported at", new Date().toLocaleString()],
  ];
  overviewRows.forEach(([k, v], i) => {
    const row = overview.addRow([k, v]);
    if (i === 0) {
      row.font = { bold: true, size: 14 };
      overview.mergeCells(1, 1, 1, 2);
    } else {
      row.getCell(1).font = { bold: true };
    }
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const date = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `SEAL_Practice_Log_${date}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
