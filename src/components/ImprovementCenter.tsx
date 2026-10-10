import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  comparison,
  metricLabels,
  performance,
  rollingPerformance,
  winInterval,
  type FocusMetric,
} from "../core/coaching";
import {
  heroSummaries,
  gameModeName,
  outcome,
  type Match,
  type Hero,
} from "../core/api";
import type { Settings } from "../core/schema";
export type Research = Settings["playerResearch"][string];
export const emptyResearch: Research = {
  ratingHistory: [],
  expectedTotal: null,
  notes: [],
  goal: null,
};
const n = (v: number | null, d = 1) =>
  v === null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d });
export function ImprovementCenter({
  matches,
  allMatches = matches,
  heroes,
  heroFilter,
  research,
  onSave,
}: {
  matches: Match[];
  allMatches?: Match[];
  heroes: Hero[];
  heroFilter: string;
  research: Research;
  onSave: (r: Research) => Promise<void>;
}) {
  const modes = [
    ...new Set(
      matches
        .map((m) => m.game_mode)
        .filter((v): v is number => v !== null && v !== undefined),
    ),
  ];
  const [analysisMode, setAnalysisMode] = useState(1),
    [metric, setMetric] = useState<FocusMetric>("deaths"),
    [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const chosen = modes.includes(analysisMode) ? analysisMode : (modes[0] ?? 1);
  const scoped = useMemo(
    () => matches.filter((m) => m.game_mode === chosen),
    [matches, chosen],
  );
  const trend = useMemo(() => comparison(scoped), [scoped]);
  const regression = (["deaths", "combat", "farm"] as FocusMetric[])
    .flatMap((key) => {
      const recent = trend.recent[key],
        previous = trend.previous[key];
      if (
        recent.count < 5 ||
        previous.count < 5 ||
        recent.value === null ||
        previous.value === null ||
        previous.value === 0
      )
        return [];
      const adverse =
        ((recent.value - previous.value) / previous.value) *
        (key === "deaths" ? 1 : -1);
      return adverse >= 0.1
        ? [{ key, adverse, count: recent.count, previousCount: previous.count }]
        : [];
    })
    .sort((a, b) => b.adverse - a.adverse)[0];
  const rolling = useMemo(() => rollingPerformance(scoped), [scoped]);
  const strengths = heroSummaries(trend.matches)
    .map((h) => ({
      ...h,
      rates: performance(trend.matches.filter((m) => m.hero_id === h.heroId)),
      interval: winInterval(h.wins, h.losses),
    }))
    .sort((a, b) => b.wins + b.losses - a.wins - a.losses);
  const baseline = performance(trend.latest)[metric];
  const goal = research.goal;
  const goalMatches = goal
    ? allMatches
        .filter(
          (m) =>
            m.start_time * 1000 > goal.createdAt &&
            m.match_id > goal.anchor &&
            m.game_mode === goal.mode &&
            (goal.hero === "all" || String(m.hero_id) === goal.hero) &&
            outcome(m) !== "unscored",
        )
        .sort((a, b) => a.start_time - b.start_time)
        .slice(0, 10)
    : [];
  const progress = goal ? performance(goalMatches)[goal.metric] : null;
  const save = async (next: Research) => {
    setSaving(true);
    setError("");
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your goal.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel improvement-center">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR NEXT TEN GAMES</span>
          <h2>Improvement plan</h2>
          <p>Pick one focus and measure it across your next ten games.</p>
        </div>
        <label>
          Analysis mode
          <select
            aria-label="Improvement analysis mode"
            value={chosen}
            onChange={(e) => setAnalysisMode(Number(e.target.value))}
          >
            {(modes.length ? modes : [1]).map((m) => (
              <option key={m} value={m}>
                {gameModeName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        {gameModeName(chosen)} only · current hero/time filters apply ·{" "}
        {trend.matches.length} scored matches. Compare the same hero for a
        clearer trend.
      </p>
      <div className="review-focus">
        {regression ? (
          <>
            <strong>
              Suggested review focus: {metricLabels[regression.key]}
            </strong>
            <p>
              {n(regression.adverse * 100)}% worse across {regression.count}{" "}
              recent versus {regression.previousCount} previous measured games.
              Review one decision behind this trend.
            </p>
            <button
              className="button secondary small"
              onClick={() => {
                setMetric(regression.key);
                setTarget("");
              }}
            >
              Use this goal focus
            </button>
          </>
        ) : (
          <>
            <strong>
              {trend.window < 5
                ? "Build a stronger baseline"
                : "Choose one decision to practise"}
            </strong>
            <p>
              {trend.window < 5
                ? "At least ten scored games are needed for two five-game windows. Start with a death review and a short decision note."
                : "No clear regression of 10% or more. Keep your current focus and collect more games."}
            </p>
          </>
        )}
      </div>
      <div className="trend-grid" aria-label="Recent performance trends">
        {(["deaths", "combat", "farm", "economy"] as const).map((key) => {
          const a = trend.recent[key],
            b = trend.previous[key];
          const enough =
            a.count >= 5 &&
            b.count >= 5 &&
            a.value !== null &&
            b.value !== null;
          const delta = enough ? a.value! - b.value! : null;
          const improving =
            delta !== null && (key === "deaths" ? delta < 0 : delta > 0);
          const label =
            key === "economy" ? "Final net worth / min" : metricLabels[key];
          return (
            <article className="trend-card" key={key} data-metric={key}>
              <span className="card-label">{label}</span>
              <div className="trend-value">
                <strong>{n(a.value, key === "economy" ? 0 : 1)}</strong>
                <span>previous {n(b.value, key === "economy" ? 0 : 1)}</span>
              </div>
              <p className={improving ? "positive" : "muted"}>
                {delta === null
                  ? "Need five measured games in each window."
                  : Math.abs(delta) < (key === "economy" ? 0.5 : 0.05)
                    ? "Holding steady"
                    : `${n(Math.abs(delta), key === "economy" ? 0 : 1)} ${delta < 0 ? "less" : "more"} · ${improving ? "improving" : "review this pattern"}`}
              </p>
              {rolling.length > 1 && (
                <div
                  className="trend-canvas"
                  role="img"
                  aria-label={`${label} rolling trend`}
                >
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart
                      data={rolling.slice(-40)}
                      margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="#d7c6a322"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="label"
                        minTickGap={50}
                        stroke="#a3ada4"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        width={42}
                        stroke="#a3ada4"
                        tick={{ fontSize: 10 }}
                        domain={[0, "auto"]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#122321",
                          border: "1px solid #d7c6a344",
                        }}
                        formatter={(value) => [
                          n(Number(value), key === "economy" ? 0 : 1),
                          label,
                        ]}
                      />
                      <Line
                        dataKey={key}
                        stroke={
                          key === "deaths"
                            ? "#d9937e"
                            : key === "combat"
                              ? "#bca0e2"
                              : key === "farm"
                                ? "#b4ce98"
                                : "#dfb578"
                        }
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <small>
                Recent {a.count} vs previous {b.count} measured games ·{" "}
                {key === "deaths" ? "lower" : "higher"} is better.
              </small>
              {key === "economy" && (
                <small>
                  Final wealth ÷ duration; not earned souls per minute.
                </small>
              )}
            </article>
          );
        })}
      </div>
      <p className="muted trend-method">
        Lines show duration-weighted rolling rates across up to ten scored
        games. A point needs five measured games; gaps mean missing data. Window
        comparisons use equal, separate groups of games.
      </p>
      <div className="goal-panel">
        <h3>One focus, measurable progress</h3>
        {goal && (
          <p>
            Active goal: {metricLabels[goal.metric]}{" "}
            {goal.metric === "deaths" ? "at most" : "at least"}{" "}
            <strong>{n(goal.target)}</strong> · baseline {n(goal.baseline)} ·{" "}
            {gameModeName(goal.mode)} ·{" "}
            {goal.hero === "all"
              ? "all heroes"
              : (heroes.find((h) => String(h.id) === goal.hero)?.name ??
                `Hero ${goal.hero}`)}
            . New scored games since setting the goal: {goalMatches.length}/10;
            current rate {n(progress?.value ?? null)} across{" "}
            {progress?.count ?? 0} measured games.{" "}
            {progress && progress.count >= 5 && progress.value !== null
              ? (
                  goal.metric === "deaths"
                    ? progress.value <= goal.target
                    : progress.value >= goal.target
                )
                ? "Currently meeting the target."
                : "Keep reviewing the specific pattern you chose."
              : "Build at least five measured games before judging progress."}
          </p>
        )}
        <div className="history-controls">
          <label>
            Focus
            <select
              aria-label="Improvement goal metric"
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value as FocusMetric);
                setTarget("");
              }}
            >
              {Object.entries(metricLabels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target rate
            <input
              aria-label="Improvement target rate"
              type="number"
              min="0"
              max="10000"
              step="0.1"
              value={target}
              placeholder={
                baseline.value === null
                  ? "Need more games"
                  : n(baseline.value * (metric === "deaths" ? 0.9 : 1.1))
              }
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            disabled={
              saving ||
              baseline.count < 5 ||
              baseline.value === null ||
              !trend.latest.length
            }
            onClick={() => {
              const value = target.trim()
                ? Number(target)
                : baseline.value! * (metric === "deaths" ? 0.9 : 1.1);
              if (!Number.isFinite(value) || value < 0 || value > 10000) {
                setError("Enter a target between 0 and 10000.");
                return;
              }
              void save({
                ...research,
                goal: {
                  metric,
                  target: Math.round(value * 10) / 10,
                  baseline: baseline.value!,
                  anchor: Math.max(...matches.map((m) => m.match_id)),
                  hero: heroFilter,
                  mode: chosen,
                  createdAt: Date.now(),
                },
              });
            }}
          >
            Track next 10 games
          </button>
          {goal && (
            <button
              className="button secondary small"
              disabled={saving}
              onClick={() => void save({ ...research, goal: null })}
            >
              Clear goal
            </button>
          )}
        </div>
        <small>
          Targets are personal experiments, not universal benchmarks. The
          suggested adjustment is 10%; edit it to suit your role. Goals persist
          across launches; importing older games does not count as new progress.
        </small>
        {error && <p role="alert">{error}</p>}
      </div>
      <details className="trend-evidence">
        <summary>Hero evidence & win-rate uncertainty</summary>
        <h3>Hero evidence</h3>
        <p>
          Scored win rate with a 95% Wilson interval. A wide interval or fewer
          than ten scored games is limited evidence; this is not a tier list.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hero</th>
                <th>Scored games</th>
                <th>Win rate</th>
                <th>95% interval</th>
                <th>Deaths / 10 min</th>
                <th>Kills + assists / 10 min</th>
                <th>Last hits / min</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {strengths.slice(0, 8).map((h) => (
                <tr key={h.heroId}>
                  <td>
                    {heroes.find((hero) => hero.id === h.heroId)?.name ??
                      `Hero ${h.heroId}`}
                  </td>
                  <td>{h.wins + h.losses}</td>
                  <td>{n(h.winRate)}%</td>
                  <td>
                    {h.interval
                      ? `${n(h.interval.low)}–${n(h.interval.high)}%`
                      : "—"}
                  </td>
                  <td>{n(h.rates.deaths.value)}</td>
                  <td>{n(h.rates.combat.value)}</td>
                  <td>{n(h.rates.farm.value)}</td>
                  <td>
                    {h.wins + h.losses < 10
                      ? "Small sample"
                      : "Worth reviewing alongside role and patch"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
