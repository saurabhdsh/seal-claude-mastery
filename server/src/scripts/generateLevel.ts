import { prisma } from "../lib/prisma.js";
import { CurriculumLevel } from "@prisma/client";
import { generateQuestionSet } from "../services/ai/questionGenerator.js";
import { critiqueQuestion } from "../services/ai/difficultyCalibrator.js";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const level = arg("level") as CurriculumLevel | undefined;
  const count = Number(arg("count", "25"));
  if (!level) {
    console.error("Usage: npm run generate:level -- --level ADVANCED");
    process.exit(1);
  }
  const modules = await prisma.module.findMany({ where: { level } });
  for (const module of modules) {
    const approved = await prisma.question.count({
      where: { moduleId: module.id, status: "APPROVED" },
    });
    const need = Math.max(0, count - approved);
    if (need === 0) {
      console.log(`${module.code} already has ${approved} approved items`);
      continue;
    }
    console.log(`${module.code}: generating ${need}`);
    const result = await generateQuestionSet({ moduleId: module.id, count: need });
    for (const id of result.questionIds) {
      try {
        await critiqueQuestion(id, result.generationId);
      } catch {
        /* continue */
      }
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
