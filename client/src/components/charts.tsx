import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export function CompetencyRadar({
  data,
}: {
  data: { name: string; mastery: number }[];
}) {
  const rows = data.slice(0, 8);
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <RadarChart data={rows}>
          <PolarGrid stroke="currentColor" className="text-[var(--line)]" />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 11, fill: "currentColor" }} />
          <Radar dataKey="mastery" stroke="#d97757" fill="#d97757" fillOpacity={0.2} />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ModuleHeatmap({
  data,
}: {
  data: { code: string; name: string; score: number }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {data.map((m) => {
        const opacity = Math.max(0.12, m.score / 100);
        return (
          <div
            key={m.code}
            className="rounded-xl p-3"
            style={{ background: `rgba(217,119,87,${opacity})` }}
            title={m.name}
          >
            <div className="font-mono text-[11px]">{m.code}</div>
            <div className="mt-1 text-lg tabular">{m.score.toFixed(0)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function CompetencyGraph({
  nodes,
}: {
  nodes: { id: string; name: string; mastery: number; confidence: number; questionsSeen: number }[];
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-muted)]/40 p-6">
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-8">
        {nodes.map((n) => {
          // bubble diameter: 72–100px based on confidence
          const size = Math.round(72 + Math.min(n.confidence, 1) * 28);
          const score = Math.round(n.mastery);
          const scoreColor =
            score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f87171";
          return (
            <div
              key={n.id}
              className="flex flex-col items-center gap-2"
              title={`${n.name} · ${n.questionsSeen} question${n.questionsSeen === 1 ? "" : "s"} seen`}
            >
              {/* Circle — score only, no text overflow */}
              <div
                className="flex shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-elev)] shadow-[var(--shadow)] transition hover:border-coral"
                style={{ width: size, height: size }}
              >
                <span
                  className="font-serif font-bold tabular leading-none"
                  style={{ fontSize: Math.round(size * 0.32), color: scoreColor }}
                >
                  {score}
                </span>
              </div>
              {/* Label below — always visible, never clipped */}
              <div className="w-20 text-center text-[10px] leading-tight text-[var(--ink-muted)]">
                {n.name}
              </div>
              {/* Questions-seen chip */}
              <div className="text-[9px] text-[var(--ink-muted)] opacity-60">
                {n.questionsSeen}q
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
