import { outcome, type Match, type MetricDistribution } from "./api.js";
export const referenceKey = (m: Match) =>
  `${m.hero_id}-${m.game_mode}-${durationBand(m.match_duration_s ?? 0)}`;
export const durationBand = (seconds: number) =>
  seconds < 1200 ? 0 : seconds < 1800 ? 1 : seconds < 2400 ? 2 : 3;
export interface Reference {
  metrics: Record<string, MetricDistribution>;
  matches: number;
  fetchedAt: number;
  stale: boolean;
}
export type Evidence = Record<string, Reference>;
/** Approximate marginal percentile, interpolated between the provider's published quantiles. */
export function percentile(value: number, q: MetricDistribution): number {
  const points = [
    [1, q.percentile1],
    [5, q.percentile5],
    [10, q.percentile10],
    [25, q.percentile25],
    [50, q.percentile50],
    [75, q.percentile75],
    [90, q.percentile90],
    [95, q.percentile95],
    [99, q.percentile99],
  ];
  if (value < points[0][1]) return 0;
  if (value > points[8][1]) return 100;
  const equal = points.filter(([, v]) => Math.abs(v - value) < 1e-9);
  if (equal.length) return (equal[0][0] + equal[equal.length - 1][0]) / 2;
  for (let i = 1; i < points.length; i++)
    if (value < points[i][1]) {
      const [lo, x] = points[i - 1],
        [hi, y] = points[i];
      return lo + ((hi - lo) * (value - x)) / (y - x);
    }
  return 50;
}
export function matchScore(m: Match, evidence: Evidence) {
  const r = evidence[referenceKey(m)];
  if (
    !r ||
    r.matches < 100 ||
    outcome(m) === "unscored" ||
    ![1, 4].includes(m.match_mode ?? 0) ||
    !(m.match_duration_s! > 0) ||
    m.match_duration_s! >= 14400 ||
    [
      m.player_kills,
      m.player_assists,
      m.player_deaths,
      m.last_hits,
      m.net_worth,
    ].some((v) => v === null)
  )
    return null;
  const required = [
    "deaths",
    "kills_plus_assists",
    "last_hits",
    "net_worth_per_min",
  ];
  if (required.some((k) => !r.metrics[k] || r.metrics[k].std === 0))
    return null;
  const combat = percentile(
    m.player_kills! + m.player_assists!,
    r.metrics.kills_plus_assists,
  );
  const survival = Math.min(
    100 - percentile(m.player_deaths!, r.metrics.deaths),
    combat < 25 ? 50 : 100,
  );
  const farming = percentile(m.last_hits!, r.metrics.last_hits);
  const economy = percentile(
    m.net_worth! / (m.match_duration_s! / 60),
    r.metrics.net_worth_per_min,
  );
  const result = outcome(m) === "win" ? 100 : 0;
  return {
    score:
      survival * 0.2 +
      combat * 0.25 +
      farming * 0.2 +
      economy * 0.25 +
      result * 0.1,
    survival,
    combat,
    farming,
    economy,
    reference: r,
  };
}
export function recentRatedScope(
  matches: Match[],
  mode: number,
  now = Date.now(),
) {
  return matches
    .filter(
      (m) =>
        m.game_mode === mode &&
        [1, 4].includes(m.match_mode ?? 0) &&
        outcome(m) !== "unscored" &&
        m.start_time * 1000 <= now &&
        m.start_time * 1000 >= now - 90 * 86400000,
    )
    .sort((a, b) => b.start_time - a.start_time || b.match_id - a.match_id)
    .slice(0, 60);
}
export function rateHistory(matches: Match[], evidence: Evidence) {
  const rated = matches.flatMap((m) => {
    const score = matchScore(m, evidence);
    return score ? [{ match: m, ...score }] : [];
  });
  const summarize = (games: typeof rated) => {
    const count = games.length;
    const average = (
      key: "score" | "survival" | "combat" | "farming" | "economy",
    ) => (count ? games.reduce((s, g) => s + g[key], 0) / count : 50);
    const score = (average("score") * count + 50 * 10) / (count + 10);
    return {
      count,
      score,
      survival: average("survival"),
      combat: average("combat"),
      farming: average("farming"),
      economy: average("economy"),
      wins: games.filter((g) => outcome(g.match) === "win").length,
    };
  };
  const overall = summarize(rated);
  const heroes = [...new Set(rated.map((g) => g.match.hero_id))]
    .map((heroId) => ({
      heroId,
      ...summarize(rated.filter((g) => g.match.hero_id === heroId)),
    }))
    .filter((h) => h.count >= 5)
    .sort(
      (a, b) => b.score - a.score || b.count - a.count || a.heroId - b.heroId,
    );
  return { overall, heroes, rated, unrated: matches.length - rated.length };
}
