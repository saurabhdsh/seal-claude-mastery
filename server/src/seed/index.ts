import { CurriculumLevel, Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../services/auth/authService.js";
import { CURRICULUM, COMPETENCIES } from "./curriculum.js";
import { buildQuestionsForModule, toCreateInput } from "./questions.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import {
  defaultDifficultyMix,
  defaultLevelMix,
  levelsForTemplateMode,
} from "../services/ai/assessmentAssembler.js";

const TRAINEES = [
  ["Elena", "Voss", "Claims", "Operations"],
  ["Marcus", "Chen", "Platform", "Engineering"],
  ["Priya", "Nair", "Medical Affairs", "Life Sciences"],
  ["Jonah", "Adeyemi", "Security", "Cyber"],
  ["Sofia", "Larsen", "Architecture", "Enterprise"],
  ["Noah", "Park", "Member Services", "Operations"],
  ["Amelia", "Rossi", "Data", "Analytics"],
  ["Hassan", "El-Sayed", "R&D", "Life Sciences"],
  ["Claire", "Nguyen", "QA", "Engineering"],
  ["Diego", "Morales", "DevEx", "Engineering"],
  ["Yuki", "Tanaka", "LLMOps", "Platform"],
  ["Ines", "Dubois", "Compliance", "Risk"],
  ["Owen", "Bradley", "Prior Auth", "Operations"],
  ["Leila", "Hassan", "Clinical Ops", "Care"],
  ["Theo", "Berg", "Modernization", "Engineering"],
  ["Maya", "Kapoor", "Knowledge", "Enterprise"],
  ["Felix", "Ortiz", "SRE", "Platform"],
  ["Nora", "Lindqvist", "Product", "Digital"],
  ["Adrian", "Cole", "Integration", "Engineering"],
  ["Hana", "Kim", "PV", "Life Sciences"],
  ["Luca", "Moretti", "Underwriting", "Risk"],
  ["Sara", "Johansson", "Enablement", "People"],
  ["Ben", "Okafor", "Claude Code", "Engineering"],
  ["Iris", "Patel", "Evaluation", "Platform"],
  ["Hugo", "Silva", "MCP", "Engineering"],
  ["Greta", "Hahn", "Governance", "Risk"],
  ["Kai", "Nakamura", "Agents", "Platform"],
  ["Ruth", "Okoye", "Architecture", "Enterprise"],
  ["Paul", "Ibrahim", "Cost", "Finance"],
  ["Willa", "Grant", "Capstone", "Transformation"],
];

const LEVELS: CurriculumLevel[] = ["FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

async function syncTemplateModuleScope() {
  const modules = await prisma.module.findMany();
  const templates = await prisma.assessmentTemplate.findMany({
    include: { modules: true },
  });
  for (const t of templates) {
    const scoped = modules.filter((m) => levelsForTemplateMode(t.targetLevel, t.mode).includes(m.level));
    // Only auto-expand seeded level templates that look under-scoped for progressive mastery.
    const isSeededName = /^[A-Z][a-z]+ capability assessment$/.test(t.name);
    if (!isSeededName) continue;
    const have = new Set(t.modules.map((m) => m.moduleId));
    const toAdd = scoped.filter((m) => !have.has(m.id));
    if (toAdd.length) {
      await prisma.assessmentTemplateModule.createMany({
        data: toAdd.map((m) => ({ templateId: t.id, moduleId: m.id, weight: 1 })),
        skipDuplicates: true,
      });
    }
  }
}

export async function seed() {
  // Always ensure the Saurabh admin account exists regardless of seed state
  await prisma.user.upsert({
    where: { email: "saurabh@seal.local" },
    create: {
      email: "saurabh@seal.local",
      passwordHash: await hashPassword("Saurabh@TCS2026!"),
      role: Role.SUPER_ADMIN,
      isActive: true,
    },
    update: {
      passwordHash: await hashPassword("Saurabh@TCS2026!"),
      isActive: true,
      lockedUntil: null,
    },
  });
  logger.info("Admin user saurabh ensured.");

  const already = await prisma.user.findUnique({ where: { email: env.SEED_SUPERADMIN_EMAIL } });
  if (already && process.env.SEED_FORCE !== "true") {
    await prisma.assessmentTemplate.updateMany({ data: { targetQuestionCount: 40 } });
    await syncTemplateModuleScope();
    logger.info("Seed skipped — database already initialized.");
    return;
  }

  logger.info("Seeding SEAL…");

  const bands = [
    { min: 0, max: 39, band: "DEVELOPING" },
    { min: 40, max: 54, band: "FOUNDATION_READY" },
    { min: 55, max: 69, band: "PRACTITIONER" },
    { min: 70, max: 82, band: "ADVANCED_PRACTITIONER" },
    { min: 83, max: 91, band: "CLAUDE_ENGINEER" },
    { min: 92, max: 100, band: "CLAUDE_EXPERT" },
  ];

  await prisma.systemConfiguration.upsert({
    where: { key: "proficiency_bands" },
    create: { key: "proficiency_bands", value: bands },
    update: { value: bands },
  });
  await prisma.systemConfiguration.upsert({
    where: { key: "ai_models" },
    create: {
      key: "ai_models",
      value: {
        default: env.ANTHROPIC_MODEL,
        generation: env.ANTHROPIC_GENERATION_MODEL || env.ANTHROPIC_MODEL,
        evaluation: env.ANTHROPIC_EVALUATION_MODEL || env.ANTHROPIC_MODEL,
        critic: env.ANTHROPIC_CRITIC_MODEL || env.ANTHROPIC_MODEL,
        temperature: 0.4,
        concurrency: env.AI_GENERATION_CONCURRENCY,
        monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
      },
    },
    update: {},
  });
  await prisma.systemConfiguration.upsert({
    where: { key: "integrity_defaults" },
    create: {
      key: "integrity_defaults",
      value: {
        trackTabSwitch: true,
        trackCopyPaste: true,
        trackFullscreen: true,
        trackDisconnect: true,
        autoFail: false,
      },
    },
    update: {},
  });

  const competencyIds: Record<string, string> = {};
  for (const c of COMPETENCIES) {
    const row = await prisma.competency.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, description: c.description, cluster: c.cluster },
    });
    competencyIds[c.code] = row.id;
  }

  const domainIds: Record<string, string> = {};
  let sort = 0;
  for (const spec of CURRICULUM) {
    const dkey = `${spec.level}:${spec.domainCode}`;
    const domainCode = `${spec.level}-${spec.domainCode}`;
    if (!domainIds[dkey]) {
      const existing = await prisma.domain.findFirst({
        where: { code: domainCode, level: spec.level },
      });
      const domain =
        existing ??
        (await prisma.domain.create({
          data: {
            code: domainCode,
            name: spec.domainName,
            description: spec.domainDescription,
            level: spec.level,
          },
        }));
      domainIds[dkey] = domain.id;
    }
    const module = await prisma.module.upsert({
      where: { code: spec.code },
      create: {
        code: spec.code,
        name: spec.name,
        description: spec.description,
        level: spec.level,
        domainId: domainIds[dkey],
        sortOrder: sort++,
        learningObjectives: spec.objectives,
        targetRole: spec.targetRole,
      },
      update: {
        name: spec.name,
        description: spec.description,
        learningObjectives: spec.objectives,
      },
    });

    const existingCount = await prisma.question.count({ where: { moduleId: module.id } });
    if (existingCount < 5) {
      const qs = buildQuestionsForModule(spec.code, spec.name, spec.level, spec.competencies);
      for (const q of qs) {
        const data = toCreateInput(q, module.id, competencyIds);
        const dup = await prisma.question.findFirst({ where: { fingerprint: data.fingerprint } });
        if (!dup) {
          try {
            await prisma.question.create({ data: data as unknown as Prisma.QuestionCreateInput });
          } catch (err) {
            logger.warn("skip question", { module: spec.code, err: err instanceof Error ? err.message : err });
          }
        }
      }
    }
  }

  const superHash = await hashPassword(env.SEED_SUPERADMIN_PASSWORD);
  await prisma.user.upsert({
    where: { email: env.SEED_SUPERADMIN_EMAIL },
    create: {
      email: env.SEED_SUPERADMIN_EMAIL,
      passwordHash: superHash,
      role: Role.SUPER_ADMIN,
    },
    update: {},
  });

  for (const [i, email] of ["admin.one@seal.local", "admin.two@seal.local", "admin.three@seal.local"].entries()) {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: await hashPassword("SealAdmin!2026"),
        role: i === 2 ? Role.ASSESSMENT_MANAGER : Role.ADMIN,
      },
      update: {},
    });
  }
  await prisma.user.upsert({
    where: { email: "reviewer@seal.local" },
    create: {
      email: "reviewer@seal.local",
      passwordHash: await hashPassword("SealReview!2026"),
      role: Role.REVIEWER,
    },
    update: {},
  });

  const modules = await prisma.module.findMany();

  for (const level of LEVELS) {
    const name = `${level[0]}${level.slice(1).toLowerCase()} capability assessment`;
    const mode = level === "EXPERT" || level === "ADVANCED" ? "PROGRESSIVE_MASTERY" : "LEVEL_SPECIFIC";
    const existing = await prisma.assessmentTemplate.findFirst({ where: { name } });
    const scopedModules = modules.filter((m) => levelsForTemplateMode(level, mode).includes(m.level));
    if (!existing) {
      await prisma.assessmentTemplate.create({
        data: {
          name,
          description: `90-minute ${level.toLowerCase()} Claude capability assessment. Questions come only from this template's modules.`,
          targetLevel: level,
          mode,
          durationSeconds: 5400,
          targetQuestionCount: 40,
          timeBudgetSeconds: 5400,
          levelMix: defaultLevelMix(level, mode),
          difficultyMix: defaultDifficultyMix(level),
          adaptiveEnabled: false,
          allowNavigation: true,
          integrityPolicy: { trackTabSwitch: true, trackCopyPaste: true, autoFail: false },
          passingScore: 70,
          modules: {
            create: scopedModules.map((m) => ({ moduleId: m.id, weight: 1 })),
          },
        },
      });
    } else {
      // Keep seeded templates aligned with template-scoped sittings.
      const current = await prisma.assessmentTemplateModule.findMany({ where: { templateId: existing.id } });
      const have = new Set(current.map((c) => c.moduleId));
      const toAdd = scopedModules.filter((m) => !have.has(m.id));
      if (toAdd.length) {
        await prisma.assessmentTemplateModule.createMany({
          data: toAdd.map((m) => ({ templateId: existing.id, moduleId: m.id, weight: 1 })),
          skipDuplicates: true,
        });
      }
      if (existing.mode !== mode) {
        await prisma.assessmentTemplate.update({
          where: { id: existing.id },
          data: { mode, levelMix: defaultLevelMix(level, mode), difficultyMix: defaultDifficultyMix(level) },
        });
      }
    }
  }

  const templates = await prisma.assessmentTemplate.findMany();
  const pickTemplate = (level: CurriculumLevel) =>
    templates.find((t) => t.targetLevel === level) ?? templates[0];

  for (let i = 0; i < TRAINEES.length; i++) {
    const [first, last, dept, bu] = TRAINEES[i];
    const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@seal.local";
    const level = LEVELS[i % 4];
    const passwordHash = await hashPassword("SealTrainee!2026");
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, role: Role.TRAINEE },
      update: {},
    });
    const profile = await prisma.traineeProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        employeeId: `E${String(10001 + i)}`,
        firstName: first,
        lastName: last,
        department: dept,
        businessUnit: bu,
        jobRole: "Claude practitioner",
        location: i % 2 === 0 ? "Remote" : "HQ",
        managerName: "A. Mercer",
        assignedLevel: level,
      },
      update: { assignedLevel: level },
    });
    const tpl = pickTemplate(level);
    const existingAsg = await prisma.assessmentAssignment.findFirst({
      where: { traineeId: profile.id, templateId: tpl.id },
    });
    if (!existingAsg) {
      await prisma.assessmentAssignment.create({
        data: {
          templateId: tpl.id,
          traineeId: profile.id,
          assignedLevel: level,
          startsAt: new Date(Date.now() - 86400000),
          expiresAt: new Date(Date.now() + 30 * 86400000),
          maxAttempts: 3,
          status: "ACTIVE",
        },
      });
    }
  }

  logger.info("Seed complete.");
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
