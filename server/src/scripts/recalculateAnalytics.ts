import { prisma } from "../lib/prisma.js";
import { recalculateQuestionAnalytics } from "../services/analytics/queries.js";

async function main() {
  await recalculateQuestionAnalytics();
  console.log("Analytics recalculated");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
