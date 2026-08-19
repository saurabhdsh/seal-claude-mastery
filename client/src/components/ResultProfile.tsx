import { CompetencyGraph, CompetencyRadar, ModuleHeatmap } from "./charts";
import { MetricCard } from "./ui";
import { ScoreGauge } from "./media";

export function ResultProfile({ result, passingScore }: { result: any; passingScore?: number }) {
  const n = result.narrative ?? {};
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-10">
        <ScoreGauge score={result.overallScore} />
        <div>
          <h2 className="font-serif text-5xl">{result.proficiencyBand.replaceAll("_", " ")}</h2>
          {passingScore != null && (
            <div className="mt-2">
              {result.overallScore >= passingScore ? (
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-400">PASS</span>
              ) : (
                <span className="rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-400">FAIL</span>
              )}
              <span className="ml-2 text-xs text-[var(--ink-muted)]">passing threshold {passingScore}%</span>
            </div>
          )}
          <p className="mt-3 max-w-xl text-sm leading-7">{n.executiveSummary}</p>
          {result.levelMastery?.answered != null && result.levelMastery?.items != null && (
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Answered {result.levelMastery.answered} of {result.levelMastery.items} items
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Confidence" value={`${Math.round(result.confidence * 100)}%`} />
        <MetricCard label="Claude Code" value={result.claudeCodeScore.toFixed(0)} />
        <MetricCard label="Security" value={result.securityScore.toFixed(0)} />
        <MetricCard label="Architecture" value={result.architectureScore.toFixed(0)} />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <CompetencyRadar
          data={(result.competencies ?? []).map((c: any) => ({ name: c.competency.name, mastery: c.mastery }))}
        />
        <ModuleHeatmap
          data={(result.modules ?? []).map((m: any) => ({ code: m.module.code, name: m.module.name, score: m.score }))}
        />
      </div>
      <div>
        <div className="mb-3">
          <h3 className="text-sm font-medium">Competency constellation</h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Each bubble is one of the SEAL competency frameworks (F01–F09). The <strong>number inside</strong> is the mastery
            score (0–100) for that competency based on the questions answered. <strong>Bubble size</strong> reflects the model's
            confidence — wider bubbles mean more questions were seen in that area, giving a stronger signal. Hover a bubble to
            see question count.
          </p>
        </div>
        <CompetencyGraph
          nodes={(result.competencies ?? []).map((c: any) => ({
            id: c.competencyId,
            name: c.competency.name,
            mastery: c.mastery,
            confidence: c.confidence,
            questionsSeen: c.questionsSeen,
          }))}
        />
        {(result.competencies ?? []).length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 md:grid-cols-4">
            {(result.competencies ?? []).map((c: any) => {
              const score = Math.round(c.mastery);
              const strong = score >= 70;
              return (
                <div
                  key={c.competencyId}
                  className="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2"
                >
                  <span className="font-mono text-[var(--ink-muted)]">{c.competency.name}</span>
                  <span className={`ml-2 font-semibold tabular ${strong ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400"}`}>
                    {score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm text-[var(--ink-muted)]">Strengths</h3>
          <ul className="mt-2 list-disc pl-5 text-sm leading-7">
            {(n.strengths ?? []).map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm text-[var(--ink-muted)]">Development</h3>
          <ul className="mt-2 list-disc pl-5 text-sm leading-7">
            {(n.gaps ?? []).map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
