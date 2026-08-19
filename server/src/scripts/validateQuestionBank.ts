import { prisma } from "../lib/prisma.js";

async function main() {
  const modules = await prisma.module.findMany({ include: { _count: { select: { questions: true } } } });
  const issues: string[] = [];
  for (const m of modules) {
    const approved = await prisma.question.count({ where: { moduleId: m.id, status: "APPROVED" } });
    if (approved < 5) issues.push(`${m.code}: only ${approved} approved (seed minimum 5)`);
    const noKey = await prisma.question.findMany({
      where: { moduleId: m.id, questionType: { not: "SHORT_RESPONSE" } },
      include: { options: true },
    });
    for (const q of noKey) {
      const keys = (q.correctAnswer as { keys?: string[] })?.keys ?? [];
      if (q.options.length && keys.length === 0) issues.push(`${m.code} ${q.id}: missing correct keys`);
    }
  }
  if (issues.length) {
    console.error("Question bank validation failed:\n" + issues.join("\n"));
    process.exit(1);
  }
  console.log(`OK — ${modules.length} modules validated`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
