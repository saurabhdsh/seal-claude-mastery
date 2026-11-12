import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, keepSessionAlive } from "../lib/api";
import { useAuth } from "../stores/auth";
import { Button, ErrorState, LevelBadge, Skeleton } from "../components/ui";
import { AutosaveIndicator, ProgressRail, Timer } from "../components/media";
import { hasAttempted, QuestionNavigator, QuestionRenderer } from "../components/QuestionRenderer";

function attemptCounts(asg: any) {
  const attempts = asg?.attempts ?? [];
  const consumed = attempts.filter((a: any) =>
    ["COMPLETED", "LOCKED", "SUBMITTED", "EVALUATING"].includes(a.status),
  ).length;
  const inProgress = attempts.find((a: any) => a.status === "IN_PROGRESS");
  const completed = attempts.find((a: any) => a.status === "COMPLETED" || a.result);
  const remaining = Math.max(0, (asg?.maxAttempts ?? 1) - consumed);
  return { consumed, remaining, inProgress, completed };
}

export function AssessmentHome() {
  const { user, assessment } = useAuth();
  const q = useQuery({ queryKey: ["mine"], queryFn: () => api<any>("/api/assessment/mine") });
  const asg =
    q.data?.assignments?.find((a: any) => a.status === "ACTIVE") ??
    q.data?.assignments?.[0];
  const counts = asg ? attemptCounts(asg) : null;
  const assessmentOpen = !!asg && q.data?.access?.assessmentEnabled !== false;
  const canStart =
    assessmentOpen &&
    asg?.status === "ACTIVE" &&
    (!!counts?.inProgress || (counts?.remaining ?? 0) > 0);
  const sittingTitle = !asg
    ? "No sitting yet"
    : counts?.inProgress
      ? "Resume assessment"
      : canStart && counts?.completed
        ? "Retake available"
        : canStart
          ? "Start Assessment"
          : "Assessment completed";
  const sittingBody = !asg
    ? "Your assessment manager has not assigned a sitting yet. The playground is still open."
    : counts?.inProgress
      ? `${asg.template?.name ?? "Your assessment"} is in progress. Continue with remaining time.`
      : canStart && counts?.completed
        ? `You already submitted once. ${counts.remaining} attempt${counts.remaining === 1 ? "" : "s"} left of ${asg.maxAttempts}.`
      : canStart
        ? `${asg.template?.name ?? "Your assigned assessment"}. Timed, scored, and recorded.`
        : counts?.completed
          ? "Your sitting is recorded. No attempts remain."
          : "This sitting is closed. Practice in the playground if it is still open.";
  return (
    <div className="app-bg mx-auto min-h-screen max-w-3xl px-6 py-16">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">SEAL · Claude Mastery</div>
      <h1 className="mt-3 font-serif text-5xl">
        {user?.trainee?.firstName} {user?.trainee?.lastName}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {user?.trainee && <LevelBadge level={user.trainee.assignedLevel} />}
        <span className="text-sm text-[var(--ink-muted)]">{(assessment as any)?.status ?? asg?.status}</span>
        <Link to="/profile" className="text-sm text-coral">Change password</Link>
      </div>
      <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2">
        {q.data?.access?.playgroundEnabled !== false && (
          <Link to="/playground" className="flex h-full flex-col rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm transition hover:-translate-y-0.5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Practice</div>
            <h2 className="mt-2 font-serif text-3xl">Start Playground</h2>
            <p className="mt-3 flex-1 text-sm leading-6 text-[var(--ink-muted)]">
              Work through every module: prompts, agents, tool schemas, code, and the capstone. Nothing here is scored.
            </p>
            <Button type="button" className="mt-6 w-full">Open playground</Button>
          </Link>
        )}
        {canStart ? (
          <Link to={`/assessment/instructions?assignment=${asg.id}`} className="flex h-full flex-col rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm transition hover:-translate-y-0.5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Sitting</div>
            <h2 className="mt-2 font-serif text-3xl">{sittingTitle}</h2>
            <p className="mt-3 flex-1 text-sm leading-6 text-[var(--ink-muted)]">{sittingBody}</p>
            <Button type="button" className="mt-6 w-full">
              {counts?.inProgress ? "Resume assessment" : counts?.completed ? "Begin retake" : "Open assessment"}
            </Button>
          </Link>
        ) : (
          <div className="flex h-full flex-col rounded-3xl border border-dashed border-[var(--line)] bg-white/60 p-6">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Sitting</div>
            <h2 className="mt-2 font-serif text-3xl">{sittingTitle}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{sittingBody}</p>
            {counts?.completed && (
              <Link to={`/assessment/complete/${counts.completed.id}`} className="mt-6">
                <Button type="button" className="w-full">View recorded result</Button>
              </Link>
            )}
          </div>
        )}
      </div>
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
        (q.data.existingQuestionCount ?? 0) >= (q.data.approximateQuestions ?? 40) &&
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
          {d.coverage ?? "Foundation, Practitioner, Advanced, and Expert modules."} The {d.approximateQuestions} items
          are drawn from the full catalog (F, P, A, X, E), not only your assigned track.
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
        (d.existingQuestionCount ?? 0) >= (d.approximateQuestions ?? 40) &&
        (d.existingLevelCount ?? 0) >= 4 && (
        <p className="mt-4 text-sm text-coral">An in-progress sitting was found. You will resume with remaining time restored.</p>
      )}
      <div className="mt-4 text-sm text-[var(--ink-muted)]">
        Attempts used {d.attemptsUsed ?? 0} of {d.maxAttempts ?? 1}
        {(d.attemptsRemaining ?? 0) > 0 ? ` · ${d.attemptsRemaining} remaining` : " · none remaining"}
      </div>
      {d.completedAttemptId && (
        <Link to={`/assessment/complete/${d.completedAttemptId}`} className="mt-4 block">
          <Button type="button" variant="ghost">View last recorded result</Button>
        </Link>
      )}
      {d.completedAttemptId && d.attemptsRemaining === 0 && !d.existingAttemptStatus && (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Sitting finished. No further attempts are available.</p>
      )}
      {(d.attemptsRemaining > 0 || d.existingAttemptStatus === "IN_PROGRESS") && (
        <Button className="mt-6" disabled={!ack || start.isPending} onClick={() => start.mutate()}>
          {start.isPending
            ? "Assembling…"
            : d.existingAttemptStatus === "IN_PROGRESS" &&
                (d.existingQuestionCount ?? 0) >= (d.approximateQuestions ?? 40) &&
                (d.existingLevelCount ?? 0) >= 4
              ? "Resume assessment"
              : d.completedAttemptId
                ? "Begin retake"
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
  const saveTimers = useRef<Record<string, number>>({});
  const saveControllers = useRef<Record<string, AbortController>>({});
  const saveChain = useRef<Promise<void>>(Promise.resolve());

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
    void (async () => {
      try {
        await flushAllSaves();
        await api(`/api/assessment/attempts/${attemptId}/submit`, { method: "POST" });
      } catch {
        /* still leave the sitting */
      } finally {
        nav(`/assessment/complete/${attemptId}`);
      }
    })();
  }, [remaining, attemptId, nav, submitting]);

  // Keep auth alive for the full 120-minute sitting even if the trainee sits idle.
  useEffect(() => {
    void keepSessionAlive();
    const beat = window.setInterval(() => {
      void keepSessionAlive();
    }, 4 * 60 * 1000);
    return () => window.clearInterval(beat);
  }, [attemptId]);

  useEffect(() => {
    const lastSent = new Map<string, number>();
    const ping = (type: string, payload?: unknown) => {
      const now = Date.now();
      // Debounce focus/blur spam so idle alt-tabbing cannot flood auth/rate limits.
      const minGap = type === "COPY" || type === "PASTE" ? 2000 : 12000;
      if ((lastSent.get(type) ?? 0) + minGap > now) return;
      lastSent.set(type, now);
      api(`/api/assessment/attempts/${attemptId}/integrity`, {
        method: "POST",
        body: JSON.stringify({ type, payload, clientTs: new Date().toISOString() }),
      }).catch(() => undefined);
    };
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

  const applyLocalAnswer = (patch: any, idx: number, question: any) => {
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
    return nextAnswer;
  };

  const persistNow = async (idx: number, question: any) => {
    if (!question || !attemptId) return;
    const qid = question.questionId as string;
    saveControllers.current[qid]?.abort();
    const ac = new AbortController();
    saveControllers.current[qid] = ac;
    setSave(navigator.onLine ? "saving" : "offline");
    const spent = (lastTick.current[qid] ?? 0) + 800;
    lastTick.current[qid] = spent;
    const nextAnswer = question.answer ?? {};
    const clientSavedAt = new Date().toISOString();
    try {
      await api(`/api/assessment/attempts/${attemptId}/answers`, {
        method: "PUT",
        signal: ac.signal,
        body: JSON.stringify({
          questionId: qid,
          currentIndex: idx,
          timeSpentMs: spent,
          selectedKeys: nextAnswer.selectedKeys ?? [],
          matchPairs: nextAnswer.matchPairs,
          sequence: nextAnswer.sequence,
          textResponse: nextAnswer.textResponse ?? "",
          flagged: nextAnswer.flagged,
          clientSavedAt,
        }),
      });
      if (!ac.signal.aborted) setSave("saved");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setSave("offline");
    }
  };

  const persist = (patch: any, idx = index, question = current, opts?: { flush?: boolean }) => {
    if (!question) return Promise.resolve();
    applyLocalAnswer(patch, idx, question);
    const qid = question.questionId as string;
    if (saveTimers.current[qid]) {
      window.clearTimeout(saveTimers.current[qid]);
      delete saveTimers.current[qid];
    }
    if (opts?.flush) {
      const run = () => persistNow(idx, question);
      saveChain.current = saveChain.current.then(run, run);
      return saveChain.current;
    }
    saveTimers.current[qid] = window.setTimeout(() => {
      delete saveTimers.current[qid];
      const run = () => persistNow(idx, question);
      saveChain.current = saveChain.current.then(run, run);
    }, 500);
    return Promise.resolve();
  };

  const flushAllSaves = async () => {
    const qs = (qc.getQueryData(["attempt", attemptId]) as any)?.questions ?? questions;
    for (const q of qs) {
      const qid = q.questionId as string;
      if (saveTimers.current[qid]) {
        window.clearTimeout(saveTimers.current[qid]);
        delete saveTimers.current[qid];
      }
    }
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (!q?.answer) continue;
      if (!hasAttempted(q.answer) && !(q.answer.textResponse ?? "").length) continue;
      await persistNow(i, q);
    }
    await saveChain.current;
  };

  useEffect(() => {
    return () => {
      for (const t of Object.values(saveTimers.current)) window.clearTimeout(t);
      for (const c of Object.values(saveControllers.current)) c.abort();
    };
  }, []);

  const goTo = async (nextIndex: number) => {
    await persist({}, index, current, { flush: true });
    setIndex(nextIndex);
  };

  const finalizeSitting = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    try {
      await flushAllSaves();
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
              onChange={(next, opts) => {
                void persist(next, index, current, opts);
              }}
              onFlush={() => {
                void persist({}, index, current, { flush: true });
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
              <Button
                disabled={submitting}
                onClick={() => {
                  void persist({}, index, current, { flush: true }).then(() => setConfirmSubmit(true));
                }}
              >
                Review and submit sitting
              </Button>
            )}
            <Button
              variant="soft"
              disabled={submitting}
              onClick={() => void persist({ flagged: !current?.answer?.flagged }, index, current, { flush: true })}
            >
              {current?.answer?.flagged ? "Unflag" : "Flag"}
            </Button>
            <Button
              variant="ghost"
              disabled={submitting}
              onClick={() =>
                void persist({ selectedKeys: [], textResponse: "", sequence: [], matchPairs: {} }, index, current, {
                  flush: true,
                })
              }
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
