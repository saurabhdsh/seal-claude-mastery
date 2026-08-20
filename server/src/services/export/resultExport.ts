import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";

type FullResult = NonNullable<Awaited<ReturnType<typeof loadResult>>>;

export async function loadResult(attemptId: string) {
  const result = await prisma.assessmentResult.findUnique({
    where: { attemptId },
    include: {
      modules: { include: { module: true }, orderBy: { score: "desc" } },
      competencies: { include: { competency: true }, orderBy: { mastery: "desc" } },
      attempt: {
        include: {
          trainee: true,
          assignment: { include: { template: { select: { name: true, passingScore: true, targetLevel: true } } } },
          integrityEvents: { orderBy: { serverTs: "asc" } },
          answers: true,
          questions: {
            orderBy: { position: "asc" },
            include: { question: { include: { options: true, module: true } } },
          },
          evaluations: true,
        },
      },
    },
  });
  if (!result) throw notFound("Result not found");
  return result;
}

function traineeName(r: FullResult) {
  return `${r.attempt.trainee.firstName} ${r.attempt.trainee.lastName}`.trim();
}

function fileStem(r: FullResult) {
  const name = traineeName(r).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase() || "candidate";
  const date = new Date(r.createdAt).toISOString().slice(0, 10);
  return `SEAL_Result_${name}_${date}`;
}

function passFail(r: FullResult) {
  const passing = r.attempt.assignment?.template?.passingScore ?? 70;
  const passed = r.overallScore >= passing;
  return { passing, passed, label: passed ? "PASS" : "FAIL" };
}

function narrative(r: FullResult) {
  const n = (r.narrative ?? {}) as {
    executiveSummary?: string;
    strengths?: string[];
    gaps?: string[];
  };
  return {
    executiveSummary: n.executiveSummary ?? "",
    strengths: n.strengths ?? [],
    gaps: n.gaps ?? [],
  };
}

function answerLookup(r: FullResult) {
  return new Map(r.attempt.answers.map((a) => [a.questionId, a]));
}

function evaluationLookup(r: FullResult) {
  return new Map(r.attempt.evaluations.map((e) => [e.questionId, e]));
}

function snapshotText(snapshot: unknown) {
  const s = (snapshot ?? {}) as { questionText?: string; scenario?: string; questionType?: string; moduleCode?: string };
  return {
    questionText: s.questionText ?? "",
    scenario: s.scenario ?? "",
    questionType: s.questionType ?? "",
    moduleCode: s.moduleCode ?? "",
  };
}

function answerSummary(answer: FullResult["attempt"]["answers"][number] | undefined) {
  if (!answer) return "—";
  if (answer.textResponse?.trim()) return answer.textResponse.trim().slice(0, 500);
  if (answer.selectedKeys?.length) return answer.selectedKeys.join(", ");
  if (answer.sequence) return JSON.stringify(answer.sequence);
  if (answer.matchPairs) return JSON.stringify(answer.matchPairs);
  return "—";
}

export async function buildResultExcel(attemptId: string) {
  const r = await loadResult(attemptId);
  const { passing, label } = passFail(r);
  const n = narrative(r);
  const answers = answerLookup(r);
  const evaluations = evaluationLookup(r);
  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAL Claude Mastery";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary", { properties: { defaultColWidth: 28 } });
  summary.columns = [{ width: 28 }, { width: 60 }];
  const summaryRows: [string, string | number][] = [
    ["SEAL Claude Mastery — Assessment Result", ""],
    ["Candidate", traineeName(r)],
    ["Username / Employee ID", r.attempt.trainee.employeeId],
    ["Assessment", r.attempt.assignment?.template?.name ?? "—"],
    ["Target level", r.attempt.assignment?.template?.targetLevel ?? "—"],
    ["Recorded at", new Date(r.createdAt).toLocaleString()],
    ["Outcome", label],
    ["Overall score", Number(r.overallScore.toFixed(2))],
    ["Passing threshold", `${passing}%`],
    ["Proficiency band", r.proficiencyBand.replaceAll("_", " ")],
    ["Confidence", `${Math.round(r.confidence * 100)}%`],
    ["Difficulty-weighted score", Number(r.difficultyWeightedScore.toFixed(2))],
    ["Percentile", r.percentile == null ? "—" : Number(r.percentile.toFixed(1))],
    ["Scoring version", r.scoringVersion],
    ["Executive summary", n.executiveSummary || "—"],
  ];
  summaryRows.forEach(([k, v], i) => {
    const row = summary.addRow([k, v]);
    if (i === 0) {
      row.font = { bold: true, size: 14 };
      summary.mergeCells(1, 1, 1, 2);
    } else {
      row.getCell(1).font = { bold: true };
    }
  });
  summary.getCell("B8").font = { bold: true, color: { argb: label === "PASS" ? "FF059669" : "FFDC2626" } };

  const scores = wb.addWorksheet("Domain Scores");
  scores.columns = [{ header: "Domain", width: 24 }, { header: "Score", width: 14 }];
  [
    ["Scenario", r.scenarioScore],
    ["Architecture", r.architectureScore],
    ["Hands-on", r.handsOnScore],
    ["Security", r.securityScore],
    ["Context", r.contextScore],
    ["Agentic", r.agenticScore],
    ["Claude Code", r.claudeCodeScore],
  ].forEach(([domain, score]) => scores.addRow([domain, Number((score as number).toFixed(2))]));
  styleHeader(scores);

  const modules = wb.addWorksheet("Modules");
  modules.columns = [
    { header: "Code", width: 12 },
    { header: "Module", width: 36 },
    { header: "Score", width: 12 },
    { header: "Items", width: 10 },
    { header: "Correct (weighted)", width: 18 },
  ];
  for (const m of r.modules) {
    modules.addRow([m.module.code, m.module.name, Number(m.score.toFixed(2)), m.items, Number(m.correct.toFixed(2))]);
  }
  styleHeader(modules);

  const comps = wb.addWorksheet("Competencies");
  comps.columns = [
    { header: "Code", width: 12 },
    { header: "Competency", width: 28 },
    { header: "Mastery", width: 12 },
    { header: "Confidence", width: 12 },
    { header: "Questions seen", width: 16 },
    { header: "Difficulty reached", width: 18 },
  ];
  for (const c of r.competencies) {
    comps.addRow([
      c.competency.code,
      c.competency.name,
      Number(c.mastery.toFixed(2)),
      Number((c.confidence * 100).toFixed(1)),
      c.questionsSeen,
      c.difficultyReached?.replaceAll("_", " ") ?? "—",
    ]);
  }
  styleHeader(comps);

  const narrativeSheet = wb.addWorksheet("Narrative");
  narrativeSheet.columns = [{ header: "Type", width: 16 }, { header: "Detail", width: 80 }];
  if (n.executiveSummary) narrativeSheet.addRow(["Executive summary", n.executiveSummary]);
  for (const s of n.strengths) narrativeSheet.addRow(["Strength", s]);
  for (const g of n.gaps) narrativeSheet.addRow(["Development", g]);
  styleHeader(narrativeSheet);

  const items = wb.addWorksheet("Question Detail");
  items.columns = [
    { header: "#", width: 6 },
    { header: "Module", width: 10 },
    { header: "Type", width: 22 },
    { header: "Difficulty", width: 14 },
    { header: "Question", width: 50 },
    { header: "Scenario", width: 40 },
    { header: "Response", width: 30 },
    { header: "Correct?", width: 10 },
    { header: "Points", width: 10 },
    { header: "Max", width: 8 },
    { header: "Time (s)", width: 10 },
    { header: "Flagged", width: 10 },
    { header: "AI eval", width: 10 },
  ];
  for (const q of r.attempt.questions) {
    const snap = snapshotText(q.snapshot);
    const ans = answers.get(q.questionId);
    const ev = evaluations.get(q.questionId);
    items.addRow([
      q.position + 1,
      snap.moduleCode || q.question.module?.code || "—",
      snap.questionType || q.question.questionType,
      q.assignedDifficulty.replaceAll("_", " "),
      snap.questionText || q.question.questionText,
      snap.scenario || q.question.scenario || "",
      answerSummary(ans),
      ans?.isCorrect == null ? "—" : ans.isCorrect ? "Yes" : "No",
      ans?.pointsAwarded == null ? "—" : Number(ans.pointsAwarded.toFixed(2)),
      ans?.maxPoints == null ? "—" : Number(ans.maxPoints.toFixed(2)),
      ans ? Math.round(ans.timeSpentMs / 1000) : "—",
      ans?.flagged ? "Yes" : "No",
      ev?.overall == null ? "—" : Number(ev.overall.toFixed(2)),
    ]);
  }
  styleHeader(items);

  const integrity = wb.addWorksheet("Integrity");
  integrity.columns = [
    { header: "Time", width: 24 },
    { header: "Event", width: 24 },
    { header: "Detail", width: 50 },
  ];
  for (const e of r.attempt.integrityEvents) {
    integrity.addRow([new Date(e.serverTs).toLocaleString(), e.type, JSON.stringify(e.payload ?? {})]);
  }
  if (!r.attempt.integrityEvents.length) integrity.addRow(["—", "None", "No integrity signals recorded"]);
  styleHeader(integrity);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${fileStem(r)}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F7" } };
}

export async function buildResultPdf(attemptId: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const r = await loadResult(attemptId);
  const { passing, label } = passFail(r);
  const n = narrative(r);
  const answers = answerLookup(r);

  const doc = new PDFDocument({ margin: 48, size: "A4", info: { Title: `SEAL Result — ${traineeName(r)}`, Author: "SEAL Claude Mastery" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header
  doc.fontSize(10).fillColor("#86868b").text("SEAL · Claude Mastery", { continued: false });
  doc.moveDown(0.3);
  doc.fontSize(20).fillColor("#1d1d1f").text("Assessment Result Report", { continued: false });
  doc.moveDown(0.6);

  doc.fontSize(12).fillColor("#1d1d1f").text(traineeName(r), { continued: false });
  doc.fontSize(10).fillColor("#636366").text(r.attempt.assignment?.template?.name ?? "Assessment", { continued: false });
  doc.text(`Recorded ${new Date(r.createdAt).toLocaleString()}`, { continued: false });
  doc.moveDown(0.8);

  // Pass / Fail box
  const boxY = doc.y;
  doc.roundedRect(48, boxY, 500, 56, 8).fill(label === "PASS" ? "#ECFDF5" : "#FEF2F2");
  doc.fillColor(label === "PASS" ? "#059669" : "#DC2626").fontSize(18).text(label, 64, boxY + 12);
  doc.fillColor("#1d1d1f").fontSize(11).text(`Score ${r.overallScore.toFixed(1)} / 100  ·  Threshold ${passing}%  ·  ${r.proficiencyBand.replaceAll("_", " ")}`, 64, boxY + 34);
  doc.y = boxY + 72;

  section(doc, "Executive summary");
  doc.fontSize(10).fillColor("#1d1d1f").text(n.executiveSummary || "No narrative summary recorded.", { align: "left" });
  doc.moveDown(0.8);

  section(doc, "Score profile");
  const scoreLines = [
    ["Confidence", `${Math.round(r.confidence * 100)}%`],
    ["Scenario", r.scenarioScore.toFixed(1)],
    ["Architecture", r.architectureScore.toFixed(1)],
    ["Hands-on", r.handsOnScore.toFixed(1)],
    ["Security", r.securityScore.toFixed(1)],
    ["Context", r.contextScore.toFixed(1)],
    ["Agentic", r.agenticScore.toFixed(1)],
    ["Claude Code", r.claudeCodeScore.toFixed(1)],
  ];
  for (const [k, v] of scoreLines) {
    doc.fontSize(10).fillColor("#636366").text(`${k}`, { continued: true });
    doc.fillColor("#1d1d1f").text(`  ${v}`);
  }
  doc.moveDown(0.6);

  section(doc, "Module performance");
  for (const m of r.modules) {
    doc.fontSize(10).fillColor("#1d1d1f").text(`${m.module.code}  ${m.module.name}`, { continued: true });
    doc.fillColor("#636366").text(`  ${m.score.toFixed(1)}  (${m.items} items)`);
  }
  if (!r.modules.length) doc.fontSize(10).fillColor("#86868b").text("No module scores.");
  doc.moveDown(0.6);

  section(doc, "Competency constellation");
  for (const c of r.competencies) {
    doc.fontSize(10).fillColor("#1d1d1f").text(`${c.competency.code}  ${c.competency.name}`, { continued: true });
    doc.fillColor("#636366").text(`  mastery ${c.mastery.toFixed(0)}  ·  ${c.questionsSeen}q`);
  }
  if (!r.competencies.length) doc.fontSize(10).fillColor("#86868b").text("No competency scores.");
  doc.moveDown(0.6);

  if (n.strengths.length) {
    section(doc, "Strengths");
    for (const s of n.strengths) doc.fontSize(10).fillColor("#1d1d1f").text(`• ${s}`);
    doc.moveDown(0.4);
  }
  if (n.gaps.length) {
    section(doc, "Development areas");
    for (const g of n.gaps) doc.fontSize(10).fillColor("#1d1d1f").text(`• ${g}`);
    doc.moveDown(0.4);
  }

  ensureSpace(doc, 120);
  section(doc, "Question-level detail");
  for (const q of r.attempt.questions) {
    ensureSpace(doc, 70);
    const snap = snapshotText(q.snapshot);
    const ans = answers.get(q.questionId);
    const correct =
      ans?.isCorrect == null ? "—" : ans.isCorrect ? "Correct" : "Incorrect";
    const pts =
      ans?.pointsAwarded != null && ans?.maxPoints != null
        ? `${ans.pointsAwarded.toFixed(1)}/${ans.maxPoints.toFixed(1)}`
        : "—";
    doc.fontSize(10).fillColor("#1d1d1f").text(`Q${q.position + 1}. ${snap.questionText || q.question.questionText}`, {
      width: 500,
    });
    doc.fontSize(9).fillColor("#86868b").text(
      `${snap.moduleCode || q.question.module?.code || "—"} · ${q.assignedDifficulty.replaceAll("_", " ")} · ${correct} · ${pts}`,
    );
    if (snap.scenario) {
      doc.fontSize(9).fillColor("#636366").text(`Scenario: ${snap.scenario.slice(0, 280)}${snap.scenario.length > 280 ? "…" : ""}`);
    }
    doc.moveDown(0.35);
  }

  ensureSpace(doc, 80);
  section(doc, "Integrity timeline");
  if (!r.attempt.integrityEvents.length) {
    doc.fontSize(10).fillColor("#86868b").text("No integrity signals recorded.");
  } else {
    for (const e of r.attempt.integrityEvents) {
      doc.fontSize(9).fillColor("#1d1d1f").text(`${new Date(e.serverTs).toLocaleString()}  —  ${e.type}`);
    }
  }

  doc.moveDown(1.2);
  doc.fontSize(8).fillColor("#aeaeb2").text("Generated by SEAL Claude Mastery · confidential", { align: "center" });
  doc.end();

  const buffer = await done;
  return { buffer, filename: `${fileStem(r)}.pdf`, contentType: "application/pdf" };
}

function section(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor("#1d1d1f").text(title);
  doc.moveDown(0.25);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#E5E5EA").stroke();
  doc.moveDown(0.4);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

export async function buildResultsListExcel() {
  const rows = await prisma.assessmentResult.findMany({
    include: {
      modules: { include: { module: true } },
      competencies: { include: { competency: true } },
      attempt: {
        include: {
          trainee: true,
          assignment: { include: { template: { select: { name: true, passingScore: true, targetLevel: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "SEAL Claude Mastery";
  const sheet = wb.addWorksheet("All Results");
  sheet.columns = [
    { header: "Candidate", width: 24 },
    { header: "Username", width: 16 },
    { header: "Assessment", width: 32 },
    { header: "Level", width: 14 },
    { header: "Date", width: 14 },
    { header: "Outcome", width: 10 },
    { header: "Score", width: 10 },
    { header: "Threshold", width: 12 },
    { header: "Band", width: 22 },
    { header: "Confidence %", width: 12 },
    { header: "Claude Code", width: 12 },
    { header: "Security", width: 12 },
    { header: "Architecture", width: 12 },
  ];
  for (const r of rows) {
    const passing = r.attempt.assignment?.template?.passingScore ?? 70;
    const passed = r.overallScore >= passing;
    sheet.addRow([
      `${r.attempt.trainee.firstName} ${r.attempt.trainee.lastName}`,
      r.attempt.trainee.employeeId,
      r.attempt.assignment?.template?.name ?? "—",
      r.attempt.assignment?.template?.targetLevel ?? "—",
      new Date(r.createdAt).toLocaleDateString(),
      passed ? "PASS" : "FAIL",
      Number(r.overallScore.toFixed(2)),
      passing,
      r.proficiencyBand.replaceAll("_", " "),
      Math.round(r.confidence * 100),
      Number(r.claudeCodeScore.toFixed(1)),
      Number(r.securityScore.toFixed(1)),
      Number(r.architectureScore.toFixed(1)),
    ]);
  }
  styleHeader(sheet);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const date = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `SEAL_All_Results_${date}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
