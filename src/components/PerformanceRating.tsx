import { DeadlockArt, heroArtwork } from "./DeadlockArt";
import { useEffect, useRef, useState } from "react";
import { type Match, type Hero, gameModeName, outcome } from "../core/api";
import {
  rateHistory,
  recentRatedScope,
  MODEL_VERSION,
  performanceRank,
  ratingValidation,
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
  const last = research.ratingHistory.filter((r) => r.mode === mode).at(-1);
  const badge = performanceRank(
    ready ? rating.overall.score : (last?.score ?? 50),
  );
  const validation = ratingValidation(rating.rated);
  const careerScope = matches.filter(
    (m) =>
      m.game_mode === mode &&
      [1, 4].includes(m.match_mode ?? 0) &&
      outcome(m) !== "unscored" &&
      m.start_time * 1000 <= Date.now(),
  );
  const heroRating = rateHistory(careerScope, evidence);
  const name = (id: number) =>
    heroes.find((h) => h.id === id)?.name ?? `Hero ${id}`;
  const calculate = async () => {
    const token = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      const data = await loadEvidence(
        [...scope, ...careerScope],
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
                model: MODEL_VERSION as 2,
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
  return (
    <section className="panel companion-rating">
      <div className="section-heading">
        <div>
          <span className="eyebrow">COMPANION ESTIMATE</span>
          <h2>Your estimated rank</h2>
          <p>Recorded performance, using Deadlock’s rank names.</p>
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
        <div className="rating-badge" data-tier={badge.tier}>
          <DeadlockArt
            name={`rank-${ready || last ? badge.tier : 0}.webp`}
            className="rank-emblem"
          />
          <strong>{ready || last ? badge.label : "Obscurus"}</strong>
          <span>
            {ready
              ? `${rating.overall.score.toFixed(1)} / 100`
              : last
                ? `Saved · ${last.score.toFixed(1)} / 100`
                : `${scope.length} games available · calibration needed`}
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
              Saved estimate: {performanceRank(last.score).label} · {last.count}{" "}
              games · {new Date(last.at).toLocaleDateString()}. Recalculate for
              current comparisons.
            </small>
          )}
        </div>
      </div>
      {ready && (
        <div className="rank-progress">
          <span>
            {badge.next
              ? `${badge.progress.toFixed(0)}% to ${badge.next}`
              : "Top of the app scale"}
          </span>
          <progress
            aria-label="Next performance division"
            value={badge.progress}
            max={100}
          />
        </div>
      )}
      {research.expectedTotal && matches.length < research.expectedTotal && (
        <p className="coverage-warning">
          Partial history: {matches.length} / {research.expectedTotal} reported
          games. Recover older games above before judging your career record.
        </p>
      )}
      {ready && (
        <div
          className="strength-chart"
          role="group"
          aria-label="Hero-adjusted performance strengths"
        >
          <p>Hero-adjusted strengths · performance index, 0–100</p>
          {(
            [
              ["Survival", rating.overall.survival],
              ["Combat involvement", rating.overall.combat],
              ["Farming", rating.overall.farming],
              ["Economy", rating.overall.economy],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div className="strength-row" key={label}>
              <span>{label}</span>
              <meter min={0} max={100} value={value} aria-label={label} />
              <strong>{value.toFixed(0)}</strong>
            </div>
          ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Your best three heroes</h3>
      {heroRating.rated.length > 0 && (
        <small>
          {heroRating.rated.length} / {careerScope.length} collected scored
          games compared.
        </small>
      )}
      {heroRating.heroes.length ? (
        <div className="top-hero-grid">
          {heroRating.heroes.slice(0, 3).map((h, i) => (
            <article className="top-hero-card" key={h.heroId}>
              <DeadlockArt
                name={heroArtwork(name(h.heroId))}
                className="top-hero-portrait"
              />
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
          Calculate to compare heroes across your collected games. Each needs
          five measured games; missing references are excluded.
        </p>
      )}
      <details className="rating-method">
        <summary>Rank scale, data and validation</summary>
        <p>
          App estimate, not your official Valve rank or hidden MMR. The 0–100
          performance index maps evenly onto Initiate through Eternus, with six
          divisions each. Private, bot and unknown modes are excluded.
        </p>
        <p>
          Model {MODEL_VERSION}: survival 20%, combat 25%, farming 20%, economy
          25%, result 10%. Compared with the same hero, mode and duration in the
          last 30 days. Ten neutral games stabilise small samples; low combat
          limits survival credit. Current references can differ from the patch
          played.
        </p>
        <p>
          {validation.count >= 10
            ? `Sanity check: ${validation.count} measured ranked games with reported Valve badges; mean difference ${validation.tierError!.toFixed(1)} tiers. This is an in-sample check, not proof of predictive accuracy.`
            : `Validation pending: ${validation.count} measured ranked games have an official badge (ten required). Unranked results cannot validate an official-rank prediction.`}
        </p>
        <p>
          Best heroes use all collected scored games with valid current hero
          comparisons, at least five per hero. Older patches can differ. Overall
          rank uses your last 60 scored games in 90 days.
        </p>
        {Object.values(evidence).length > 0 && (
          <small>
            Reference fetched{" "}
            {new Date(
              Math.min(...Object.values(evidence).map((r) => r.fetchedAt)),
            ).toLocaleString()}
            {Object.values(evidence).some((r) => r.stale)
              ? " · saved offline data"
              : ""}
            . Quantile sample counts are not reported separately.
          </small>
        )}
        {last && (
          <p>
            Last saved: {performanceRank(last.score).label} · {last.count} games
            · {new Date(last.at).toLocaleDateString()}.
          </p>
        )}
      </details>
    </section>
  );
}
