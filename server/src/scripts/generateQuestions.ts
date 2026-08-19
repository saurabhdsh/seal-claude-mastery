import { prisma } from "../lib/prisma.js";
import { generateQuestionSet } from "../services/ai/questionGenerator.js";
import { critiqueQuestion } from "../services/ai/difficultyCalibrator.js";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const moduleCode = arg("module");
  const count = Number(arg("count", "25"));
  if (!moduleCode) {
    console.error("Usage: npm run generate:questions -- --module A01 --count 25");
    process.exit(1);
  }
  const module = await prisma.module.findUnique({ where: { code: moduleCode } });
  if (!module) throw new Error(`Module ${moduleCode} not found`);
  console.log(`Generating ${count} questions for ${module.code} ${module.name}`);
  const result = await generateQuestionSet({ moduleId: module.id, count });
  for (const id of result.questionIds) {
    try {
      await critiqueQuestion(id, result.generationId);
    } catch (e) {
      console.warn("critic failed", id, e);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
