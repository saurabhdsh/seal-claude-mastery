import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button, EmptyState, ErrorState, Field, LevelBadge, MetricCard, ModuleBadge, BankStatusBadge, AssignmentStatusBadge, ReadinessBadge, Skeleton, inputClass, DifficultyBadge } from "../components/ui";
import { AIQualityIndicator } from "../components/media";
import { CompetencyRadar, ModuleHeatmap } from "../components/charts";
import { ResultProfile } from "../components/ResultProfile";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../stores/auth";

export function DashboardPage() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<any>("/api/admin/dashboard") });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data;
  return (
    <div className="space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Operations</div>
        <h1 className="mt-1 font-serif text-4xl">Command center</h1>
      </header>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Active trainees" value={d.metrics.activeTrainees} />
        <MetricCard label="Assigned" value={d.metrics.assessmentsAssigned} />
        <MetricCard label="Completed" value={d.metrics.assessmentsCompleted} />
        <MetricCard label="Average score" value={d.metrics.averageScore} />
        <MetricCard label="Pass rate" value={`${d.metrics.passRate}%`} />
        <MetricCard label="Claude Expert rate" value={`${d.metrics.claudeExpertRate}%`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="hairline rounded-2xl bg-[var(--bg-elev)] p-5">
          <h2 className="text-sm text-[var(--ink-muted)]">Level distribution</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={d.levelDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#d97757" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="hairline rounded-2xl bg-[var(--bg-elev)] p-5">
          <h2 className="text-sm text-[var(--ink-muted)]">Completion trend</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={d.completionTrend.map((r: any) => ({ ...r, t: new Date(r.createdAt).toLocaleDateString() }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="overallScore" stroke="#d97757" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm text-[var(--ink-muted)]">Hardest modules</h2>
          <ul className="space-y-2">
            {d.hardestModules.map((m: any) => (
              <li key={m.moduleId} className="flex items-center justify-between rounded-xl border border-[var(--line)] px-4 py-2 text-sm">
                <span>
                  <ModuleBadge code={m.code} /> {m.name}
                </span>
                <span className="tabular">{Number(m.avgScore).toFixed(1)}</span>
              </li>
            ))}
            {!d.hardestModules.length && <EmptyState title="No module results yet" body="Scores appear after the first completed sitting." />}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-sm text-[var(--ink-muted)]">Candidates requiring development</h2>
          <ul className="space-y-2">
            {d.candidatesRequiringDevelopment.map((c: any) => (
              <li key={c.attemptId} className="flex items-center justify-between rounded-xl border border-[var(--line)] px-4 py-2 text-sm">
                <Link to={`/admin/results/${c.attemptId}`} className="hover:text-coral">
                  {c.trainee}
                </Link>
                <span className="tabular">{c.score.toFixed(0)}</span>
              </li>
            ))}
            {!d.candidatesRequiringDevelopment.length && <p className="text-sm text-[var(--ink-muted)]">No below-threshold results yet.</p>}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function TraineesPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["trainees", q],
    queryFn: () => api<any>(`/api/admin/trainees?q=${encodeURIComponent(q)}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/admin/trainees/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trainees"] }); setDeleting(null); },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-4xl">Trainees</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Search, filter, and inspect capability profiles.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Create trainee</Button>
      </div>
      <input className={inputClass + " max-w-md"} placeholder="Search by name or username" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading && <Skeleton className="h-40" />}
      {list.error && <ErrorState error={list.error} />}
      {list.data && (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg-muted)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <tr>
                {["Name", "Username", "Level", "Assessment", "Status", "Score", "Band", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.rows.map((r: any) => (
                <tr key={r.id} className="border-t border-[var(--line)] hover:bg-[var(--bg-muted)]/50">
                  <td className="px-4 py-3">
                    <Link to={`/admin/trainees/${r.id}`} className="hover:text-coral">
                      {r.firstName} {r.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.username ?? r.employeeId}</td>
                  <td className="px-4 py-3">
                    <LevelBadge level={r.assignedLevel} />
                  </td>
                  <td className="px-4 py-3">{r.assessment ?? "—"}</td>
                  <td className="px-4 py-3">
                    {r.status ? <AssignmentStatusBadge status={r.status} /> : "—"}
                  </td>
                  <td className="px-4 py-3 tabular">{r.score?.toFixed?.(1) ?? "—"}</td>
                  <td className="px-4 py-3">{r.band?.replaceAll("_", " ") ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {deleting === r.id ? (
                      <div className="flex items-center justify-end gap-2 text-xs">
                        <span className="text-[var(--ink-muted)]">Delete?</span>
                        <button className="rounded px-2 py-0.5 bg-red-500/15 text-red-400 hover:bg-red-500/30" onClick={() => del.mutate(r.id)} disabled={del.isPending}>Confirm</button>
                        <button className="rounded px-2 py-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={() => setDeleting(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="text-xs text-[var(--ink-muted)] hover:text-red-400" onClick={() => setDeleting(r.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <CreateTrainee onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreateTrainee({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
    password: "",
    assignedLevel: "FOUNDATION",
    assignAssessment: true,
    maxAttempts: 3,
  });
  const [usernameManual, setUsernameManual] = useState(false);
  const [created, setCreated] = useState<{ username: string; name: string } | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      api("/api/admin/trainees", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          firstName: form.firstName,
          lastName: form.lastName,
          assignedLevel: form.assignedLevel,
          password: form.password,
          assignAssessment: form.assignAssessment,
          maxAttempts: form.maxAttempts,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trainees"] });
      setCreated({ username: form.username, name: form.firstName });
    },
  });

  // Auto-derive username from first name unless admin has manually edited it
  const handleFirstName = (v: string) => {
    setForm((f) => ({
      ...f,
      firstName: v,
      username: usernameManual ? f.username : v.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, ""),
    }));
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-md space-y-3 rounded-2xl bg-[var(--bg-elev)] p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (created) { onClose(); return; }
          mut.mutate();
        }}
      >
        <h2 className="font-serif text-2xl">Create trainee</h2>
        {created ? (
          <div className="space-y-3 text-sm">
            <p>Account created for <strong>{created.name}</strong>.</p>
            <div className="rounded-xl bg-[var(--bg-muted)] p-4 font-mono text-xs space-y-1">
              <div><span className="text-[var(--ink-muted)]">Username  </span><strong>{created.username}</strong></div>
              <div><span className="text-[var(--ink-muted)]">Password  </span><strong>the value you set</strong></div>
            </div>
            <p className="text-[var(--ink-muted)]">Share these credentials. They sign in at /login and begin their assessment.</p>
            <div className="flex justify-end">
              <Button type="submit">Done</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--ink-muted)]">First name becomes their display name.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input
                  className={inputClass}
                  required
                  value={form.firstName}
                  onChange={(e) => handleFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name">
                <input
                  className={inputClass}
                  required
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Username">
              <input
                className={inputClass}
                required
                placeholder="e.g. john.doe"
                value={form.username}
                onChange={(e) => {
                  setUsernameManual(true);
                  setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") });
                }}
              />
            </Field>
            <p className="text-[11px] text-[var(--ink-muted)]">Auto-filled from first name. Letters, numbers, dots, hyphens only.</p>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <p className="text-[11px] text-[var(--ink-muted)]">At least 12 characters, with upper, lower, number, and symbol.</p>
            <Field label="Assigned level">
              <select className={inputClass} value={form.assignedLevel} onChange={(e) => setForm({ ...form, assignedLevel: e.target.value })}>
                {["FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.assignAssessment}
                onChange={(e) => setForm({ ...form, assignAssessment: e.target.checked })}
              />
              Assign the matching 90-minute assessment now
            </label>
            {mut.error && <ErrorState error={mut.error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Create trainee"}</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export function TraineeDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["trainee", id], queryFn: () => api<any>(`/api/admin/trainees/${id}`) });
  const templates = useQuery({ queryKey: ["assessments"], queryFn: () => api<any[]>("/api/admin/assessments") });
  const qc = useQueryClient();
  const assign = useMutation({
    mutationFn: (templateId: string) =>
      api(`/api/admin/trainees/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({
          templateId,
          startsAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          maxAttempts: 1,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trainee", id] });
      qc.invalidateQueries({ queryKey: ["trainees"] });
    },
  });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const t = q.data;
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-4xl">
        {t.firstName} {t.lastName}
      </h1>
      <div className="flex flex-wrap gap-3 text-sm text-[var(--ink-muted)]">
        <span className="font-mono">@{t.user.email.endsWith("@seal.local") ? t.user.email.replace("@seal.local", "") : t.user.email}</span>
        <LevelBadge level={t.assignedLevel} />
      </div>
      <div className="flex gap-3">
        <select
          className={inputClass + " max-w-sm"}
          defaultValue=""
          onChange={(e) => e.target.value && assign.mutate(e.target.value)}
          disabled={assign.isPending}
        >
          <option value="">Assign assessment…</option>
          {templates.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button
          variant="soft"
          onClick={() => api(`/api/admin/trainees/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password: "SealTrainee!2026" }) })}
        >
          Reset password
        </Button>
      </div>
      {assign.error && <ErrorState error={assign.error} />}
      <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--ink-muted)]">Assessment history</h2>
      {t.assignments.length === 0 && (
        <EmptyState title="No assessments assigned" body="Pick an assessment above to send this trainee a sitting." />
      )}
      <ul className="space-y-2">
        {t.assignments.map((a: any) => {
          const latest = a.attempts[0];
          return (
            <li key={a.id} className="rounded-xl border border-[var(--line)] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link to={`/admin/assessments/${a.templateId}`} className="font-medium hover:text-coral">
                    {a.template.name}
                  </Link>
                  <div className="mt-1 text-xs text-[var(--ink-muted)]">
                    Expires {new Date(a.expiresAt).toLocaleDateString()} · {a.maxAttempts} attempt{a.maxAttempts === 1 ? "" : "s"} allowed
                  </div>
                </div>
                <AssignmentStatusBadge status={a.status} />
              </div>
              {a.attempts.length === 0 && (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">Not started yet — trainee will see this after login.</p>
              )}
              {a.attempts.map((att: any) => (
                <div key={att.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-muted)]/50 px-3 py-2">
                  <span className="text-xs">
                    Attempt · {att.status.replaceAll("_", " ")}
                    {att.submittedAt && ` · ${new Date(att.submittedAt).toLocaleString()}`}
                  </span>
                  {att.result ? (
                    <Link to={`/admin/results/${att.id}`} className="text-coral">
                      {att.result.overallScore.toFixed(1)} · {att.result.proficiencyBand.replaceAll("_", " ")}
                    </Link>
                  ) : att.status === "COMPLETED" ? (
                    <Link to={`/admin/results/${att.id}`} className="text-coral">
                      View result
                    </Link>
                  ) : null}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ModulesPage({ embedded = false }: { embedded?: boolean }) {
  const q = useQuery({ queryKey: ["modules"], queryFn: () => api<any[]>("/api/admin/modules") });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <EmptyState title="No modules" body="Seed the curriculum first." />;
  const grouped = q.data.reduce((acc: any, m: any) => {
    acc[m.level] ??= [];
    acc[m.level].push(m);
    return acc;
  }, {});
  return (
    <div className="space-y-8">
      {!embedded && <h1 className="font-serif text-4xl">Curriculum</h1>}
      {Object.entries(grouped).map(([level, rows]: any) => (
        <section key={level}>
          <h2 className="mb-3 flex items-center gap-2 text-sm">
            <LevelBadge level={level} />
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((m: any) => (
              <Link
                key={m.id}
                to={`/admin/question-bank/${m.id}`}
                className={`rounded-2xl border p-4 hover:border-coral ${
                  m.bankStatus === "new" ? "border-coral/40 bg-coral/5" : "border-[var(--line)]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ModuleBadge code={m.code} />
                  <BankStatusBadge status={m.bankStatus} pendingCount={m.pendingReviewCount} liveCount={m.liveBankCount} />
                </div>
                <div className="mt-1 font-medium">{m.name}</div>
                <div className="mt-2 text-xs text-[var(--ink-muted)]">
                  {m.liveBankCount} in live bank · {m.pendingReviewCount} to review · {m.domain.name}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function QuestionBankPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-4xl">Question bank</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
          Each module has a live bank used in assessments. Generate drafts in AI Control, review them here, then approve to
          publish.
        </p>
      </header>
      <ol className="grid gap-3 text-sm md:grid-cols-3">
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 1</div>
          <div className="mt-1 font-medium">Generate</div>
          <p className="mt-1 text-[var(--ink-muted)]">AI Control creates drafts. Module shows <strong>New</strong>.</p>
        </li>
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 2</div>
          <div className="mt-1 font-medium">Review & approve</div>
          <p className="mt-1 text-[var(--ink-muted)]">Open the module, approve good items, reject the rest.</p>
        </li>
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 3</div>
          <div className="mt-1 font-medium">Live bank updated</div>
          <p className="mt-1 text-[var(--ink-muted)]">When drafts are cleared, module shows <strong>Updated</strong>.</p>
        </li>
      </ol>
      <ModulesPage embedded />
    </div>
  );
}

export function ModuleQuestionsPage() {
  const { moduleId } = useParams();
  const modules = useQuery({ queryKey: ["modules"], queryFn: () => api<any[]>("/api/admin/modules") });
  const mod = modules.data?.find((m) => m.id === moduleId);
  const q = useQuery({
    queryKey: ["questions", moduleId],
    queryFn: () => api<any[]>(`/api/admin/questions?moduleId=${moduleId}`),
    enabled: !!moduleId,
  });
  const qc = useQueryClient();
  const act = async (id: string, action: string) => {
    await api(`/api/admin/questions/${id}/${action}`, { method: "POST" });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["questions", moduleId] }),
      qc.invalidateQueries({ queryKey: ["modules"] }),
    ]);
  };

  const pending = (item: any) =>
    item.reviewStatus === "PENDING" && (item.status === "DRAFT" || item.status === "AI_VALIDATED");
  const sorted = [...(q.data ?? [])].sort((a, b) => {
    const pa = pending(a) ? 0 : 1;
    const pb = pending(b) ? 0 : 1;
    return pa - pb || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const pendingCount = sorted.filter(pending).length;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl">
            <ModuleBadge code={mod?.code ?? ""} /> {mod?.name}
          </h1>
          {mod && (
            <BankStatusBadge status={mod.bankStatus} pendingCount={mod.pendingReviewCount} liveCount={mod.liveBankCount} />
          )}
        </div>
        {mod?.bankStatus === "new" && (
          <div className="rounded-2xl border border-coral/40 bg-coral/5 px-4 py-3 text-sm">
            <strong>{pendingCount || mod.pendingReviewCount} new draft{(pendingCount || mod.pendingReviewCount) === 1 ? "" : "s"}</strong>{" "}
            waiting for review. Approve items you want in the live bank — the module will show <strong>Updated</strong> once
            all drafts are handled.
          </div>
        )}
        {mod?.bankStatus === "updated" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
            Live bank <strong>updated</strong> — {mod.liveBankCount} approved questions are available to assessments.
          </div>
        )}
        {mod?.bankStatus === "current" && (
          <div className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-muted)]">
            {mod.liveBankCount} questions in the live bank. Generate more in AI Control to expand this module.
          </div>
        )}
      </header>
      {q.isLoading && <Skeleton className="h-40" />}
      <div className="space-y-3">
        {sorted.map((item) => (
          <article
            key={item.id}
            className={`rounded-2xl border p-4 ${pending(item) ? "border-coral/30 bg-coral/[0.03]" : "border-[var(--line)]"}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {pending(item) && (
                <span className="rounded-full bg-coral/15 px-2 py-0.5 font-semibold text-coral">New draft</span>
              )}
              <DifficultyBadge difficulty={item.difficulty} />
              <span>{item.questionType.replaceAll("_", " ")}</span>
              <span>{item.status}</span>
              <AIQualityIndicator score={item.critiques?.[0]?.overall} />
              <span>used {item.usageCount}</span>
              {item.correctAnswerRate != null && <span>{Math.round(item.correctAnswerRate * 100)}% correct</span>}
            </div>
            <p className="mt-3 text-sm leading-6">{item.questionText}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {pending(item) && <Button onClick={() => act(item.id, "approve")}>Approve to live bank</Button>}
              {!pending(item) && item.status !== "APPROVED" && (
                <Button variant="ghost" onClick={() => act(item.id, "approve")}>
                  Approve
                </Button>
              )}
              <Button variant="ghost" onClick={() => act(item.id, "reject")}>
                Reject
              </Button>
              <Button variant="ghost" onClick={() => act(item.id, "retire")}>
                Retire
              </Button>
              <Button variant="ghost" onClick={() => act(item.id, "clone")}>
                Clone
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function AssessmentsPage() {
  const q = useQuery({ queryKey: ["assessments"], queryFn: () => api<any[]>("/api/admin/assessments") });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data ?? [];
  const readyCount = rows.filter((a) => a.stats?.bankReady).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">Assessments</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
            Each template pulls its 40 questions only from the modules you attach. Approve enough live items in those
            modules, then assign trainees.
          </p>
        </div>
        <Link to="/admin/assessments/create">
          <Button>Create assessment</Button>
        </Link>
      </header>

      <ol className="grid gap-3 text-sm md:grid-cols-3">
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 1</div>
          <div className="mt-1 font-medium">Pick modules</div>
          <p className="mt-1 text-[var(--ink-muted)]">Template modules define the question pool for this sitting.</p>
        </li>
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 2</div>
          <div className="mt-1 font-medium">Approve 40+ live</div>
          <p className="mt-1 text-[var(--ink-muted)]">Need 40 approved questions across those modules before assign.</p>
        </li>
        <li className="rounded-2xl border border-[var(--line)] p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Step 3</div>
          <div className="mt-1 font-medium">Assign & review</div>
          <p className="mt-1 text-[var(--ink-muted)]">Trainee takes 40 from this template; scores appear in Results.</p>
        </li>
      </ol>

      <div className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm">
        {readyCount} of {rows.length} assessment{rows.length === 1 ? "" : "s"} ready to assign.
        {readyCount < rows.length && (
          <span className="ml-2 text-[var(--ink-muted)]">
            Open a template to see which modules still need approved questions in the{" "}
            <Link to="/admin/question-bank" className="text-coral underline">
              question bank
            </Link>
            .
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <EmptyState
          title="No assessments yet"
          body="Create your first template — seeded installs usually include one per level."
        />
      )}

      <div className="space-y-3">
        {rows.map((a) => (
          <Link
            key={a.id}
            to={`/admin/assessments/${a.id}`}
            className="block rounded-2xl border border-[var(--line)] p-5 hover:border-coral"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{a.name}</div>
                {a.description && <p className="mt-1 text-sm text-[var(--ink-muted)]">{a.description}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                  <span>{a.durationSeconds / 60} min</span>
                  <span>·</span>
                  <span>40 from {a.stats.moduleCount} modules</span>
                  <span>·</span>
                  <span>{a.stats.assignedCount} assigned</span>
                  <span>·</span>
                  <span>{a.stats.completedCount} completed</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LevelBadge level={a.targetLevel} />
                <ReadinessBadge ready={a.stats.bankReady} liveCount={a.stats.liveQuestionCount} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CreateAssessmentPage() {
  const LEVEL_ORDER = ["FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];
  const modules = useQuery({ queryKey: ["modules"], queryFn: () => api<any[]>("/api/admin/modules") });
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    targetLevel: "FOUNDATION",
    mode: "LEVEL_SPECIFIC",
    durationSeconds: 5400,
    moduleIds: [] as string[],
    adaptiveEnabled: false,
    allowNavigation: true,
  });

  const levelsForMode = (target: string, mode: string) => {
    if (mode === "LEVEL_SPECIFIC") return [target];
    const idx = LEVEL_ORDER.indexOf(target);
    return LEVEL_ORDER.slice(0, Math.max(0, idx) + 1);
  };

  const pickModules = (target: string, mode: string) =>
    modules.data?.filter((m) => levelsForMode(target, mode).includes(m.level)).map((m) => m.id) ?? [];

  useEffect(() => {
    if (!modules.data) return;
    setForm((f) => ({
      ...f,
      moduleIds: pickModules(f.targetLevel, f.mode),
    }));
  }, [form.targetLevel, form.mode, modules.data]);

  const selectedModules = modules.data?.filter((m) => form.moduleIds.includes(m.id)) ?? [];
  const liveInScope = selectedModules.reduce((n, m) => n + (m.liveBankCount ?? 0), 0);
  const ready = liveInScope >= 40;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.moduleIds.length === 0) {
      setError("Select at least one module — trainees only get questions from selected modules.");
      return;
    }
    try {
      const created = await api<{ id: string }>("/api/admin/assessments", {
        method: "POST",
        body: JSON.stringify(form),
      });
      nav(`/admin/assessments/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create assessment");
    }
  };

  return (
    <form className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
      <header>
        <h1 className="font-serif text-4xl">Create assessment</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          Modules you select become the question pool. When a trainee begins, they get 40 approved questions from these
          modules only.
        </p>
      </header>

      <Field label="Name">
        <input
          className={inputClass}
          placeholder="Foundation Claude capability — Q3"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          className={inputClass + " min-h-[80px]"}
          placeholder="90-minute sitting for new hires…"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Target level">
          <select
            className={inputClass}
            value={form.targetLevel}
            onChange={(e) => setForm({ ...form, targetLevel: e.target.value })}
          >
            {LEVEL_ORDER.map((l) => (
              <option key={l} value={l}>
                {l.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select className={inputClass} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="LEVEL_SPECIFIC">Level-specific (this level’s modules)</option>
            <option value="PROGRESSIVE_MASTERY">Progressive mastery (up through this level)</option>
          </select>
        </Field>
      </div>

      <div className="rounded-2xl border border-[var(--line)] p-4 text-sm">
        <div className="font-medium">Sitting defaults</div>
        <ul className="mt-2 space-y-1 text-[var(--ink-muted)]">
          <li>90 minutes on the clock</li>
          <li>40 questions from the modules below (approved only)</li>
          <li>
            Pool right now: <strong className={ready ? "text-emerald-400" : "text-amber-400"}>{liveInScope} live</strong>{" "}
            across selected modules {ready ? "(ready)" : "(need 40)"}
          </li>
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Curriculum modules (question pool)</span>
          <button
            type="button"
            className="text-xs text-coral"
            onClick={() => setForm((f) => ({ ...f, moduleIds: pickModules(f.targetLevel, f.mode) }))}
          >
            Reset to recommended
          </button>
        </div>
        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-auto rounded-xl border border-[var(--line)] p-3 md:grid-cols-2">
          {modules.data?.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.moduleIds.includes(m.id)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    moduleIds: e.target.checked
                      ? [...form.moduleIds, m.id]
                      : form.moduleIds.filter((id) => id !== m.id),
                  })
                }
              />
              <span>
                <span className="font-mono text-coral">{m.code}</span> {m.name}
                <span className="block text-xs text-[var(--ink-muted)]">
                  {m.level.replaceAll("_", " ")} · {m.liveBankCount ?? 0} live
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          {selectedModules.length} module{selectedModules.length === 1 ? "" : "s"} selected — trainees will only see
          questions from these modules.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.allowNavigation}
          onChange={(e) => setForm({ ...form, allowNavigation: e.target.checked })}
        />
        Allow question navigation during sitting
      </label>

      {error && <ErrorState error={new Error(error)} />}
      <div className="flex gap-3">
        <Button type="submit">Create & assign trainees</Button>
        <Link to="/admin/assessments">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

export function AssessmentDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assessment", id], queryFn: () => api<any>(`/api/admin/assessments/${id}`) });
  const trainees = useQuery({
    queryKey: ["trainees", "all"],
    queryFn: () => api<any>("/api/admin/trainees?pageSize=100"),
  });
  const [traineeId, setTraineeId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(1);

  const assign = useMutation({
    mutationFn: () =>
      api(`/api/admin/assessments/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ traineeId, maxAttempts, expiresInDays: 30 }),
      }),
    onSuccess: async () => {
      setTraineeId("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["assessment", id] }),
        qc.invalidateQueries({ queryKey: ["assessments"] }),
        qc.invalidateQueries({ queryKey: ["trainees"] }),
      ]);
    },
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <EmptyState title="Not found" body="This assessment template does not exist." />;

  const a = q.data;
  const assignedTraineeIds = new Set(a.assignments.map((x: any) => x.traineeId));
  const availableTrainees =
    trainees.data?.rows?.filter((t: any) => t.isActive && !assignedTraineeIds.has(t.id)) ?? [];

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl">{a.name}</h1>
          <LevelBadge level={a.targetLevel} />
          <ReadinessBadge ready={a.stats.bankReady} liveCount={a.stats.liveQuestionCount} />
        </div>
        {a.description && <p className="text-sm text-[var(--ink-muted)]">{a.description}</p>}
        <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
          <span>{a.durationSeconds / 60} minutes</span>
          <span>40 questions from this template’s modules</span>
          <span>{a.mode.replaceAll("_", " ")}</span>
          <span>Passing score {a.passingScore}%</span>
        </div>
      </header>

      {!a.stats.bankReady && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <strong>Not ready to run.</strong> This template has {a.stats.liveQuestionCount} approved questions across its{" "}
          {a.stats.moduleCount} modules (need 40). Approve more items for those modules in the{" "}
          <Link to="/admin/question-bank" className="text-coral underline">
            question bank
          </Link>
          .
        </div>
      )}
      {a.stats.bankReady && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
          Ready — trainees will receive 40 questions drawn only from this template’s {a.stats.moduleCount} modules (
          {a.stats.liveQuestionCount} live available).
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Assigned" value={a.stats.assignedCount} hint="Trainees with this sitting" />
        <MetricCard label="Active" value={a.stats.activeCount} hint="Can still take it" />
        <MetricCard label="Completed" value={a.stats.completedCount} hint="Finished at least once" />
        <MetricCard label="Live in scope" value={a.stats.liveQuestionCount} hint="Approved in these modules" />
      </div>

      <section className="space-y-4 rounded-2xl border border-[var(--line)] p-5">
        <h2 className="font-medium">Assign a trainee</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          After login they see this sitting. Begin assembles 40 questions from the modules below only. They get{" "}
          {maxAttempts} attempt{maxAttempts === 1 ? "" : "s"} within 30 days.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Trainee">
            <select className={inputClass + " min-w-[240px]"} value={traineeId} onChange={(e) => setTraineeId(e.target.value)}>
              <option value="">Select trainee…</option>
              {availableTrainees.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName} ({t.email}) · {t.assignedLevel}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Attempts">
            <select
              className={inputClass + " w-24"}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Button disabled={!traineeId || assign.isPending || !a.stats.bankReady} onClick={() => assign.mutate()}>
            {assign.isPending ? "Assigning…" : "Assign sitting"}
          </Button>
        </div>
        {assign.error && <ErrorState error={assign.error} />}
        {availableTrainees.length === 0 && (
          <p className="text-xs text-[var(--ink-muted)]">
            All active trainees already have this assessment, or none exist.{" "}
            <Link to="/admin/trainees" className="text-coral underline">
              Create a trainee
            </Link>
            .
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--ink-muted)]">Assigned trainees</h2>
        {a.assignments.length === 0 && (
          <EmptyState title="Nobody assigned yet" body="Use the form above to send this sitting to a trainee." />
        )}
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
          {a.assignments.map((asg: any) => {
            const latest = asg.attempts[0];
            return (
              <li key={asg.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
                <div>
                  <Link to={`/admin/trainees/${asg.traineeId}`} className="font-medium hover:text-coral">
                    {asg.trainee.firstName} {asg.trainee.lastName}
                  </Link>
                  <div className="mt-1 text-xs text-[var(--ink-muted)]">
                    {asg.trainee.user.email} · expires {new Date(asg.expiresAt).toLocaleDateString()}
                  </div>
                  {latest && (
                    <div className="mt-1 text-xs">
                      Latest: {latest.status.replaceAll("_", " ")}
                      {latest.result && ` · ${latest.result.overallScore.toFixed(1)}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <AssignmentStatusBadge status={asg.status} />
                  {latest?.result && (
                    <Link to={`/admin/results/${latest.id}`} className="text-coral">
                      View result
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--ink-muted)]">Question pool (modules)</h2>
        <p className="text-sm text-[var(--ink-muted)]">Trainees only see approved questions from these modules.</p>
        <ul className="grid gap-2 md:grid-cols-2">
          {a.modules.map((m: any) => (
            <li key={m.moduleId}>
              <Link
                to={`/admin/question-bank/${m.moduleId}`}
                className="flex items-center justify-between rounded-xl border border-[var(--line)] px-4 py-3 hover:border-coral"
              >
                <span>
                  <ModuleBadge code={m.module.code} /> {m.module.name}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">{m.liveCount ?? 0} live</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ResultsPage() {
  const q = useQuery({ queryKey: ["results"], queryFn: () => api<any[]>("/api/admin/results") });
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-4xl">Results</h1>
      {q.data?.map((r) => {
        const passing = r.attempt?.assignment?.template?.passingScore ?? 70;
        const passed = r.overallScore >= passing;
        return (
          <Link key={r.id} to={`/admin/results/${r.attemptId}`} className="block rounded-2xl border border-[var(--line)] p-4 hover:border-coral">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {r.attempt.trainee.firstName} {r.attempt.trainee.lastName}
                </div>
                <div className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  {r.attempt?.assignment?.template?.name ?? "Assessment"} · {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="tabular text-sm">{r.overallScore.toFixed(1)} / 100</span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    passed
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {passed ? "PASS" : "FAIL"}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
      {q.data?.length === 0 && <EmptyState title="No results" body="Completed sittings will appear here." />}
    </div>
  );
}

export function ResultDetailPage() {
  const { attemptId } = useParams();
  const q = useQuery({ queryKey: ["result", attemptId], queryFn: () => api<any>(`/api/admin/results/${attemptId}`) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const r = q.data;
  const passing = r.attempt?.assignment?.template?.passingScore ?? 70;
  const passed = r.overallScore >= passing;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Recorded result</div>
          <h1 className="mt-1 font-serif text-4xl">
            {r.attempt.trainee.firstName} {r.attempt.trainee.lastName}
          </h1>
          <div className="mt-1 text-sm text-[var(--ink-muted)]">
            {r.attempt?.assignment?.template?.name ?? "Assessment"} · {new Date(r.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div
          className={`flex flex-col items-center rounded-2xl px-8 py-4 text-center ${
            passed ? "bg-emerald-500/15" : "bg-red-500/15"
          }`}
        >
          <div className={`text-3xl font-bold ${passed ? "text-emerald-400" : "text-red-400"}`}>
            {passed ? "PASS" : "FAIL"}
          </div>
          <div className="mt-1 text-sm font-semibold tabular">
            {r.overallScore.toFixed(1)} / 100
          </div>
          <div className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Threshold: {passing}%
          </div>
        </div>
      </header>
      <ResultProfile result={r} passingScore={passing} />
      <section>
        <h2 className="mb-2 text-sm text-[var(--ink-muted)]">Integrity timeline</h2>
        <ul className="space-y-1 text-xs">
          {r.attempt.integrityEvents.map((e: any) => (
            <li key={e.id} className="flex justify-between border-b border-[var(--line)] py-1">
              <span>{e.type}</span>
              <span>{new Date(e.serverTs).toLocaleString()}</span>
            </li>
          ))}
          {!r.attempt.integrityEvents.length && <li className="text-[var(--ink-muted)]">No integrity signals recorded.</li>}
        </ul>
      </section>
    </div>
  );
}

export function AnalyticsPage() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: () => api<any>("/api/admin/analytics") });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-8">
      <h1 className="font-serif text-4xl">Analytics</h1>
      <h2 className="text-sm text-[var(--ink-muted)]">Competency weakness</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {q.data.competencyWeakness.map((c: any) => (
          <li key={c.code} className="flex justify-between rounded-xl border border-[var(--line)] px-4 py-2 text-sm">
            <span>{c.competency}</span>
            <span className="tabular">{c.avgMastery.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <h2 className="text-sm text-[var(--ink-muted)]">Question quality flags</h2>
      <ul className="space-y-2 text-sm">
        {q.data.quality
          .filter((x: any) => x.qualityFlag)
          .map((x: any) => (
            <li key={x.id} className="rounded-xl border border-[var(--line)] px-4 py-2">
              {x.module} · p={x.p?.toFixed(2)} · {x.qualityFlag}
            </li>
          ))}
        {q.data.quality.filter((x: any) => x.qualityFlag).length === 0 && (
          <p className="text-[var(--ink-muted)]">No recalibration candidates yet (need usage).</p>
        )}
      </ul>
    </div>
  );
}

function formatGenerationError(error?: string | null) {
  if (!error) return null;
  if (error.trimStart().startsWith("[") && error.includes("invalid_type")) {
    return "The model returned questions in an unexpected format. Try again with a smaller count.";
  }
  if (/model did not return json|not valid json/i.test(error)) {
    return "The model response was not valid JSON. Try count 3 or retry in a minute.";
  }
  return error.length > 280 ? `${error.slice(0, 280)}…` : error;
}

export function AIControlPage() {
  const qc = useQueryClient();
  const [moduleId, setModuleId] = useState("");
  const [count, setCount] = useState(5);
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [sessionJobId, setSessionJobId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ moduleCode: string; count: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const q = useQuery({
    queryKey: ["ai"],
    queryFn: () => api<any>("/api/admin/ai"),
    refetchInterval: (query) => {
      if (!sessionJobId) return false;
      const row = query.state.data?.generations?.find((g: any) => g.id === sessionJobId);
      return row && (row.status === "QUEUED" || row.status === "RUNNING") ? 2000 : false;
    },
  });
  const modules = useQuery({ queryKey: ["modules"], queryFn: () => api<any[]>("/api/admin/modules") });

  const gens: any[] = q.data?.generations ?? [];
  const sessionJob = useMemo(
    () => (sessionJobId ? gens.find((g) => g.id === sessionJobId) : undefined),
    [gens, sessionJobId],
  );
  const jobBusy = sessionJob?.status === "QUEUED" || sessionJob?.status === "RUNNING";

  const gen = useMutation({
    mutationFn: () =>
      api<{ generationId: string; queued?: boolean; created?: number }>("/api/admin/questions/generate", {
        method: "POST",
        body: JSON.stringify({ moduleId, count, runCritic: true, provider }),
      }),
    onMutate: () => {
      const mod = modules.data?.find((m) => m.id === moduleId);
      setPending({ moduleCode: mod?.code ?? "module", count });
      setSessionJobId(null);
      setStartedAt(Date.now());
      setTick(0);
    },
    onSuccess: (data) => {
      setSessionJobId(data.generationId);
      void qc.invalidateQueries({ queryKey: ["ai"] });
    },
    onError: () => {
      setPending(null);
      setStartedAt(null);
    },
  });

  const busy = gen.isPending || jobBusy;
  const bannerModule = sessionJob?.module?.code ?? pending?.moduleCode;
  const bannerCount = sessionJob?.requestedCount ?? pending?.count ?? count;
  const elapsed = useMemo(() => {
    if (!busy || !startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }, [busy, startedAt, tick]);

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (sessionJob?.status === "SUCCEEDED") {
      setPending(null);
      void qc.invalidateQueries({ queryKey: ["modules"] });
    }
    if (sessionJob?.status === "FAILED") setPending(null);
  }, [sessionJob?.id, sessionJob?.status, qc]);

  if (q.isLoading) return <Skeleton className="h-40" />;
  const t = q.data?.totals ?? {};
  return (
    <div className="space-y-8">
      <h1 className="font-serif text-4xl">AI control center</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="AI calls" value={t.calls ?? 0} />
        <MetricCard label="Generated" value={t.questionsGenerated ?? 0} />
        <MetricCard label="Rejected" value={t.questionsRejected ?? 0} />
        <MetricCard label="Est. cost" value={`$${Number(t.estimatedCostUsd ?? 0).toFixed(2)}`} />
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          gen.mutate();
        }}
      >
        <Field label="Provider">
          <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value as "openai" | "anthropic")}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </Field>
        <Field label="Module">
          <select className={inputClass} value={moduleId} onChange={(e) => setModuleId(e.target.value)} required>
            <option value="">Select</option>
            {modules.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Count">
          <input className={inputClass} type="number" min={1} max={25} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </Field>
        <Button disabled={busy || !moduleId}>{busy ? "Generating…" : "Generate question set"}</Button>
      </form>
      {gen.error && <ErrorState error={gen.error} />}
      {busy && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 px-4 py-3 text-sm">
          Generating {bannerCount} items for {bannerModule}… {elapsed}s elapsed. Drafts land in the question bank when
          this finishes (typically 30–90 seconds).
        </div>
      )}
      {sessionJob?.status === "SUCCEEDED" && !busy && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 px-4 py-3 text-sm">
          <strong>{sessionJob.module?.code ?? "Module"} is now New</strong> — {sessionJob.requestedCount} draft
          {(sessionJob.requestedCount ?? 0) === 1 ? "" : "s"} ready for review. Open the{" "}
          <Link className="text-coral underline" to={`/admin/question-bank/${sessionJob.moduleId}`}>
            question bank
          </Link>{" "}
          to approve them. Once all drafts are handled, the module will show <strong>Updated</strong>.
        </div>
      )}
      {sessionJob?.status === "FAILED" && !busy && (
        <ErrorState error={new Error(formatGenerationError(sessionJob.error) || "Generation failed")} />
      )}
      <p className="text-xs text-[var(--ink-muted)]">
        Set OPENAI_API_KEY (default) or ANTHROPIC_API_KEY in the server environment. Auto-approve is disabled. Items land as
        DRAFT / AI_VALIDATED for human review.
      </p>
      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--ink-muted)]">Recent generations</h2>
        {gens.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No generation jobs yet.</p>}
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
          {gens.slice(0, 20).map((g: any) => {
            const isActive = g.id === sessionJobId && jobBusy;
            const statusClass =
              g.status === "SUCCEEDED"
                ? "text-emerald-400"
                : g.status === "FAILED"
                  ? "text-red-400"
                  : g.status === "RUNNING" || g.status === "QUEUED"
                    ? "text-coral"
                    : "text-[var(--ink-muted)]";
            return (
              <li
                key={g.id}
                className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${isActive ? "bg-coral/5" : ""}`}
              >
                <div>
                  <span className="font-medium">{g.module?.code ?? g.moduleId}</span>
                  <span className="text-[var(--ink-muted)]"> · {g.requestedCount} requested · </span>
                  <span className={statusClass}>{g.status}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
                  <span>{new Date(g.createdAt).toLocaleString()}</span>
                  <Link className="text-coral" to={`/admin/question-bank/${g.moduleId}`}>
                    Open bank
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function AuditPage() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<any[]>("/api/admin/audit") });
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-4xl">Audit</h1>
      <ul className="space-y-1 text-sm">
        {q.data?.map((a) => (
          <li key={a.id} className="flex justify-between border-b border-[var(--line)] py-2">
            <span>
              {a.action} · {a.resourceType}
            </span>
            <span className="text-[var(--ink-muted)]">
              {a.actor?.email} · {new Date(a.createdAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProfilePage() {
  const { data } = useQuery({ queryKey: ["profile"], queryFn: () => api<any>("/api/profile") });
  return (
    <div className="mx-auto max-w-lg space-y-4 p-10">
      <h1 className="font-serif text-4xl">Profile</h1>
      <p className="text-sm">{data?.email}</p>
      <p className="text-sm text-[var(--ink-muted)]">{data?.role}</p>
      {data?.trainee && <LevelBadge level={data.trainee.assignedLevel} />}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  ASSESSMENT_MANAGER: "Assessment manager",
  REVIEWER: "Reviewer",
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-violet-500/15 text-violet-400",
  ADMIN: "bg-coral/15 text-coral",
  ASSESSMENT_MANAGER: "bg-amber-500/15 text-amber-400",
  REVIEWER: "bg-sky-500/15 text-sky-400",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[role] ?? "bg-[var(--bg-muted)] text-[var(--ink-muted)]"}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: "", password: "", role: "ADMIN" });
  const [created, setCreated] = useState<{ username: string; role: string } | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-users"] });
      setCreated({ username: form.username, role: form.role });
    },
  });
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--bg-elev)] p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (created) { onClose(); return; }
          mut.mutate();
        }}
      >
        <h2 className="font-serif text-2xl">Create user</h2>
        {created ? (
          <div className="space-y-3 text-sm">
            <p>User <strong>{created.username}</strong> created as <RoleBadge role={created.role} />.</p>
            <div className="rounded-xl bg-[var(--bg-muted)] p-4 font-mono text-xs space-y-1">
              <div><span className="text-[var(--ink-muted)]">Username  </span><strong>{created.username}</strong></div>
              <div><span className="text-[var(--ink-muted)]">Password  </span><strong>the value you set</strong></div>
            </div>
            <p className="text-[var(--ink-muted)]">They sign in at /login using their username.</p>
            <div className="flex justify-end"><Button type="submit">Done</Button></div>
          </div>
        ) : (
          <>
            <Field label="Username">
              <input
                className={inputClass}
                required
                placeholder="e.g. jane.smith"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") })}
              />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="ADMIN">Admin</option>
                <option value="ASSESSMENT_MANAGER">Assessment manager</option>
                <option value="REVIEWER">Reviewer</option>
              </select>
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <p className="text-[11px] text-[var(--ink-muted)]">At least 12 characters with upper, lower, number, and symbol.</p>
            {mut.error && <ErrorState error={mut.error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Create user"}</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["staff-users"], queryFn: () => api<any[]>("/api/admin/users") });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-users"] });
      setDeleting(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-4xl">Users</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Staff accounts with admin access. Trainees are managed separately.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Create user</Button>
      </div>

      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg-muted)] text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <tr>
                {["Username", "Role", "Last login", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((u: any) => {
                const username = u.email.endsWith("@seal.local") ? u.email.replace("@seal.local", "") : u.email;
                const isSelf = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-t border-[var(--line)] hover:bg-[var(--bg-muted)]/50">
                    <td className="px-4 py-3 font-mono">{username}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-[var(--ink-muted)]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${u.isActive ? "text-emerald-400" : "text-[var(--ink-muted)]"}`}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        deleting === u.id ? (
                          <div className="flex items-center justify-end gap-2 text-xs">
                            <span className="text-[var(--ink-muted)]">Delete?</span>
                            <button
                              className="rounded px-2 py-0.5 bg-red-500/15 text-red-400 hover:bg-red-500/30"
                              onClick={() => del.mutate(u.id)}
                              disabled={del.isPending}
                            >
                              Confirm
                            </button>
                            <button
                              className="rounded px-2 py-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                              onClick={() => setDeleting(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="text-xs text-[var(--ink-muted)] hover:text-red-400"
                            onClick={() => setDeleting(u.id)}
                          >
                            Delete
                          </button>
                        )
                      )}
                      {isSelf && <span className="text-xs text-[var(--ink-muted)]">You</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {q.data.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">No staff users yet.</div>
          )}
        </div>
      )}
      {open && <CreateUserModal onClose={() => setOpen(false)} />}
    </div>
  );
}
