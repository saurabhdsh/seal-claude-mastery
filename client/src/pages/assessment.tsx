import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../stores/auth";
import { Button, EmptyState, ErrorState, LevelBadge, Skeleton } from "../components/ui";
import { AutosaveIndicator, ProgressRail, Timer } from "../components/media";
import { hasAttempted, QuestionNavigator, QuestionRenderer } from "../components/QuestionRenderer";

export function AssessmentHome() {
  const { user, assessment } = useAuth();
  const q = useQuery({ queryKey: ["mine"], queryFn: () => api<any>("/api/assessment/mine") });
  const asg =
    q.data?.assignments?.find((a: any) => a.status === "ACTIVE") ??
    q.data?.assignments?.[0];
  return (
    <div className="app-bg mx-auto min-h-screen max-w-3xl px-6 py-16">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">SEAL · Claude Mastery</div>
      <h1 className="mt-3 font-serif text-5xl">
        {user?.trainee?.firstName} {user?.trainee?.lastName}
      </h1>
      <div className="mt-4 flex gap-3">
        {user?.trainee && <LevelBadge level={user.trainee.assignedLevel} />}
        <span className="text-sm text-[var(--ink-muted)]">{(assessment as any)?.status ?? asg?.status}</span>
      </div>
      {asg ? (
        <Link to={`/assessment/instructions?assignment=${asg.id}`} className="mt-10 block">
          <Button>Continue to instructions</Button>
        </Link>
      ) : (
        <div className="mt-10">
          <EmptyState title="No assignment" body="Your assessment manager has not assigned a sitting yet." />
        </div>
      )}
    </div>
  );
}

export function InstructionsPage() {
  const assignmentId = new URLSearchParams(location.search).get("assignment") ?? "";
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["instructions", assignmentId],
    queryFn: () => api<any>(`/api/assessment/assignments/${assignmentId}/instructions`),
    enabled: !!assignmentId,
  });
  const [ack, setAck] = useState(false);
  const start = useMutation({
    mutationFn: async () => {
      if (
        q.data?.existingAttemptStatus === "IN_PROGRESS" &&
        q.data.existingAttemptId &&
        (q.data.existingQuestionCount ?? 0) >= 40 &&
        (q.data.existingLevelCount ?? 0) >= 4
      ) {
        return q.data.existingAttemptId as string;
      }
      const s = await api<{ attemptId: string; status: string }>(`/api/assessment/assignments/${assignmentId}/start`, {
        method: "POST",
      });
      if (s.status === "IN_PROGRESS") return s.attemptId;
      await api(`/api/assessment/attempts/${s.attemptId}/begin`, { method: "POST" });
      return s.attemptId;
    },
    onSuccess: (id) => nav(`/assessment/session/${id}`),
  });
  if (q.isLoading) return <Skeleton className="m-10 h-64" />;
  if (q.error) return <div className="p-10"><ErrorState error={q.error} /></div>;
  const d = q.data;
  return (
    <div className="app-bg mx-auto min-h-screen max-w-2xl px-6 py-16">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Pre-assessment</div>
      <h1 className="mt-2 font-serif text-4xl">Confirm sitting</h1>
      <dl className="mt-8 space-y-3 text-sm">
        <div className="flex justify-between"><dt className="text-[var(--ink-muted)]">Candidate</dt><dd>{d.candidate}</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--ink-muted)]">Assigned track</dt><dd>{d.assignedLevel}</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--ink-muted)]">Duration</dt><dd>{d.durationSeconds / 60} minutes</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--ink-muted)]">Questions</dt><dd>{d.approximateQuestions} mixed across all levels</dd></div>
      </dl>
      <div className="mt-6">
        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Coverage</div>
        <p className="mt-2 text-sm leading-7">
          {d.coverage ?? "Foundation, Practitioner, Advanced, and Expert modules."} The 40 items are drawn from the
          full catalog (F, P, A, X, E), not only your assigned track.
        </p>
      </div>
      <ul className="mt-6 space-y-2 text-sm text-[var(--ink-muted)]">
        <li>The timer cannot be paused. It is enforced on the server.</li>
        <li>Answers autosave. Refresh does not lose progress.</li>
        <li>The sitting auto-submits at zero.</li>
        <li>You may flag items and {d.rules.navigation ? "navigate freely" : "only move forward"}.</li>
        {d.rules.prohibited && <li>{d.rules.prohibited}</li>}
      </ul>
      <label className="mt-8 flex items-start gap-3 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        I understand these rules and will complete the assessment under the stated integrity policy.
      </label>
      {d.existingAttemptStatus === "IN_PROGRESS" &&
        (d.existingQuestionCount ?? 0) >= 40 &&
        (d.existingLevelCount ?? 0) >= 4 && (
        <p className="mt-4 text-sm text-coral">An in-progress sitting was found. You will resume with remaining time restored.</p>
      )}
      {d.completedAttemptId && d.attemptsRemaining === 0 && (
        <Link to={`/assessment/complete/${d.completedAttemptId}`} className="mt-6 block">
          <Button type="button">Sitting recorded</Button>
        </Link>
      )}
      {(d.attemptsRemaining > 0 || d.existingAttemptStatus === "IN_PROGRESS") && (
        <Button className="mt-6" disabled={!ack || start.isPending} onClick={() => start.mutate()}>
          {start.isPending
            ? "Assembling…"
            : d.existingAttemptStatus === "IN_PROGRESS" &&
                (d.existingQuestionCount ?? 0) >= 40 &&
                (d.existingLevelCount ?? 0) >= 4
              ? "Resume assessment"
              : "Begin assessment"}
        </Button>
      )}
      {start.error && <div className="mt-4"><ErrorState error={start.error} /></div>}
    </div>
  );
}

export function SessionPage() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ["attempt", attemptId],
    queryFn: () => api<any>(`/api/assessment/attempts/${attemptId}`),
    refetchInterval: 20000,
  });
  const [index, setIndex] = useState(0);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(() => new Set());
  const lastTick = useRef<Record<string, number>>({});
  const hadTime = useRef(false);

  useEffect(() => {
    if (session.data?.remainingSeconds != null) setRemaining(session.data.remainingSeconds);
    if (session.data?.currentIndex != null) setIndex(session.data.currentIndex);
    if (session.data?.questions) {
      setAnsweredIds(
        new Set(
          session.data.questions
            .filter((q: any) => hasAttempted(q.answer))
            .map((q: any) => q.questionId as string),
        ),
      );
    }
  }, [session.data?.id]);

  useEffect(() => {
    if (remaining == null) return;
    const t = setInterval(() => setRemaining((r) => (r == null ? r : Math.max(0, r - 1))), 1000);
    return () => clearInterval(t);
  }, [remaining != null]);

  useEffect(() => {
    if (remaining != null && remaining > 0) hadTime.current = true;
    if (remaining !== 0 || !hadTime.current || !attemptId || submitting) return;
    setSubmitting(true);
    api(`/api/assessment/attempts/${attemptId}/submit`, { method: "POST" })
      .then(() => nav(`/assessment/complete/${attemptId}`))
      .catch(() => nav(`/assessment/complete/${attemptId}`));
  }, [remaining, attemptId, nav, submitting]);

  useEffect(() => {
    const ping = (type: string, payload?: unknown) =>
      api(`/api/assessment/attempts/${attemptId}/integrity`, {
        method: "POST",
        body: JSON.stringify({ type, payload, clientTs: new Date().toISOString() }),
      }).catch(() => undefined);
    const onBlur = () => ping("WINDOW_BLUR");
    const onVis = () => ping(document.hidden ? "TAB_SWITCH" : "FOCUS_RETURN");
    const onCopy = () => ping("COPY");
    const onPaste = () => ping("PASTE");
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [attemptId]);

  const questions = session.data?.questions ?? [];
  const current = questions[index];

  const persist = async (patch: any, idx = index, question = current) => {
    if (!question) return;
    setSave(navigator.onLine ? "saving" : "offline");
    const spent = (lastTick.current[question.questionId] ?? 0) + 800;
    lastTick.current[question.questionId] = spent;
    const nextAnswer = { ...question.answer, ...patch };
    question.answer = nextAnswer;
    if (hasAttempted(nextAnswer)) {
      setAnsweredIds((prev) => {
        if (prev.has(question.questionId)) return prev;
        const next = new Set(prev);
        next.add(question.questionId);
        return next;
      });
    } else {
      setAnsweredIds((prev) => {
        if (!prev.has(question.questionId)) return prev;
        const next = new Set(prev);
        next.delete(question.questionId);
        return next;
      });
    }
    qc.setQueryData(["attempt", attemptId], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        currentIndex: idx,
        questions: old.questions.map((q: any) =>
          q.questionId === question.questionId ? { ...q, answer: nextAnswer } : q,
        ),
      };
    });
    try {
      await api(`/api/assessment/attempts/${attemptId}/answers`, {
        method: "PUT",
        body: JSON.stringify({
          questionId: question.questionId,
          currentIndex: idx,
          timeSpentMs: spent,
          selectedKeys: nextAnswer.selectedKeys ?? [],
          matchPairs: nextAnswer.matchPairs,
          sequence: nextAnswer.sequence,
          textResponse: nextAnswer.textResponse,
          flagged: nextAnswer.flagged,
        }),
      });
      setSave("saved");
    } catch {
      setSave("offline");
    }
  };

  const goTo = async (nextIndex: number) => {
    await persist({}, nextIndex);
    setIndex(nextIndex);
  };

  const finalizeSitting = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    try {
      await persist({});
      await api(`/api/assessment/attempts/${attemptId}/submit`, { method: "POST" });
      nav(`/assessment/complete/${attemptId}`);
    } catch {
      setSubmitting(false);
      setConfirmSubmit(false);
    }
  };

  const flagged = useMemo(
    () => new Set<number>(questions.flatMap((q: any, i: number) => (q.answer?.flagged ? [i] : []))),
    [questions],
  );
  const answered = useMemo(
    () =>
      new Set<number>(
        questions.flatMap((q: any, i: number) =>
          answeredIds.has(q.questionId) || hasAttempted(q.answer) ? [i] : [],
        ),
      ),
    [questions, answeredIds],
  );

  if (session.isLoading) return <Skeleton className="m-10 h-96" />;
  if (session.error) return <div className="p-10"><ErrorState error={session.error} /></div>;
  if (session.data?.status && !["IN_PROGRESS", "PENDING"].includes(session.data.status)) {
    nav(`/assessment/complete/${attemptId}`);
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Claude Mastery</div>
          <div className="text-sm">
            Question {index + 1} / {questions.length}
            {current?.snapshot?.moduleCode && (
              <span className="ml-2 text-[var(--ink-muted)]">
                {current.snapshot.moduleCode}
                {current.snapshot.level ? ` · ${String(current.snapshot.level).replaceAll("_", " ")}` : ""}
              </span>
            )}
          </div>
        </div>
        <Timer remainingSeconds={remaining} />
        <AutosaveIndicator status={save} />
      </header>
      <ProgressRail current={index + 1} total={questions.length || 1} />
      <div className="grid flex-1 gap-6 lg:grid-cols-[200px_1fr_220px]">
        <aside className="border-r border-[var(--line)] p-4">
          <QuestionNavigator
            count={questions.length}
            current={index}
            flagged={flagged}
            answered={answered}
            onJump={(i) => void goTo(i)}
          />
          <p className="mt-3 text-[11px] leading-5 text-[var(--ink-muted)]">
            Coral fill means answered. The current item has a dark ring.
          </p>
        </aside>
        <main className="px-4 py-8 lg:px-10">
          {current && (
            <QuestionRenderer
              snapshot={current.snapshot}
              answer={current.answer}
              onChange={(next) => {
                current.answer = next;
                persist(next);
              }}
            />
          )}
          <div className="mt-10 flex flex-wrap gap-2">
            <Button variant="ghost" disabled={index === 0 || submitting} onClick={() => void goTo(Math.max(0, index - 1))}>
              Previous
            </Button>
            {index < questions.length - 1 ? (
              <Button disabled={submitting} onClick={() => void goTo(index + 1)}>
                Next question
              </Button>
            ) : (
              <Button disabled={submitting} onClick={() => setConfirmSubmit(true)}>
                Review and submit sitting
              </Button>
            )}
            <Button
              variant="soft"
              disabled={submitting}
              onClick={() => persist({ flagged: !current?.answer?.flagged })}
            >
              {current?.answer?.flagged ? "Unflag" : "Flag"}
            </Button>
            <Button
              variant="ghost"
              disabled={submitting}
              onClick={() => persist({ selectedKeys: [], textResponse: "", sequence: [], matchPairs: {} })}
            >
              Clear response
            </Button>
            <Button variant="ghost" className="ml-auto" disabled={submitting} onClick={() => setConfirmSubmit(true)}>
              Submit sitting…
            </Button>
          </div>
          {confirmSubmit && (
            <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-elev)] p-5">
              <div className="font-serif text-2xl">Submit the entire sitting?</div>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                Answers autosave as you go. This button ends the assessment and scores every item, including
                unanswered ones as zero. You have answered {answered.size} of {questions.length} questions.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="danger" disabled={submitting} onClick={() => void finalizeSitting()}>
                  {submitting ? "Submitting…" : "Yes, submit sitting"}
                </Button>
                <Button variant="ghost" disabled={submitting} onClick={() => setConfirmSubmit(false)}>
                  Keep working
                </Button>
              </div>
            </div>
          )}
        </main>
        <aside className="hidden border-l border-[var(--line)] p-4 text-sm text-[var(--ink-muted)] lg:block">
          <div className="text-[11px] uppercase tracking-[0.14em]">Context</div>
          <p className="mt-3 leading-6">
            Correctness is not revealed during the sitting. Use flag for items you want to revisit. Remaining time is
            derived from the server clock.
          </p>
        </aside>
      </div>
    </div>
  );
}

export function CompletePage() {
  const { attemptId } = useParams();
  const { user } = useAuth();
  if (user && user.role !== "TRAINEE") {
    return <Navigate to={`/admin/results/${attemptId}`} replace />;
  }
  return (
    <div className="app-bg mx-auto grid min-h-screen max-w-2xl place-content-center px-6 py-16 text-center">
      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">SEAL · Claude Mastery</div>
      <h1 className="mt-4 font-serif text-5xl leading-tight">Thanks for taking the assessment</h1>
      <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-[var(--ink-muted)]">
        Your responses have been recorded. Scores and competency feedback are held for your assessment manager and are
        not shown to candidates.
      </p>
      <Link to="/assessment" className="mt-10 inline-flex justify-center">
        <Button type="button">Return home</Button>
      </Link>
    </div>
  );
}
