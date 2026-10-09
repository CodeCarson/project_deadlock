import { useEffect, useRef, useState } from "react";
import { type Match, type Hero, gameModeName } from "../core/api";
import {
  rateHistory,
  recentRatedScope,
  MODEL_VERSION,
  type Evidence,
} from "../core/performance";
import { loadEvidence } from "./evidence";
import type { Research } from "./ImprovementCenter";
export function PerformanceRating({
  matches,
  heroes,
  research,
  onSave,
}: {
  matches: Match[];
  heroes: Hero[];
  research: Research;
  onSave: (r: Research) => Promise<void>;
}) {
  const [mode, setMode] = useState<1 | 4>(1),
    [evidence, setEvidence] = useState<Evidence>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    generation.current++;
    setEvidence({});
    setMessage("");
    setBusy(false);
  }, [mode]);
  const scope = recentRatedScope(matches, mode),
    rating = rateHistory(scope, evidence),
    ready = rating.overall.count >= 10;
  const name = (id: number) =>
    heroes.find((h) => h.id === id)?.name ?? `Hero ${id}`;
  const calculate = async () => {
    const token = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      const data = await loadEvidence(
        scope,
        () => token !== generation.current,
        (done, total) => {
          if (token === generation.current)
            setProgress(`${done}/${total} hero/duration comparisons`);
        },
      );
      if (token !== generation.current) return;
      setEvidence(data.evidence);
      const result = rateHistory(scope, data.evidence);
      setMessage(
        data.errors.length
          ? `Some comparisons are unavailable: ${data.errors[0]}`
          : result.overall.count < 10
            ? "At least ten complete, scored games with adequate hero reference data are needed for a Companion rank."
            : "Performance estimate updated.",
      );
      if (result.overall.count >= 10) {
        const anchor = Math.max(...result.rated.map((g) => g.match.match_id));
        const last = research.ratingHistory
          .filter((r) => r.mode === mode)
          .at(-1);
        if (!last || last.anchor !== anchor || last.model !== MODEL_VERSION)
          await onSave({
            ...research,
            ratingHistory: [
              ...research.ratingHistory,
              {
                score: result.overall.score,
                count: result.overall.count,
                mode,
                at: Date.now(),
                anchor,
                model: MODEL_VERSION as 1,
              },
            ].slice(-50),
          });
      }
    } catch (e) {
      if (token === generation.current)
        setMessage(
          e instanceof Error ? e.message : "Could not save the rating.",
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };
  const last = research.ratingHistory.filter((r) => r.mode === mode).at(-1);
  return (
    <section className="panel companion-rating">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR COMPANION RANK</span>
          <h2>Your performance & best heroes</h2>
          <p>A hero-adjusted estimate for ranked and unranked players.</p>
        </div>
        <label>
          Rating mode
          <select
            aria-label="Companion rating mode"
            value={mode}
            onChange={(e) => setMode(Number(e.target.value) as 1 | 4)}
          >
            <option value="1">Normal</option>
            <option value="4">Street Brawl</option>
          </select>
        </label>
      </div>
      <div className="rating-summary">
        <div className="rating-badge">
          <strong>{ready ? rating.overall.band : "Uncalibrated"}</strong>
          <span>
            {ready
              ? `${rating.overall.score.toFixed(1)} / 100`
              : `${scope.length} recent scored games available`}
          </span>
        </div>
        <div>
          <p>
            {ready
              ? `${rating.overall.count} measured games · ${rating.overall.count < 20 ? "provisional" : rating.overall.count < 40 ? "moderate sample" : "stronger sample"} · ${rating.unrated} excluded for missing fields or reference data.`
              : "Calculate your estimate using your last 60 scored games from the past 90 days."}
          </p>
          <button
            className="button primary"
            disabled={busy || scope.length < 10}
            onClick={() => void calculate()}
          >
            {busy ? `Comparing ${progress}…` : "Calculate Companion rank"}
          </button>
          {last && !ready && (
            <small>
              Saved estimate: {last.score.toFixed(1)}/100 · {last.count} games ·{" "}
              {new Date(last.at).toLocaleDateString()}. Recalculate for current
              comparisons.
            </small>
          )}
        </div>
      </div>
      {ready && (
        <div className="coaching-grid">
          {(
            [
              ["Survival", rating.overall.survival],
              ["Combat involvement", rating.overall.combat],
              ["Farming", rating.overall.farming],
              ["Economy", rating.overall.economy],
            ] as [string, number][]
          ).map(([label, value]) => (
            <article className="coaching-card" key={label}>
              <small>{label}</small>
              <strong>{value.toFixed(0)}/100</strong>
            </article>
          ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Your best three heroes</h3>
      {rating.heroes.length ? (
        <div className="top-hero-grid">
          {rating.heroes.slice(0, 3).map((h, i) => (
            <article className="top-hero-card" key={h.heroId}>
              <span>
                #{i + 1} · {name(h.heroId)}
              </span>
              <strong>
                {h.score.toFixed(1)}
                <small>/100</small>
              </strong>
              <p>
                {h.band} · {h.count} rated games · {h.wins} wins
              </p>
              <small>
                {h.count < 10
                  ? "Provisional: build a larger sample."
                  : "Ranked by the same performance formula, with small samples pulled toward 50."}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">
          Calculate the rating to find your strongest measured heroes. Each hero
          needs five rated games; fewer than three eligible heroes means fewer
          than three recommendations.
        </p>
      )}
      <details className="rating-method">
        <summary>How the estimate works</summary>
        <p>
          Model {MODEL_VERSION}: survival 20%, kills + assists 25%, last hits
          20%, final net worth per minute 25%, and result 10%. Private, bot,
          placement and unknown match modes are excluded. Each stat is compared
          with the same hero, mode and duration band in the provider's last 30
          days of indexed ranked/unranked games. Marginal quantiles are
          interpolated; the combined score is an index, not your percentile
          among all players.
        </p>
        <p>
          Ten neutral games worth of weight pull small samples toward 50. Low
          combat involvement caps the survival contribution, so avoiding every
          fight cannot earn maximum survival credit. All four history metrics
          must be present. The cohort must contain at least 100 indexed hero
          games; the API does not report separate sample counts for each
          quantile.
        </p>
        <p>
          Companion bands: Developing &lt;35, Building 35–49, Established 50–64,
          Advanced 65–79, Exceptional 80+. These custom bands estimate recorded
          performance, not hidden Valve MMR. Lobby strength, teammates, role
          choices, patches and missing history affect the estimate. Higher
          numbers are not instructions to chase kills or farm at the team's
          expense.
        </p>
        {Object.values(evidence).some((r) => r.stale) && (
          <p>Some comparisons use saved offline reference data.</p>
        )}
        {Object.values(evidence).length > 0 && (
          <p>
            Oldest reference fetch:{" "}
            {new Date(
              Math.min(...Object.values(evidence).map((r) => r.fetchedAt)),
            ).toLocaleString()}
            .
          </p>
        )}
        {research.ratingHistory.length > 0 && (
          <p>
            Saved snapshots:{" "}
            {research.ratingHistory
              .filter((r) => r.mode === mode)
              .slice(-6)
              .map(
                (r) =>
                  `${new Date(r.at).toLocaleDateString()}: ${r.score.toFixed(1)}`,
              )
              .join(" · ")}
            . Repeating the same match set does not add a new snapshot.
          </p>
        )}
      </details>
    </section>
  );
}
