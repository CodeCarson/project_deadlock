import { outcome, type Match, type MatchMetadata } from "./api.js";
export type FocusMetric = "deaths" | "combat" | "farm";
export const metricLabels = {
  deaths: "Deaths / 10 min",
  combat: "Kills + assists / 10 min",
  farm: "Last hits / min",
};
export function performance(matches: Match[]) {
  const rate = (
    keys: (
      | "player_kills"
      | "player_deaths"
      | "player_assists"
      | "last_hits"
      | "net_worth"
    )[],
    scale: number,
  ) => {
    const eligible = matches.filter(
      (m) => (m.match_duration_s ?? 0) > 0 && keys.every((k) => m[k] !== null),
    );
    return {
      value: eligible.length
        ? (eligible.reduce(
            (s, m) => s + keys.reduce((n, k) => n + m[k]!, 0),
            0,
          ) /
            eligible.reduce((s, m) => s + m.match_duration_s!, 0)) *
          scale
        : null,
      count: eligible.length,
    };
  };
  const scored = matches.filter((m) => outcome(m) !== "unscored");
  return {
    count: matches.length,
    scored: scored.length,
    winRate: scored.length
      ? (scored.filter((m) => outcome(m) === "win").length / scored.length) *
        100
      : null,
    deaths: rate(["player_deaths"], 600),
    combat: rate(["player_kills", "player_assists"], 600),
    farm: rate(["last_hits"], 60),
    economy: rate(["net_worth"], 60),
  };
}
export function comparison(matches: Match[]) {
  const sorted = matches
    .filter((m) => outcome(m) !== "unscored" && (m.match_duration_s ?? 0) > 0)
    .sort((a, b) => b.start_time - a.start_time || b.match_id - a.match_id);
  // Equal disjoint windows; do not compare five recent games with thirty-five older ones.
  const window = Math.min(20, Math.floor(sorted.length / 2));
  return {
    window,
    recent: performance(sorted.slice(0, window)),
    previous: performance(sorted.slice(window, window * 2)),
    latest: sorted.slice(0, 20),
    matches: sorted,
  };
}
export function rollingPerformance(matches: Match[]) {
  const sorted = matches
    .filter((m) => outcome(m) !== "unscored")
    .sort((a, b) => a.start_time - b.start_time || a.match_id - b.match_id);
  return sorted.flatMap((m, i) => {
    if (i < 4) return [];
    const rates = performance(sorted.slice(Math.max(0, i - 9), i + 1));
    return [
      {
        matchId: m.match_id,
        label: new Date(m.start_time * 1000).toLocaleDateString(),
        deaths: rates.deaths.count >= 5 ? rates.deaths.value : null,
        combat: rates.combat.count >= 5 ? rates.combat.value : null,
        farm: rates.farm.count >= 5 ? rates.farm.value : null,
        economy: rates.economy.count >= 5 ? rates.economy.value : null,
      },
    ];
  });
}
export function winInterval(wins: number, losses: number) {
  const n = wins + losses;
  if (!n) return null;
  const p = wins / n,
    z = 1.96,
    den = 1 + (z * z) / n,
    mid = (p + (z * z) / (2 * n)) / den;
  const radius =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { low: (mid - radius) * 100, high: (mid + radius) * 100 };
}
export function finalSample(
  player: MatchMetadata["match_info"]["players"][number],
  duration: number,
) {
  const latest = player.stats
    .filter((s) => s.time_stamp_s <= duration)
    .sort((a, b) => b.time_stamp_s - a.time_stamp_s)[0];
  return latest && duration - latest.time_stamp_s <= 30 ? latest : undefined;
}
export function reviewDetails(metadata: MatchMetadata, accountId: number) {
  const info = metadata.match_info,
    player = info.players.find((p) => p.account_id === accountId);
  if (!player)
    throw new Error("This player is not present in the match metadata.");
  const team = info.players.filter((p) => p.team === player.team);
  const expectedTeamSize =
    info.game_mode === 1 ? 6 : info.game_mode === 4 ? 3 : undefined;
  const completeTeam =
    expectedTeamSize !== undefined &&
    team.length === expectedTeamSize &&
    info.players.length === expectedTeamSize * 2 &&
    new Set(info.players.map((p) => p.account_id)).size ===
      info.players.length &&
    info.players.every((p) => p.team === 0 || p.team === 1) &&
    new Set(info.players.map((p) => p.team)).size === 2;
  const final = finalSample(player, info.duration_s);
  const total = (field: "kills" | "net_worth") =>
    completeTeam && team.every((p) => p[field] !== null)
      ? team.reduce((s, p) => s + p[field]!, 0)
      : null;
  const teamKills = total("kills"),
    teamWorth = total("net_worth");
  const damage = team.map(
    (p) => finalSample(p, info.duration_s)?.player_damage ?? null,
  );
  const teamDamage =
    completeTeam && damage.every((v) => v !== null)
      ? damage.reduce<number>((s, v) => s + v!, 0)
      : null;
  const deadSeconds = player.death_details.reduce(
    (s, d) =>
      s +
      Math.min(
        d.death_duration_s ?? 0,
        Math.max(0, info.duration_s - d.game_time_s),
      ),
    0,
  );
  return {
    player,
    final,
    teamKills,
    participation:
      teamKills &&
      player.kills !== null &&
      player.assists !== null &&
      player.kills + player.assists <= teamKills
        ? ((player.kills + player.assists) / teamKills) * 100
        : null,
    worthShare:
      teamWorth && player.net_worth !== null
        ? (player.net_worth / teamWorth) * 100
        : null,
    damageShare:
      teamDamage &&
      final?.player_damage !== null &&
      final?.player_damage !== undefined
        ? (final.player_damage / teamDamage) * 100
        : null,
    deadSeconds,
    deathCoverage:
      player.deaths !== null &&
      player.death_details.length === player.deaths &&
      player.death_details.every(
        (d) => d.death_duration_s !== null && d.game_time_s <= info.duration_s,
      ),
    lateDeaths: player.death_details.filter((d) => d.game_time_s >= 900),
  };
}
