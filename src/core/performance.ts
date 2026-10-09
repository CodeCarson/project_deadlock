import {
  outcome,
  type Match,
  type Hero,
  type MetricDistribution,
  type MatchMetadata,
} from "./api.js";
import { finalSample, performance } from "./coaching.js";
export const MODEL_VERSION = 1;
export const referenceKey = (m: Match) =>
  `${m.hero_id}-${m.game_mode}-${durationBand(m.match_duration_s ?? 0)}`;
export const durationBand = (seconds: number) =>
  seconds < 1200 ? 0 : seconds < 1800 ? 1 : seconds < 2400 ? 2 : 3;
export const bandLabel = (band: number) =>
  ["under 20 min", "20–30 min", "30–40 min", "40+ min"][band];
export interface Reference {
  metrics: Record<string, MetricDistribution>;
  matches: number;
  fetchedAt: number;
  stale: boolean;
}
export type Evidence = Record<string, Reference>;
const clamp = (x: number) => Math.max(0, Math.min(100, x));
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
export function ratingBand(score: number) {
  return score < 35
    ? "Developing"
    : score < 50
      ? "Building"
      : score < 65
        ? "Established"
        : score < 80
          ? "Advanced"
          : "Exceptional";
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
      band: ratingBand(score),
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
const prompts = {
  deaths:
    "Before committing, identify your escape route and count visible threats. Review one death immediately after the game and record the information you missed.",
  combat:
    "Arrive with a teammate before the next objective fight. Pick one fight to enter on time with your key ability ready; judge the arrival, not just the kill count.",
  farm: "Plan a wave-to-camp route before leaving lane. At ten minutes, check whether a rotation cost you a reachable wave and adjust the next route.",
  economy:
    "Protect collected souls and spend before the next contested objective. Check your route after a death rather than forcing another fight while behind.",
  damage:
    "Use one fight to track ability uptime and target access. Stay with your team long enough to apply your hero's damage instead of taking an isolated trade.",
  objectives:
    "After a won fight, identify a safe tower, Walker or other objective with your team. Review one conversion opportunity rather than padding damage.",
  healing:
    "Keep a teammate in range when your defensive abilities are available. Review one fight where positioning stopped you from helping them.",
};
export function gameCoaching(
  match: Match,
  all: Match[],
  hero: Hero | undefined,
  reference?: Reference,
  metadata?: MatchMetadata,
) {
  const prior = all
    .filter(
      (m) =>
        m.match_id !== match.match_id &&
        m.start_time < match.start_time &&
        m.hero_id === match.hero_id &&
        m.game_mode === match.game_mode &&
        m.match_mode === match.match_mode &&
        outcome(m) !== "unscored",
    )
    .sort((a, b) => b.start_time - a.start_time)
    .slice(0, 10);
  const baseline = performance(prior);
  const mins = (match.match_duration_s ?? 0) / 60;
  const rows: {
    key: keyof typeof prompts;
    label: string;
    value: number;
    expected: number;
    score: number;
    source: string;
  }[] = [];
  const add = (
    key: keyof typeof prompts,
    label: string,
    value: number | null | undefined,
    metric: string,
    personal: number | null,
    scale = 1,
  ) => {
    if (value === null || value === undefined || !mins) return;
    const q =
      reference &&
      reference.matches >= 100 &&
      [1, 4].includes(match.match_mode ?? 0)
        ? reference.metrics[metric]
        : undefined;
    if (q && q.std > 0)
      rows.push({
        key,
        label,
        value,
        expected: q.percentile50,
        score:
          key === "deaths" ? 100 - percentile(value, q) : percentile(value, q),
        source: `same-hero, same-mode ${bandLabel(durationBand(match.match_duration_s!))} community games`,
      });
    else if (
      {
        deaths: baseline.deaths.count,
        combat: baseline.combat.count,
        farm: baseline.farm.count,
        economy: baseline.economy.count,
        damage: 0,
        objectives: 0,
        healing: 0,
      }[key] >= 5 &&
      personal !== null
    ) {
      const rate = value / scale;
      const score =
        personal === 0
          ? rate === 0
            ? 50
            : key === "deaths"
              ? 0
              : 100
          : clamp(
              50 +
                25 *
                  Math.log2(Math.max(0.01, rate / personal)) *
                  (key === "deaths" ? -1 : 1),
            );
      rows.push({
        key,
        label,
        value,
        expected: personal * scale,
        score,
        source: `your measured previous scored games on this hero and mode`,
      });
    }
  };
  add(
    "deaths",
    "Deaths",
    match.player_deaths,
    "deaths",
    baseline.deaths.value,
    mins / 10,
  );
  add(
    "combat",
    "Kills + assists",
    match.player_kills === null || match.player_assists === null
      ? null
      : match.player_kills + match.player_assists,
    "kills_plus_assists",
    baseline.combat.value,
    mins / 10,
  );
  add(
    "farm",
    "Last hits",
    match.last_hits,
    "last_hits",
    baseline.farm.value,
    mins,
  );
  add(
    "economy",
    "Final net worth / min",
    mins && match.net_worth !== null ? match.net_worth / mins : null,
    "net_worth_per_min",
    baseline.economy.value,
  );
  const player =
    metadata?.match_info.match_id === match.match_id
      ? metadata.match_info.players.find(
          (p) =>
            p.account_id === match.account_id && p.hero_id === match.hero_id,
        )
      : undefined;
  const sample = player && finalSample(player, metadata!.match_info.duration_s);
  if (sample) {
    add(
      "damage",
      "Hero damage / min",
      sample.player_damage === null ? null : sample.player_damage / mins,
      "player_damage_per_min",
      null,
    );
    add(
      "objectives",
      "Objective damage / min",
      sample.boss_damage === null ? null : sample.boss_damage / mins,
      "boss_damage_per_min",
      null,
    );
    add(
      "healing",
      "Teammate healing / min",
      sample.teammate_healing === null ? null : sample.teammate_healing / mins,
      "teammate_healing_per_min",
      null,
    );
  }
  rows.sort((a, b) => a.score - b.score);
  const weakest = rows[0];
  const name = hero?.name ?? `Hero ${match.hero_id}`;
  const identity = [hero?.hero_type, hero?.description?.role]
    .filter(Boolean)
    .join(" · ");
  return {
    name,
    identity,
    weakest,
    rows,
    prior: prior.length,
    title: weakest
      ? weakest.score < 40
        ? "What did not go as well"
        : "Your next opportunity"
      : "A decision to review",
    action: weakest
      ? prompts[weakest.key] +
        ({
          brawler:
            " As a brawler, time your commitment with teammates who can follow up.",
          assassin:
            " As an assassin, plan your entry and exit before looking for a backline angle.",
          marksman:
            " As a marksman, look for a firing angle with cover and teammate support.",
          mystic:
            " As a mystic, plan the fight around your important cooldowns and allies' positioning.",
        }[hero?.hero_type as "brawler" | "assassin" | "marksman" | "mystic"] ??
          "")
      : "Review your last death or lowest-impact fight. Write what you knew before committing, then choose one decision to change next game. There is not enough comparable data to identify a statistical weakness yet.",
    role:
      hero?.description?.playstyle ??
      "Compare this hero with its own results; a single damage or kill total cannot judge every role.",
  };
}
