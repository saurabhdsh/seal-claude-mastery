import { clsx } from "clsx";
import type { ReactNode } from "react";

export function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    FOUNDATION: "bg-[#f2f2f7] text-[#636366]",
    PRACTITIONER: "bg-[#e3f0fd] text-[#0058ae]",
    ADVANCED: "bg-[#1d1d1f] text-white",
    EXPERT: "bg-[#0071e3] text-white",
  };
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", map[level] ?? "bg-[#f2f2f7] text-[#636366]")}>
      {level.replaceAll("_", " ")}
    </span>
  );
}

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span className="inline-flex rounded-md border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
      {difficulty.replaceAll("_", " ")}
    </span>
  );
}

export function ModuleBadge({ code }: { code: string }) {
  return (
    <span className="font-mono text-[11px] font-medium text-[var(--accent)]">{code}</span>
  );
}

export function BankStatusBadge({
  status,
  pendingCount,
  liveCount,
}: {
  status: "new" | "updated" | "current";
  pendingCount?: number;
  liveCount?: number;
}) {
  if (status === "new") {
    return (
      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 border border-amber-200">
        New · {pendingCount ?? 0} draft{(pendingCount ?? 0) === 1 ? "" : "s"}
      </span>
    );
  }
  if (status === "updated") {
    return (
      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
        Updated · {liveCount ?? 0} live
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-muted)]">
      Current · {liveCount ?? 0} live
    </span>
  );
}

export function AssignmentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE:    "bg-[#e3f0fd] text-[#0058ae] border border-[#c3daf8]",
    SCHEDULED: "bg-amber-50 text-amber-700 border border-amber-200",
    COMPLETED: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    EXPIRED:   "text-[var(--ink-muted)] border border-[var(--line)]",
    DISABLED:  "text-[var(--ink-muted)] border border-[var(--line)]",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[status] ?? "border border-[var(--line)] text-[var(--ink-muted)]"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ReadinessBadge({ ready, liveCount }: { ready: boolean; liveCount: number }) {
  if (ready) {
    return (
      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
        Ready · {liveCount} in scope
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
      Needs bank · {liveCount}/40 in scope
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tightish text-[var(--ink)]">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--ink-muted)]">{hint}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft" }) {
  const styles = {
    primary: "bg-[#0071e3] text-white hover:bg-[#0077ed] active:bg-[#0058ae]",
    ghost:   "bg-transparent text-[var(--ink)] hover:bg-[var(--bg-muted)] border border-[var(--line)]",
    danger:  "bg-red-500 text-white hover:bg-red-600 active:bg-red-700",
    soft:    "bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90",
  };
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all disabled:opacity-40",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--ink-muted)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-[14px] text-[var(--ink)] placeholder-[var(--ink-faint)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] p-14 text-center">
      <div className="text-xl font-semibold text-[var(--ink)]">{title}</div>
      <p className="mt-2 text-[13px] text-[var(--ink-muted)]">{body}</p>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
      {msg}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-xl bg-[var(--bg-muted)]", className)} />;
}
