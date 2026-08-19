import { extractJson, getAIProvider } from "./factory.js";
import { aiModels } from "../../config/env.js";
import { z } from "zod";

const narrativeSchema = z.object({
  executiveSummary: z.string().min(40),
  evidence: z.array(z.string()).min(1),
  strengths: z.array(z.string()).min(1),
  gaps: z.array(z.string()).min(1),
  developmentPlan: z.array(z.string()).min(1),
});

export async function generateFeedback(params: {
  actorId?: string;
  attemptId: string;
  profile: Record<string, unknown>;
}) {
  const system = `You write concise executive assessment narratives for SEAL.
Use only the provided scores and evidence. No personality judgments.
Do not claim skills that are not evidenced. Return JSON only.`;

  const completion = await getAIProvider().complete({
    system,
    user: JSON.stringify(params.profile),
    model: aiModels.evaluation,
    temperature: 0.3,
    purpose: "NARRATIVE",
    actorId: params.actorId,
    resourceType: "AssessmentAttempt",
    resourceId: params.attemptId,
  });

  return narrativeSchema.parse(extractJson(completion.text));
}

export function fallbackNarrative(profile: {
  overallScore: number;
  band: string;
  strongest: string[];
  weakest: string[];
}) {
  const strengths = profile.strongest.length
    ? profile.strongest.join(", ")
    : "limited evidenced strengths at this sitting";
  const gaps = profile.weakest.length ? profile.weakest.join(", ") : "insufficient item coverage to isolate gaps";
  return {
    executiveSummary: `Overall score ${profile.overallScore.toFixed(1)} places the candidate in the ${profile.band.replaceAll("_", " ").toLowerCase()} band. Strongest evidenced areas: ${strengths}. Development focus: ${gaps}.`,
    evidence: [`Difficulty-weighted score of ${profile.overallScore.toFixed(1)} generated from this attempt only.`],
    strengths: profile.strongest.length ? profile.strongest : ["Insufficient items to claim strengths"],
    gaps: profile.weakest.length ? profile.weakest : ["Insufficient items to claim gaps"],
    developmentPlan: profile.weakest.map((g) => `Targeted practice and scenario drills in ${g}.`),
  };
}
