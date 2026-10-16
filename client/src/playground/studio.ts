import { briefFor } from "./briefs";

export type Studio = "prompt" | "agent" | "schema" | "code" | "design";

const STUDIO_BY_CODE: Record<string, Studio> = {
  F03: "prompt",
  F04: "prompt",
  F05: "prompt",
  F07: "prompt",
  F09: "prompt",
  P01: "prompt",
  A03: "prompt",
  F08: "design",
  X07: "design",
  E02: "design",
  E05: "design",
  P05: "agent",
  P06: "agent",
  A09: "agent",
  X03: "agent",
  X04: "agent",
  P09: "schema",
  X01: "schema",
  X02: "schema",
  A11: "schema",
  A04: "code",
  A06: "code",
  A07: "code",
  A08: "code",
  A12: "code",
};

export function studioFor(code: string, level: string): Studio {
  if (STUDIO_BY_CODE[code]) return STUDIO_BY_CODE[code];
  if (level === "EXPERT") return "design";
  if (level === "ADVANCED") return "code";
  if (level === "PRACTITIONER") return "agent";
  return "prompt";
}

export function starterFor(studio: Studio, _name: string) {
  if (studio === "prompt") {
    return `Role:

Limits:

Answer shape:

Safety:

Topic coverage:`;
  }
  if (studio === "agent") {
    return `Tools:

Permissions:

Human gate:

Trace / budget:

Topic coverage:`;
  }
  if (studio === "schema") {
    return `{
  "name": "",
  "description": "",
  "input_schema": {
    "type": "object",
    "properties": {
    },
    "required": []
  }
}`;
  }
  if (studio === "code") {
    return `// Write decide(call) so unapproved writes are denied and plain reads are allowed.
function decide(call) {
}
`;
  }
  return `## Architecture


## Security


## Human review


## Evaluation


## Topic coverage
`;
}

export type SectionHelp = {
  situation: string;
  task: string;
  tip: string;
  steps: string[];
};

function studioSteps(studio: Studio): string[] {
  if (studio === "prompt") {
    return [
      "In the box, write the full prompt — not notes about the prompt.",
      "Start with “You are …” and a real job description.",
      "Bound sources, and refuse when evidence is missing.",
      "Add “Return:” with at least two numbered lines.",
      "Keep safety instructions in force.",
      "Use the important words from each skill below so the checklist can see the topic.",
      "When every line is green, click Mark practiced.",
    ];
  }
  if (studio === "agent") {
    return [
      "Describe the agent for this situation, not a one-line label.",
      "Name at least two concrete tools (for example read_policy and update_case).",
      "Mark reads as allow-read and require approval on writes.",
      "Keep a human on material actions.",
      "Set a numeric token budget and say tool calls are traced.",
      "Use the important words from each skill below.",
      "When every line is green, click Mark practiced.",
    ];
  }
  if (studio === "schema") {
    return [
      "Write valid JSON for the tool this situation needs.",
      "Give a short name and a full-sentence description.",
      "Declare at least two fields under input_schema.properties.",
      "List those fields under required.",
      "Do not use * anywhere.",
      "When every line is green, click Mark practiced.",
    ];
  }
  if (studio === "code") {
    return [
      "Implement function decide(call) for this operating rule.",
      "Return \"deny\" when update_case has no approval.",
      "Return \"allow\" for read_policy.",
      "Return \"deny\" for anything else.",
      "Do not add skip-permissions, rm -rf, or child_process.",
      "When every line is green, click Mark practiced.",
    ];
  }
  return [
    "Write a full design under ## Architecture, ## Security, ## Human review, and ## Evaluation.",
    "Put real sentences under each heading — empty headings fail.",
    "Security must treat files as untrusted.",
    "Human review must require approval before material writes.",
    "Evaluation must name a rubric or golden set.",
    "Use the important words from each skill below.",
    "When every line is green, click Mark practiced.",
  ];
}

export function helpFor(studio: Studio, code: string, name: string): SectionHelp {
  const brief = briefFor(code, name);
  return {
    situation: brief.situation,
    task: brief.job,
    tip: brief.tip,
    steps: studioSteps(studio),
  };
}

export const DRILL_HELP = {
  task: "Read the incident and choose the response that stops the harm.",
  steps: [
    "Read the situation once before you choose.",
    "Pick the option that blocks the unsafe action and keeps a person in control.",
    "The sound choice marks this drill practiced. A wrong choice shows why, and you can pick again.",
  ],
};

export type Check = { id: string; label: string; ok: boolean };

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function substantiveWords(text: string) {
  return words(text).filter((w) => w.replace(/[^a-z0-9]/gi, "").length >= 3);
}

function objectiveKeywords(objective: string) {
  const stop = new Set([
    "about", "after", "against", "between", "without", "within", "using", "their", "there",
    "these", "those", "where", "which", "while", "would", "should", "could", "other",
    "through", "before", "under", "over", "into", "from", "with", "that", "this", "than",
    "then", "them", "they", "have", "been", "being", "were", "when", "what", "your",
  ]);
  return objective
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 5 && !stop.has(w))
    .slice(0, 4);
}

function coversObjective(text: string, objective: string) {
  const keys = objectiveKeywords(objective);
  if (keys.length === 0) return false;
  const lower = text.toLowerCase();
  const hits = keys.filter((w) => lower.includes(w)).length;
  return hits >= Math.min(2, keys.length);
}

function objectiveChecks(text: string, objectives: string[]): Check[] {
  return objectives.slice(0, 3).map((objective, i) => ({
    id: `obj-${i}`,
    label: `Covers: ${objective}`,
    ok: coversObjective(text, objective),
  }));
}

/** "Do not ignore safety" is a limit, not a jailbreak. */
function withoutNegatedSafety(text: string) {
  return text
    .replace(/\b(?:do not|don't|never|no)\s+ignore\s+safety(?:\s+instructions?)?\b/gi, "")
    .replace(/\bkeep every safety instruction(?:s)? in force\b/gi, "");
}

function withoutNegatedRisk(text: string) {
  return text
    .replace(/\bno\s+unrestricted\b/gi, "")
    .replace(/\b(?:do not|don't|never)\s+(?:use\s+)?unrestricted\b/gi, "")
    .replace(/\bno\s+shared credentials\b/gi, "")
    .replace(/\b(?:do not|don't|never)\s+share(?:d)?\s+credentials\b/gi, "");
}

function promptRoleOk(text: string) {
  for (const line of text.split(/\n/)) {
    const m = line.match(/\b(?:you are|act as)\s+(.+)$/i);
    if (!m) continue;
    const rest = m[1].trim();
    if (!rest || /^(role|limits?|answer|safety|topic)\b/i.test(rest)) continue;
    if (substantiveWords(rest).length >= 4) return true;
  }
  return false;
}

function promptLimitOk(text: string) {
  const sourceBound = has(text, /\b(?:use only|only (?:the )?sources?|from (?:the )?sources?|authorized sources?|provided sources?)\b/i);
  const refuseMissing = has(
    text,
    /\b(?:if (?:evidence|sources?|information) (?:is |are )?missing|when evidence is missing|refuse(?:s)? when|must refuse|say so if)\b/i,
  );
  return sourceBound && refuseMissing;
}

function promptOutputOk(text: string) {
  if (!has(text, /\breturn\s*:/i)) return false;
  const numbered = text.match(/(?:^|\n)\s*1\.\s+\S[\s\S]*?(?:^|\n)\s*2\.\s+\S/m);
  return !!numbered;
}

function promptSafetyOk(text: string) {
  const affirms = has(
    text,
    /\b(?:keep every safety instruction|safety instructions? (?:stay|remain|in force)|do not improvise policy|leave safety instructions intact)\b/i,
  );
  const jailbreak = has(withoutNegatedSafety(text), /\bignore (?:previous|all|safety)\b|\balways answer\b/i);
  return affirms && !jailbreak;
}

function agentToolsOk(text: string) {
  const named = text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi) ?? [];
  const unique = [...new Set(named.map((t) => t.toLowerCase()))];
  return unique.length >= 2 && has(text, /\btools?\b/i);
}

function agentPrivOk(text: string) {
  const readBound = has(text, /\ballow[- ]?read\b|\bread[- ]?only\b|\bleast privilege\b/i);
  const writeBound = has(text, /\b(?:requires?|needs?|with)\s+(?:human\s+)?approval\b|\bapproval (?:required|needed)\b/i);
  return readBound && writeBound;
}

function sectionBody(text: string, heading: string) {
  const re = new RegExp(`##\\s*${heading}\\b([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const m = text.match(re);
  if (!m) return "";
  return m[1].trim();
}

function sectionOk(text: string, heading: string, minWords = 12) {
  return substantiveWords(sectionBody(text, heading)).length >= minWords;
}

export function checksFor(studio: Studio, text: string, objectives: string[]): Check[] {
  const body = text.trim();
  const rich = substantiveWords(body).length >= 28 && body.length >= 160;

  if (studio === "prompt") {
    return [
      { id: "length", label: "Writes a full prompt, not a few words", ok: rich },
      { id: "role", label: "Names a real role after “You are…”", ok: promptRoleOk(body) },
      { id: "limit", label: "Bounds sources and refuses when evidence is missing", ok: promptLimitOk(body) },
      { id: "output", label: "Uses “Return:” with at least two numbered lines", ok: promptOutputOk(body) },
      { id: "safety", label: "Keeps safety instructions in force", ok: promptSafetyOk(body) },
      ...objectiveChecks(body, objectives),
    ];
  }

  if (studio === "agent") {
    return [
      { id: "length", label: "Writes a full agent brief, not a few words", ok: rich },
      { id: "tool", label: "Names at least two concrete tools", ok: agentToolsOk(body) },
      { id: "priv", label: "Bounds reads and requires approval on writes", ok: agentPrivOk(body) },
      { id: "human", label: "Keeps a human on material actions", ok: has(body, /\bhuman\b/i) && has(body, /\bapprov/i) },
      {
        id: "trace",
        label: "Sets a numeric token budget and a trace",
        ok: has(body, /\b(?:token )?budget\b[^.\n]{0,40}\d|\b\d{2,6}\s*(?:k\s*)?tokens?\b/i) && has(body, /\btrace\b/i),
      },
      {
        id: "safe",
        label: "Avoids an unrestricted or shared-login agent",
        ok: rich && !has(withoutNegatedRisk(body), /\bunrestricted\b|\bdangerously-skip-permissions\b|\bshared credentials\b/i),
      },
      ...objectiveChecks(body, objectives),
    ];
  }

  if (studio === "schema") {
    let parsed: any = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const props = parsed?.input_schema?.properties;
    const propKeys = props && typeof props === "object" ? Object.keys(props) : [];
    const required = parsed?.input_schema?.required ?? parsed?.required;
    const requiredOk =
      Array.isArray(required) &&
      required.length >= 1 &&
      required.every((key: unknown) => typeof key === "string" && propKeys.includes(key));
    const description = typeof parsed?.description === "string" ? parsed.description.trim() : "";
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
    return [
      { id: "json", label: "Valid JSON object", ok: !!parsed && typeof parsed === "object" && !Array.isArray(parsed) },
      {
        id: "name",
        label: "Has a short tool name and a full description",
        ok: /^[a-z][a-z0-9_]{2,40}$/i.test(name) && substantiveWords(description).length >= 8,
      },
      { id: "schema", label: "Declares at least two input fields", ok: propKeys.length >= 2 },
      { id: "required", label: "Marks required fields that exist on the schema", ok: requiredOk },
      { id: "tight", label: "Does not use a wildcard tool", ok: !!parsed && !JSON.stringify(parsed).includes("*") },
    ];
  }

  if (studio === "code") {
    const run = runDecide(body);
    return [
      { id: "fn", label: "Defines decide(call)", ok: has(body, /function\s+decide\s*\(\s*call\s*\)/) },
      { id: "deny", label: "Denies an unapproved write", ok: run.denyWrite },
      { id: "read", label: "Allows a plain read", ok: run.allowRead },
      { id: "default", label: "Denies unknown tools by default", ok: run.denyUnknown },
      {
        id: "safe",
        label: "No destructive or skip-permission calls",
        ok: body.length >= 80 && !has(body, /dangerously-skip-permissions|rm\s+-rf|child_process/),
      },
    ];
  }

  return [
    { id: "length", label: "Writes a full design, not empty headings", ok: substantiveWords(body).length >= 60 && body.length >= 320 },
    { id: "arch", label: "Architecture section with real content", ok: sectionOk(body, "Architecture") },
    {
      id: "sec",
      label: "Security section treats input as untrusted",
      ok: sectionOk(body, "Security") && has(sectionBody(body, "Security"), /\buntrusted\b|\binjection\b/i),
    },
    {
      id: "human",
      label: "Human review section requires approval",
      ok: sectionOk(body, "Human review") && has(sectionBody(body, "Human review"), /\bapprov|\bhuman\b/i),
    },
    {
      id: "eval",
      label: "Evaluation section names a rubric or golden set",
      ok: sectionOk(body, "Evaluation") && has(sectionBody(body, "Evaluation"), /\brubric\b|\bgolden\b/i),
    },
    ...objectiveChecks(body, objectives),
  ];
}

export function passesStudio(studio: Studio, text: string, objectives: string[]) {
  const checks = checksFor(studio, text, objectives);
  return checks.length > 0 && checks.every((c) => c.ok);
}

function runDecide(source: string) {
  try {
    const fn = new Function(
      "call",
      `${source}\nreturn typeof decide === "function" ? decide(call) : null;`,
    ) as (call: { tool: string; approval?: boolean }) => string;
    return {
      denyWrite: fn({ tool: "update_case", approval: false }) === "deny",
      allowRead: fn({ tool: "read_policy" }) === "allow",
      denyUnknown: fn({ tool: "delete_everything" }) === "deny",
    };
  } catch {
    return { denyWrite: false, allowRead: false, denyUnknown: false };
  }
}

export const DRILLS = [
  {
    id: "drill-injection",
    title: "Hidden instruction in a file",
    prompt: "A vendor PDF tells the model to skip approval and send API keys to an external site. The model starts a tool call. What is the minimum sound response?",
    options: [
      "Let it finish, then review the logs tomorrow.",
      "Treat the file as untrusted, block the tool call, and require a human before any send or secret leaves the system.",
      "Raise temperature so the model is less likely to follow the page.",
      "Add a second agent to rewrite the PDF in a friendlier tone.",
    ],
    answer: 1,
    why: "Instructions inside a document are data. The control is to stop the tool and put a person on the send.",
  },
  {
    id: "drill-theater",
    title: "A second agent for fluency",
    prompt: "Reviewers keep finding silent factual errors. Stakeholders want another agent to restate the first agent's answer more confidently.",
    options: [
      "Add the second agent so the prose sounds more certain.",
      "Ground claims in the system of record, add a check, and keep a human gate on material actions.",
      "Turn tools off and trust the model's memory.",
      "Increase temperature to explore more wording.",
    ],
    answer: 1,
    why: "Confidence is not verification. Evidence, a check, and a human gate address the error.",
  },
  {
    id: "drill-privilege",
    title: "One agent, every tool",
    prompt: "A design gives one long-running agent shared credentials and every tool, and lets it decide when it has succeeded.",
    options: [
      "Ship it. Fewer hops means lower latency.",
      "Use narrow tools, task-scoped authorization, traces, a budget, and approval on writes.",
      "Fine-tune nightly on production transcripts so tools are unnecessary.",
      "Skip authorization filters so retrieval recalls more documents.",
    ],
    answer: 1,
    why: "A production agent is a control system: small tools, identity, traces, and gated writes.",
  },
  {
    id: "drill-shadow",
    title: "Work moving to a consumer account",
    prompt: "A team pastes sensitive files into a personal Claude account because the enterprise tenant is still in procurement.",
    options: [
      "Ban every Claude product, including the future enterprise tenant.",
      "Open an approved tenant with logging and a stop-gap process, and treat the consumer account as a data-loss path.",
      "Ask people to hash names and keep using the personal account.",
      "Copy the files onto laptops and fine-tune a local model.",
    ],
    answer: 1,
    why: "People need an approved channel. A total ban pushes the same work further into the shadows.",
  },
];
