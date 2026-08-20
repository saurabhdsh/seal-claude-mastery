import { clsx } from "clsx";

export function CodeViewer({ code, language }: { code: string; language?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[#12110f]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-400">
        <span>{language || "artifact"}</span>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-ink-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function JsonViewer({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <CodeViewer code={text} language="json" />;
}

export function ScenarioPanel({ text }: { text: string; collapsedDefault?: boolean }) {
  return (
    <section className="rounded-2xl border border-[#d2d2d7] bg-[#f5f5f7] p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#1d1d1f] px-2 text-[11px] font-semibold text-white">
          1
        </span>
        <div>
          <div className="text-[13px] font-semibold text-[#1d1d1f]">Read the scenario first</div>
          <div className="text-[11px] text-[#86868b]">Use this context before you answer the question below.</div>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#1d1d1f]">{text}</p>
    </section>
  );
}

export function AutosaveIndicator({ status }: { status: "saved" | "saving" | "offline" | "idle" }) {
  const map = {
    saved: "Saved",
    saving: "Saving…",
    offline: "Offline — retrying",
    idle: "",
  };
  return (
    <span className={clsx("text-xs", status === "offline" ? "text-coral" : "text-[var(--ink-muted)]")}>
      {map[status]}
    </span>
  );
}

export function ProgressRail({ current, total }: { current: number; total: number }) {
  const pct = total ? (current / total) * 100 : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--line)]" aria-hidden>
      <div className="h-full bg-coral transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Timer({ remainingSeconds }: { remainingSeconds: number | null }) {
  if (remainingSeconds == null) return null;
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  const urgent = remainingSeconds < 300;
  return (
    <div
      className={clsx("tabular font-serif text-3xl tracking-tightish", urgent ? "text-coral" : "text-[var(--ink)]")}
      aria-live="polite"
    >
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

export function ScoreGauge({ score }: { score: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <svg viewBox="0 0 140 140" className="h-40 w-40">
      <circle cx="70" cy="70" r={r} fill="none" stroke="currentColor" className="text-[var(--line)]" strokeWidth="8" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="#d97757"
        strokeWidth="8"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="76" textAnchor="middle" className="fill-current font-serif text-3xl">
        {score.toFixed(0)}
      </text>
    </svg>
  );
}

export function AIQualityIndicator({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-xs text-[var(--ink-muted)]">No critic</span>;
  return (
    <span className="text-xs tabular text-[var(--ink-muted)]">
      AI quality {score}
    </span>
  );
}
