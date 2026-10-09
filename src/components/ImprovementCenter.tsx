import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
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
const actions = {
  deaths:
    "Review your last three deaths: note the information you had, your escape route and whether the fight was needed. Choose one avoidable pattern to address next game.",
  combat:
    "Review fights where you arrived late or had no impact. Look for one opportunity to coordinate an arrival with a teammate; this rate alone cannot judge your role.",
  farm: "Review gaps between waves and rotations. Plan your next resource route before leaving lane, and avoid abandoning reachable farm for uncertain fights.",
};
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
          <p>
            Balanced review of survival, combat, farming and hero results.
            Comparisons use your own scored games, not an inferred skill rating.
          </p>
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
        {trend.matches.length} scored matches. Modes are kept separate. Hero
        composition, patch changes and opponents can affect trends.
      </p>
      <div className="review-focus">
        {regression ? (
          <>
            <strong>
              Suggested review focus: {metricLabels[regression.key]}
            </strong>
            <p>
              {n(regression.adverse * 100)}% adverse change across{" "}
              {regression.count} recent versus {regression.previousCount}{" "}
              previous measured games. This selects the largest relative
              regression of the three measured rates; it is a review prompt, not
              proof of its cause.
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
                : "No measured rate shows a relative regression of at least 10% with adequate samples. Keep one measurable focus instead of drawing conclusions from small fluctuations."}
            </p>
          </>
        )}
      </div>
      <div className="coaching-grid">
        {(["deaths", "combat", "farm"] as FocusMetric[]).map((key) => {
          const a = trend.recent[key],
            b = trend.previous[key],
            enough = a.count >= 5 && b.count >= 5;
          const delta =
            enough && a.value !== null && b.value !== null
              ? a.value - b.value
              : null;
          const improving =
            delta !== null && (key === "deaths" ? delta < 0 : delta > 0);
          return (
            <article className="coaching-card" key={key}>
              <span className="card-label">{metricLabels[key]}</span>
              <strong>{n(a.value)}</strong>
              <small>
                Recent {a.count} measured games · previous {n(b.value)} across{" "}
                {b.count}
              </small>
              <p
                className={
                  delta === null ? "muted" : improving ? "positive" : "muted"
                }
              >
                {delta === null
                  ? "Need at least five measured games in each comparison window."
                  : `${delta > 0.05 ? "+" : ""}${n(Math.abs(delta) < 0.05 ? 0 : delta)} versus the previous equal window; ${Math.abs(delta) < 0.05 ? "essentially unchanged" : improving ? "moving in the intended direction" : "a pattern to review"}.`}
              </p>
              <p>{actions[key]}</p>
            </article>
          );
        })}
        <article className="coaching-card">
          <span className="card-label">RESULTS & ECONOMY</span>
          <strong>{n(trend.recent.winRate)}%</strong>
          <small>
            {trend.recent.scored} recent scored games · previous{" "}
            {n(trend.previous.winRate)}%
          </small>
          <p>
            {n(trend.recent.economy.value, 0)} final net worth / min across{" "}
            {trend.recent.economy.count} games. This is final wealth divided by
            duration, not earned souls per minute.
          </p>
          <p>
            Use outcomes alongside survival and resource trends. Winning more or
            recording higher KDA alone does not show which decisions improved.
          </p>
        </article>
      </div>
      {rolling.length > 1 && (
        <div className="chart-panel">
          <h3>Rolling form</h3>
          <p>
            Up to ten scored games per point, with at least five. Rates are
            weighted by match duration.
          </p>
          <div
            className="chart-canvas"
            role="img"
            aria-label="Rolling survival combat and farming trends"
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rolling}>
                <CartesianGrid stroke="#30313c" strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={50} stroke="#9594a7" />
                <YAxis yAxisId="combat" stroke="#9594a7" />
                <YAxis yAxisId="farm" orientation="right" stroke="#9594a7" />
                <Tooltip
                  contentStyle={{
                    background: "#191a22",
                    border: "1px solid #34323f",
                  }}
                />
                <Legend />
                <Line
                  yAxisId="combat"
                  dataKey="deaths"
                  name="Deaths / 10 min"
                  stroke="#ee9296"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="combat"
                  dataKey="combat"
                  name="Kills + assists / 10 min"
                  stroke="#b69ddf"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="farm"
                  dataKey="farm"
                  name="Last hits / min"
                  stroke="#dcb06d"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
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
    </section>
  );
}
