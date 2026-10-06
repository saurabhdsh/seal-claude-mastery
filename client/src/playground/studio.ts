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

export function starterFor(studio: Studio, name: string) {
  if (studio === "prompt") {
    return `Role:

Limits:

Answer shape:`;
  }
  if (studio === "agent") {
    return `${name}

Actions this agent may take:

Who must approve a write:

What gets recorded:`;
  }
  if (studio === "schema") {
    return `{
  "name": "${name}"
}`;
  }
  if (studio === "code") {
    return `// ${name}
// write decide(call) here
`;
  }
  return `${name}

Structure:

Risk:

Who approves a change:

How you will grade the result:`;
}

export type SectionHelp = {
  task: string;
  steps: string[];
};

export function helpFor(studio: Studio, name: string): SectionHelp {
  if (studio === "prompt") {
    return {
      task: `Write the prompt you would give Claude for ${name}.`,
      steps: [
        "Start with a role, such as “You are…”.",
        "Set a limit: what it may use, and what it must refuse when evidence is missing.",
        "Say what the answer must look like, such as “Return:” followed by a numbered list.",
        "Keep safety instructions in force. “Do not ignore safety instructions” is fine. Telling the model to ignore previous instructions, or to always answer, is not.",
        "When every checklist line is filled, click Mark practiced.",
      ],
    };
  }
  if (studio === "agent") {
    return {
      task: `Describe the agent you would run for ${name}.`,
      steps: [
        "Name at least one tool.",
        "Bound permission: a read can be allow-read, and a write needs approval.",
        "Keep a human on anything that changes a real system.",
        "Record a trace or a token budget.",
        "“No unrestricted credentials” is fine. Do not give the agent skip-permissions or a shared login.",
        "When every checklist line is filled, click Mark practiced.",
      ],
    };
  }
  if (studio === "schema") {
    return {
      task: `Write the tool contract Claude would call for ${name}.`,
      steps: [
        "Keep the text as valid JSON.",
        "Give the tool a name and a description.",
        "Declare input_schema.properties for each field.",
        "List the fields that must be present under required.",
        "Do not put a * anywhere in the JSON.",
        "When every checklist line is filled, click Mark practiced.",
      ],
    };
  }
  if (studio === "code") {
    return {
      task: `Write the permission check for ${name}.`,
      steps: [
        "Keep a function named decide(call).",
        "Return \"deny\" when the tool is update_case and approval is missing.",
        "Return \"allow\" when the tool is read_policy.",
        "Do not add skip-permissions, rm -rf, or child_process.",
        "When every checklist line is filled, click Mark practiced.",
      ],
    };
  }
  return {
    task: `Write the design for ${name}. This is the capstone-style station.`,
    steps: [
      "Keep a heading for Architecture, Security, Human review, and Evaluation.",
      "In Security, treat uploaded files as untrusted.",
      "In Human review, a person approves anything that changes a real system.",
      "In Evaluation, name a rubric or a golden set.",
      "The checklist also lists this module’s objectives. Use the longer words from each of those lines in your writeup.",
      "When every checklist line is filled, click Mark practiced.",
    ],
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

/** "Do not ignore safety" is a limit, not a jailbreak. Strip those phrases before the check. */
function withoutNegatedSafety(text: string) {
  return text.replace(/\b(?:do not|don't|never|no)\s+ignore\s+safety\b/gi, "");
}

function withoutNegatedRisk(text: string) {
  return text
    .replace(/\bno\s+unrestricted\b/gi, "")
    .replace(/\b(?:do not|don't|never)\s+(?:use\s+)?unrestricted\b/gi, "")
    .replace(/\bno\s+shared credentials\b/gi, "")
    .replace(/\b(?:do not|don't|never)\s+share(?:d)?\s+credentials\b/gi, "");
}

export function checksFor(studio: Studio, text: string, objectives: string[]): Check[] {
  if (studio === "prompt") {
    return [
      { id: "role", label: "Names a role", ok: has(text, /you are|act as/i) },
      { id: "limit", label: "Sets a limit or a refusal", ok: has(text, /do not|never|only|if .* missing|refuse/i) },
      { id: "output", label: "States the output shape", ok: has(text, /return|format|json|1\.|sections/i) },
      { id: "safety", label: "Leaves safety instructions intact", ok: text.trim().length > 40 && !has(withoutNegatedSafety(text), /ignore (previous|all|safety)|always answer/i) },
    ];
  }
  if (studio === "agent") {
    return [
      { id: "tool", label: "Names at least one tool", ok: has(text, /tool/i) },
      { id: "priv", label: "Bounds permission", ok: has(text, /permission|least privilege|allow-read|approval/i) },
      { id: "human", label: "Keeps a human on material actions", ok: has(text, /human|approval|hitl/i) },
      { id: "trace", label: "Records a trace or a budget", ok: has(text, /trace|log|budget|token/i) },
      { id: "safe", label: "Avoids an unrestricted agent", ok: text.trim().length > 40 && !has(withoutNegatedRisk(text), /unrestricted|dangerously-skip-permissions|shared credentials/i) },
    ];
  }
  if (studio === "schema") {
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const required = parsed?.input_schema?.required ?? parsed?.required;
    return [
      { id: "json", label: "Valid JSON", ok: !!parsed && typeof parsed === "object" },
      { id: "name", label: "Has a tool name and description", ok: typeof parsed?.name === "string" && typeof parsed?.description === "string" },
      { id: "schema", label: "Declares an input schema", ok: !!parsed?.input_schema?.properties },
      { id: "required", label: "Marks required fields", ok: Array.isArray(required) && required.length > 0 },
      { id: "tight", label: "Does not use a wildcard tool", ok: !!parsed && !JSON.stringify(parsed).includes("*") },
    ];
  }
  if (studio === "code") {
    const run = runDecide(text);
    return [
      { id: "fn", label: "Defines decide(call)", ok: has(text, /function\s+decide\s*\(/) },
      { id: "deny", label: "Denies an unapproved write", ok: run.denyWrite },
      { id: "read", label: "Allows a plain read", ok: run.allowRead },
      { id: "safe", label: "No destructive or skip-permission calls", ok: !has(text, /dangerously-skip-permissions|rm\s+-rf|child_process/) },
    ];
  }
  const objectiveChecks = objectives.slice(0, 3).map((objective, i) => {
    const words = objective.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 5).slice(0, 3);
    return {
      id: `obj-${i}`,
      label: objective,
      ok: words.length > 0 && words.every((w) => text.toLowerCase().includes(w)),
    };
  });
  return [
    { id: "arch", label: "Architecture", ok: has(text, /architecture/i) },
    { id: "sec", label: "Security or untrusted input", ok: has(text, /security|untrusted|injection/i) },
    { id: "human", label: "Human review", ok: has(text, /human review|human gate|approval/i) },
    { id: "eval", label: "Evaluation", ok: has(text, /eval|rubric|golden/i) },
    ...objectiveChecks,
  ];
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
    };
  } catch {
    return { denyWrite: false, allowRead: false };
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
