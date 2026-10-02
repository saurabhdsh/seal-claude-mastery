/**
 * Loads the October cohort (31 trainees), creates the full-curriculum
 * adversarial capstone, and assigns it to every person on the roster.
 *
 * Run on EC2 after deploy:
 *   docker compose exec api node dist/scripts/loadCohortCapstone.js
 *
 * Shared password (override with COHORT_PASSWORD): ClaudeMastery@2026
 */
import { AssignmentStatus, CurriculumLevel } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { assertPassword, hashPassword } from "../services/auth/authService.js";

const PASSWORD = process.env.COHORT_PASSWORD ?? "ClaudeMastery@2026";
const TEMPLATE_NAME = "Full curriculum capstone — adversarial";

const COHORT: { firstName: string; lastName: string; username: string }[] = [
  { firstName: "Kaushik", lastName: "Basu", username: "kaushik.basu" },
  { firstName: "Bharat", lastName: "Veldanda", username: "bharat.veldanda" },
  { firstName: "Rakesh Chandra", lastName: "Vemulavada", username: "rakesh.vemulavada" },
  { firstName: "Debajyoti", lastName: "Bhattacharya", username: "debajyoti.bhattacharya" },
  { firstName: "Sai Venkat", lastName: "Ramanna", username: "sai.ramanna" },
  { firstName: "Gnana Sekhar", lastName: "Kamasani", username: "gnana.kamasani" },
  { firstName: "Surya Shekhar", lastName: "Mitra", username: "surya.mitra" },
  { firstName: "Swarna Basilica", lastName: "Kumar", username: "swarna.kumar" },
  { firstName: "Subhasis", lastName: "Roy", username: "subhasis.roy" },
  { firstName: "Renuka", lastName: "Vabilisetty", username: "renuka.vabilisetty" },
  { firstName: "Arijit", lastName: "Goswami", username: "arijit.goswami" },
  { firstName: "Aditya Singh", lastName: "Chandel", username: "aditya.chandel" },
  { firstName: "Viswanathan Prakash", lastName: "Viswanathan", username: "viswanathan.prakash" },
  { firstName: "Gurminder Singh", lastName: "Malhotra", username: "gurminder.malhotra" },
  { firstName: "Debojyoti", lastName: "Banerjee", username: "debojyoti.banerjee" },
  { firstName: "Sharmendra", lastName: "Singh", username: "sharmendra.singh" },
  { firstName: "Mahendra", lastName: "Bisht", username: "mahendra.bisht" },
  { firstName: "Mayank", lastName: "Bhardwaj", username: "mayank.bhardwaj" },
  { firstName: "Satyam", lastName: "Jaiswal", username: "satyam.jaiswal" },
  { firstName: "Azam", lastName: "Naqvi", username: "azam.naqvi" },
  { firstName: "Mukul", lastName: "Bhardwaj", username: "mukul.bhardwaj" },
  { firstName: "Rani", lastName: "Avula", username: "rani.avula" },
  { firstName: "Richa", lastName: "Singal", username: "richa.singal" },
  { firstName: "Siddhant", lastName: "Barman", username: "siddhant.barman" },
  { firstName: "Nanduri Venkata Sagar", lastName: "Swamy", username: "sagar.swamy" },
  { firstName: "Adrija", lastName: "Sadhu", username: "adrija.sadhu" },
  { firstName: "Shiksha", lastName: "Rawat", username: "shiksha.rawat" },
  { firstName: "Vaishali", lastName: "Sahu", username: "vaishali.sahu" },
  { firstName: "Aditya", lastName: "Guntupalli", username: "aditya.guntupalli" },
  { firstName: "Aditya Vardhan", lastName: "Madivada", username: "aditya.madivada" },
  { firstName: "Rishit", lastName: "Srivastava", username: "rishit.srivastava" },
];

const LEVEL_MIX = { FOUNDATION: 0.1, PRACTITIONER: 0.2, ADVANCED: 0.35, EXPERT: 0.35 };
const DIFFICULTY_MIX = { HARD: 0.2, VERY_HARD: 0.3, EXPERT: 0.3, ADVERSARIAL: 0.2 };
const TYPE_MIX = {
  CODE_ANALYSIS: 0.12,
  FIND_THE_DEFECT: 0.1,
  CLAUDE_CODE_WORKFLOW: 0.1,
  SCENARIO_DECISION: 0.12,
  ARCHITECTURE_DECISION: 0.1,
  SECURITY_INCIDENT: 0.08,
  AGENT_WORKFLOW: 0.08,
  MCP_SCHEMA: 0.06,
  TOOL_CALL_REASONING: 0.06,
  PROMPT_CRITIQUE: 0.06,
  EVALUATION_DESIGN: 0.06,
  SHORT_RESPONSE: 0.06,
};

function moduleWeight(level: CurriculumLevel) {
  if (level === "EXPERT") return 2.5;
  if (level === "ADVANCED") return 2;
  if (level === "PRACTITIONER") return 1.4;
  return 1;
}

async function upsertTrainee(row: (typeof COHORT)[number], passwordHash: string) {
  const email = `${row.username}@seal.local`;
  const byEmail = await prisma.user.findUnique({ where: { email }, include: { traineeProfile: true } });
  const byEmployee = await prisma.traineeProfile.findUnique({
    where: { employeeId: row.username },
    include: { user: true },
  });
  const existing = byEmail ?? (byEmployee ? { ...byEmployee.user, traineeProfile: byEmployee } : null);

  if (existing?.traineeProfile) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true, role: "TRAINEE" },
    });
    await prisma.traineeProfile.update({
      where: { id: existing.traineeProfile.id },
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        assignedLevel: "EXPERT",
        disabledAt: null,
      },
    });
    return { id: existing.traineeProfile.id, created: false };
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "TRAINEE",
      traineeProfile: {
        create: {
          employeeId: row.username,
          firstName: row.firstName,
          lastName: row.lastName,
          assignedLevel: "EXPERT",
          jobRole: "Claude cohort",
        },
      },
    },
    include: { traineeProfile: true },
  });
  return { id: user.traineeProfile!.id, created: true };
}

async function main() {
  assertPassword(PASSWORD);
  if (COHORT.length !== 31) throw new Error(`Expected 31 trainees, got ${COHORT.length}`);

  const passwordHash = await hashPassword(PASSWORD);
  const modules = await prisma.module.findMany({ orderBy: [{ level: "asc" }, { sortOrder: "asc" }] });
  if (modules.length === 0) throw new Error("No curriculum modules. Run the app seed first.");

  const approved = await prisma.question.count({ where: { status: "APPROVED" } });
  const targetQuestionCount = Math.min(60, Math.max(1, approved));
  const durationSeconds = Math.min(10800, Math.max(5400, targetQuestionCount * 180));

  const templateData = {
    name: TEMPLATE_NAME,
    description:
      "Adversarial full-curriculum capstone.  Hard, expert, and adversarial items across Foundation through Expert, weighted to coding, defects, architecture, security, and agent workflows.",
    targetLevel: "EXPERT" as const,
    mode: "PROGRESSIVE_MASTERY" as const,
    durationSeconds,
    timeBudgetSeconds: durationSeconds,
    targetQuestionCount,
    levelMix: LEVEL_MIX,
    difficultyMix: DIFFICULTY_MIX,
    typeMix: TYPE_MIX,
    adaptiveEnabled: false,
    allowNavigation: true,
    showAnswerKeyOnComplete: false,
    passingScore: 75,
    isActive: true,
    integrityPolicy: { trackTabSwitch: true, trackCopyPaste: true, autoFail: false },
    prohibitedToolsNote: "No external AI assistants. Closed-book capstone.",
  };

  const existingTemplate = await prisma.assessmentTemplate.findFirst({ where: { name: TEMPLATE_NAME } });
  const template = existingTemplate
    ? await prisma.assessmentTemplate.update({ where: { id: existingTemplate.id }, data: templateData })
    : await prisma.assessmentTemplate.create({ data: templateData });

  await prisma.assessmentTemplateModule.deleteMany({ where: { templateId: template.id } });
  await prisma.assessmentTemplateModule.createMany({
    data: modules.map((m) => ({ templateId: template.id, moduleId: m.id, weight: moduleWeight(m.level) })),
  });

  let created = 0;
  let updated = 0;
  let assigned = 0;
  const startsAt = new Date();
  const expiresAt = new Date(Date.now() + 21 * 86400000);

  for (const row of COHORT) {
    const trainee = await upsertTrainee(row, passwordHash);
    if (trainee.created) created += 1;
    else updated += 1;

    const already = await prisma.assessmentAssignment.findFirst({
      where: {
        templateId: template.id,
        traineeId: trainee.id,
        status: { in: [AssignmentStatus.ACTIVE, AssignmentStatus.SCHEDULED] },
      },
    });
    if (already) continue;

    await prisma.assessmentAssignment.create({
      data: {
        templateId: template.id,
        traineeId: trainee.id,
        assignedLevel: "EXPERT",
        startsAt,
        expiresAt,
        maxAttempts: 1,
        status: AssignmentStatus.ACTIVE,
      },
    });
    assigned += 1;
  }

  console.log(
    JSON.stringify(
      {
        trainees: COHORT.length,
        created,
        updated,
        assigned,
        template: TEMPLATE_NAME,
        questions: targetQuestionCount,
        approvedInBank: approved,
        minutes: Math.round(durationSeconds / 60),
        passingScore: 75,
        attempts: 1,
        expiresInDays: 21,
        password: PASSWORD,
        logins: COHORT.map((r) => r.username),
      },
      null,
      2,
    ),
  );

  if (approved < 40) {
    console.warn(
      `Only ${approved} approved questions in the bank. The sitting needs that many approved items or trainees cannot start. Approve more questions first.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
