import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../stores/auth";
import { Button, ErrorState, LevelBadge, Skeleton } from "../components/ui";
import { DRILLS, checksFor, starterFor, studioFor, type Studio } from "../playground/studio";

type ModuleRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  level: string;
  domain: string;
  objectives: string[];
};

const LEVELS = ["FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"] as const;

const STUDIO_LABEL: Record<Studio, string> = {
  prompt: "Prompt studio",
  agent: "Agent builder",
  schema: "Tool schema",
  code: "Code bench",
  design: "Capstone desk",
};

export function PlaygroundPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["playground-catalog"], queryFn: () => api<{ modules: ModuleRow[] }>("/api/playground/catalog") });
  const work = useQuery({
    queryKey: ["playground-work"],
    queryFn: () => api<{ drafts: Record<string, string>; completed: string[] }>("/api/playground/work"),
  });
  const [code, setCode] = useState<string>("drill-injection");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [drillPick, setDrillPick] = useState<Record<string, number | null>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!work.data || hydrated) return;
    setDrafts(work.data.drafts ?? {});
    setCompleted(work.data.completed ?? []);
    setHydrated(true);
  }, [work.data, hydrated]);

  const save = useMutation({
    mutationFn: (body: { drafts: Record<string, string>; completed: string[] }) =>
      api("/api/playground/work", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playground-work"] }),
  });

  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => save.mutate({ drafts, completed }), 700);
    return () => window.clearTimeout(t);
  }, [drafts, completed, hydrated]);

  const modules = catalog.data?.modules ?? [];
  const selected = modules.find((m) => m.code === code);
  const drill = DRILLS.find((d) => d.id === code);
  const studio: Studio = selected ? studioFor(selected.code, selected.level) : "design";
  const text = drafts[code] ?? (selected ? starterFor(studio, selected.name) : "");
  const checks = selected ? checksFor(studio, text, selected.objectives ?? []) : [];
  const ready = checks.length > 0 && checks.every((c) => c.ok);
  const doneCount = completed.length;
  const total = modules.length + DRILLS.length;

  const grouped = useMemo(() => {
    return LEVELS.map((level) => ({ level, items: modules.filter((m) => m.level === level) }));
  }, [modules]);

  if (catalog.isLoading || work.isLoading) return <Skeleton className="m-10 h-64" />;
  if (catalog.error) return <div className="p-10"><ErrorState error={catalog.error} /></div>;

  return (
    <div className="app-bg min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">SEAL · Playground</div>
            <h1 className="mt-1 font-serif text-4xl">Practice the whole curriculum</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
              {user?.trainee?.firstName}, build prompts, agents, tool schemas, and the capstone. Checks run as you type. This does not score your assessment.
            </p>
          </div>
          <div className="text-right">
            <div className="font-serif text-3xl tabular">{doneCount}<span className="text-lg text-[var(--ink-muted)]">/{total}</span></div>
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">stations practiced</div>
            <Link to="/assessment" className="mt-3 inline-block text-sm text-coral">Back to home</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <section>
            <h2 className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Incident drills</h2>
            <ul className="mt-2 space-y-1">
              {DRILLS.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setCode(d.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm ${code === d.id ? "bg-[#1d1d1f] text-white" : "hover:bg-white"}`}
                  >
                    {completed.includes(d.id) ? "● " : ""}{d.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {grouped.map((group) => (
            <section key={group.level}>
              <h2 className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{group.level}</h2>
              <ul className="mt-2 space-y-1">
                {group.items.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCode(m.code);
                        setDrafts((prev) => prev[m.code] ? prev : { ...prev, [m.code]: starterFor(studioFor(m.code, m.level), m.name) });
                      }}
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm ${code === m.code ? "bg-[#1d1d1f] text-white" : "hover:bg-white"}`}
                    >
                      <span className="font-mono text-[11px] opacity-70">{m.code}</span> {m.name}
                      {completed.includes(m.code) ? " ●" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </aside>

        <main className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
          {drill && (
            <div className="space-y-5">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Drill</div>
              <h2 className="font-serif text-3xl">{drill.title}</h2>
              <p className="text-sm leading-7">{drill.prompt}</p>
              <div className="space-y-2">
                {drill.options.map((option, i) => {
                  const picked = drillPick[drill.id];
                  const show = picked != null;
                  const mine = picked === i;
                  const right = i === drill.answer;
                  const tone = !show ? "border-[var(--line)]" : right ? "border-emerald-500 bg-emerald-50" : mine ? "border-red-400 bg-red-50" : "border-[var(--line)] opacity-70";
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`block w-full rounded-2xl border px-4 py-3 text-left text-sm leading-6 ${tone}`}
                      onClick={() => {
                        setDrillPick((prev) => ({ ...prev, [drill.id]: i }));
                        if (i === drill.answer) setCompleted((prev) => (prev.includes(drill.id) ? prev : [...prev, drill.id]));
                      }}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              {drillPick[drill.id] != null && <p className="text-sm leading-6 text-[var(--ink-muted)]">{drill.why}</p>}
            </div>
          )}

          {selected && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <LevelBadge level={selected.level} />
                <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{STUDIO_LABEL[studio]}</span>
                <span className="text-sm text-[var(--ink-muted)]">{selected.domain}</span>
              </div>
              <h2 className="font-serif text-3xl">{selected.code} · {selected.name}</h2>
              <p className="text-sm leading-7 text-[var(--ink-muted)]">{selected.description}</p>
              <ul className="grid gap-2 text-sm md:grid-cols-2">
                {checks.map((c) => (
                  <li key={c.id} className={`rounded-xl border px-3 py-2 ${c.ok ? "border-emerald-500/40 bg-emerald-50" : "border-[var(--line)]"}`}>
                    {c.ok ? "●" : "○"} {c.label}
                  </li>
                ))}
              </ul>
              <textarea
                className="min-h-72 w-full rounded-2xl border border-[var(--line)] bg-[#fafafa] p-4 font-mono text-[13px] leading-6 outline-none focus:border-[#0071e3]"
                value={text}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [code]: e.target.value }))}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={!ready}
                  onClick={() => setCompleted((prev) => (prev.includes(selected.code) ? prev : [...prev, selected.code]))}
                >
                  {completed.includes(selected.code) ? "Practiced" : "Mark practiced"}
                </Button>
                <span className="text-xs text-[var(--ink-muted)]">{save.isPending ? "Saving…" : "Saved on your account"}</span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
