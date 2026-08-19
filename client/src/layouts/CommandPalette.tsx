import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const search = useQuery({
    queryKey: ["search", q],
    queryFn: () =>
      api<{ trainees: { id: string; firstName: string; lastName: string }[]; modules: { id: string; code: string; name: string }[]; assessments: { id: string; name: string }[] }>(
        `/api/admin/search?q=${encodeURIComponent(q)}`,
      ),
    enabled: open && q.length >= 2,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const go = (path: string) => {
    setOpen(false);
    setQ("");
    nav(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-28" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--bg-elev)] p-3 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search candidates, modules, assessments…"
          className="w-full rounded-xl bg-[var(--bg-muted)] px-4 py-3 text-sm outline-none"
        />
        <div className="mt-3 space-y-1 text-sm">
          <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go("/admin/trainees")}>
            Create trainee
          </button>
          <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go("/admin/assessments/create")}>
            Create assessment
          </button>
          <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go("/admin/ai-control-center")}>
            Generate questions / AI control center
          </button>
          <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go("/admin/results")}>
            Open results
          </button>
          {search.data?.trainees.map((t) => (
            <button key={t.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go(`/admin/trainees/${t.id}`)}>
              Candidate {t.firstName} {t.lastName}
            </button>
          ))}
          {search.data?.modules.map((m) => (
            <button key={m.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-muted)]" onClick={() => go(`/admin/question-bank/${m.id}`)}>
              Module {m.code} {m.name}
            </button>
          ))}
        </div>
        <div className="mt-2 px-3 pb-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">⌘K</div>
      </div>
    </div>
  );
}
