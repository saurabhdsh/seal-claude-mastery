import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorState, Skeleton } from "../components/ui";

type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeSeconds: number;
  open: boolean;
};

type TraineeRow = {
  id: string;
  name: string;
  employeeId: string;
  spentSeconds: number;
  remainingSeconds: number;
  sessionCount: number;
  lastActiveAt: string | null;
  inPlayground: boolean;
  sessions: SessionRow[];
};

type PracticeLog = {
  budgetSeconds: number;
  programHours: number;
  practiceHours: number;
  traineeCount: number;
  inPlayground: number;
  spentSeconds: number;
  trainees: TraineeRow[];
};

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function PracticeLogPage() {
  const q = useQuery({
    queryKey: ["practice-log"],
    queryFn: () => api<PracticeLog>("/api/admin/playground/practice"),
    refetchInterval: 20000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data!;
  return (
    <div className="space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Playground</div>
        <h1 className="mt-1 font-serif text-4xl">Practice log</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          The program is {data.programHours} hours. This clock is the {data.practiceHours}-hour playground block.
          Time counts only while the playground page is open, and a later login continues from the saved total.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Cohort time</div>
          <div className="mt-1 font-serif text-3xl tabular">{formatClock(data.spentSeconds)}</div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">In the playground</div>
          <div className="mt-1 font-serif text-3xl tabular">{data.inPlayground}<span className="text-lg text-[var(--ink-muted)]">/{data.traineeCount}</span></div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Block</div>
          <div className="mt-1 font-serif text-3xl tabular">{data.practiceHours}:00:00</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--line)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Trainee</th>
              <th className="px-4 py-3 font-medium">Spent</th>
              <th className="px-4 py-3 font-medium">Remaining</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {data.trainees.map((trainee) => (
              <Fragment key={trainee.id}>
                <tr className="border-b border-[var(--line)]">
                  <td className="px-4 py-3">
                    <button type="button" className="text-left" onClick={() => setOpenId(openId === trainee.id ? null : trainee.id)}>
                      <div className="font-medium">{trainee.name}</div>
                      <div className="text-xs text-[var(--ink-muted)]">{trainee.employeeId}{trainee.inPlayground ? " · in playground" : ""}</div>
                    </button>
                  </td>
                  <td className="px-4 py-3 tabular">{formatClock(trainee.spentSeconds)}</td>
                  <td className="px-4 py-3 tabular">{formatClock(trainee.remainingSeconds)}</td>
                  <td className="px-4 py-3 tabular">{trainee.sessionCount}</td>
                  <td className="px-4 py-3 text-[var(--ink-muted)]">{formatWhen(trainee.lastActiveAt)}</td>
                </tr>
                {openId === trainee.id && (
                  <tr className="border-b border-[var(--line)] bg-[#fafafa]">
                    <td colSpan={5} className="px-4 py-3">
                      {trainee.sessions.length === 0 ? (
                        <p className="text-sm text-[var(--ink-muted)]">No practice sessions yet.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                            <tr>
                              <th className="py-1 text-left font-medium">Started</th>
                              <th className="py-1 text-left font-medium">Ended</th>
                              <th className="py-1 text-left font-medium">Counted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trainee.sessions.map((session) => (
                              <tr key={session.id}>
                                <td className="py-1">{formatWhen(session.startedAt)}</td>
                                <td className="py-1">{session.open ? "Open" : formatWhen(session.endedAt)}</td>
                                <td className="py-1 tabular">{formatClock(session.activeSeconds)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
