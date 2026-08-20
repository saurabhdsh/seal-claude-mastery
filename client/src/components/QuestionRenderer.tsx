import { useMemo, useState } from "react";
import { ScenarioPanel, CodeViewer, JsonViewer } from "./media";
import { Button } from "./ui";

type Snapshot = {
  questionText: string;
  scenario?: string | null;
  codeSnippet?: string | null;
  codeLanguage?: string | null;
  architectureArtifact?: unknown;
  questionType: string;
  options?: { key: string; body: string }[];
};

type Answer = {
  selectedKeys?: string[];
  matchPairs?: Record<string, string>;
  sequence?: string[];
  textResponse?: string | null;
  flagged?: boolean;
};

export function QuestionRenderer({
  snapshot,
  answer,
  onChange,
  disabled,
}: {
  snapshot: Snapshot;
  answer: Answer | null;
  onChange: (next: Answer) => void;
  disabled?: boolean;
}) {
  const options = snapshot.options ?? [];
  const selected = answer?.selectedKeys ?? [];
  const multi = snapshot.questionType === "MULTI_SELECT";

  const toggle = (key: string) => {
    if (disabled) return;
    if (multi) {
      const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
      onChange({ ...answer, selectedKeys: next });
    } else {
      onChange({ ...answer, selectedKeys: [key] });
    }
  };

  if (snapshot.questionType === "SEQUENCE") {
    return (
      <SequenceRenderer
        snapshot={snapshot}
        sequence={answer?.sequence ?? options.map((o) => o.key)}
        onChange={(sequence) => onChange({ ...answer, sequence })}
        disabled={disabled}
      />
    );
  }

  if (snapshot.questionType === "MATCH") {
    return (
      <MatchRenderer
        snapshot={snapshot}
        pairs={answer?.matchPairs ?? {}}
        onChange={(matchPairs) => onChange({ ...answer, matchPairs })}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="space-y-6">
      <QuestionLead snapshot={snapshot} />
      {snapshot.questionType === "SHORT_RESPONSE" ? (
        <textarea
          disabled={disabled}
          className="min-h-[220px] w-full rounded-2xl border border-[var(--line)] bg-[var(--bg-elev)] p-4 text-sm leading-7"
          value={answer?.textResponse ?? ""}
          onChange={(e) => onChange({ ...answer, textResponse: e.target.value })}
          placeholder="Write a structured technical response. Treat this as an architecture review."
        />
      ) : (
        <ul className="space-y-2">
          {options.map((o) => {
            const on = selected.includes(o.key);
            return (
              <li key={o.key}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(o.key)}
                  className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    on ? "border-coral bg-[var(--accent-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-muted)]"
                  }`}
                >
                  <span className="mt-0.5 font-mono text-xs text-coral">{o.key}</span>
                  <span className="text-sm leading-6">{o.body}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SequenceRenderer({
  snapshot,
  sequence,
  onChange,
  disabled,
}: {
  snapshot: Snapshot;
  sequence: string[];
  onChange: (s: string[]) => void;
  disabled?: boolean;
}) {
  const labels = Object.fromEntries((snapshot.options ?? []).map((o) => [o.key, o.body]));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sequence.length) return;
    const next = [...sequence];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-6">
      <QuestionLead snapshot={snapshot} />
      <ol className="space-y-2">
        {sequence.map((key, i) => (
          <li key={key} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2">
            <span className="font-mono text-xs text-[var(--ink-muted)]">{i + 1}</span>
            <span className="flex-1 text-sm">{labels[key] ?? key}</span>
            <Button variant="ghost" disabled={disabled} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MatchRenderer({
  snapshot,
  pairs,
  onChange,
  disabled,
}: {
  snapshot: Snapshot;
  pairs: Record<string, string>;
  onChange: (p: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const left = (snapshot.options ?? []).filter((_, i) => i % 2 === 0);
  const right = (snapshot.options ?? []).filter((_, i) => i % 2 === 1);
  return (
    <div className="space-y-6">
      <QuestionLead snapshot={snapshot} />
      <div className="grid gap-3 md:grid-cols-2">
        {left.map((l, idx) => (
          <div key={l.key} className="rounded-xl border border-[var(--line)] p-3">
            <div className="text-sm">{l.body}</div>
            <select
              disabled={disabled}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2 py-1 text-sm"
              value={pairs[l.key] ?? ""}
              onChange={(e) => onChange({ ...pairs, [l.key]: e.target.value })}
            >
              <option value="">Associate…</option>
              {right.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.body}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionLead({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="space-y-4">
      {snapshot.scenario ? (
        <ScenarioPanel text={snapshot.scenario} />
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg-muted)] px-5 py-4 text-[13px] text-[var(--ink-muted)]">
          No scenario for this item. Read the question carefully before answering.
        </div>
      )}
      {snapshot.codeSnippet && <CodeViewer code={snapshot.codeSnippet} language={snapshot.codeLanguage ?? undefined} />}
      {snapshot.architectureArtifact != null && <JsonViewer value={snapshot.architectureArtifact} />}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#0071e3] px-2 text-[11px] font-semibold text-white">
            2
          </span>
          <span className="text-[13px] font-semibold text-[#1d1d1f]">Then answer this question</span>
        </div>
        <h2 className="text-[1.45rem] font-semibold leading-snug tracking-tightish text-[#1d1d1f]">{snapshot.questionText}</h2>
      </div>
    </div>
  );
}

export function hasAttempted(answer: Answer | null | undefined) {
  if (!answer) return false;
  if ((answer.selectedKeys?.length ?? 0) > 0) return true;
  if (answer.textResponse?.trim()) return true;
  if ((answer.sequence?.length ?? 0) > 0) return true;
  if (answer.matchPairs && Object.keys(answer.matchPairs).length > 0) return true;
  return false;
}

export function QuestionNavigator({
  count,
  current,
  flagged,
  answered,
  onJump,
}: {
  count: number;
  current: number;
  flagged: Set<number>;
  answered: Set<number>;
  onJump: (i: number) => void;
}) {
  const items = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  return (
    <nav aria-label="Question navigator" className="grid grid-cols-5 gap-1.5">
      {items.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onJump(i)}
          className={`h-8 rounded-lg text-[11px] font-medium tabular ${
            answered.has(i)
              ? i === current
                ? "bg-coral text-white ring-2 ring-ink-900"
                : "bg-coral-soft text-ink-900"
              : i === current
                ? "border-2 border-coral bg-transparent text-coral"
                : "border border-[var(--line)] text-[var(--ink-muted)]"
          } ${flagged.has(i) ? "outline outline-1 outline-offset-1 outline-coral" : ""}`}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  );
}
