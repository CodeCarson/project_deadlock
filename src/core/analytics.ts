import { summarise, type Match } from "./api.js";
export function dailyPerformance(
  matches: Match[],
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const days = new Map<string, Match[]>();
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const match of matches) {
    const parts = formatter.formatToParts(new Date(match.start_time * 1000));
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const group = days.get(date) ?? [];
    group.push(match);
    days.set(date, group);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, matches]) => ({ date, ...summarise(matches) }));
}
export function badgeTrend(matches: Match[]) {
  return matches
    .filter((m) => (m.ranked_display_badge ?? 0) > 0)
    .sort((a, b) => a.start_time - b.start_time)
    .map((m) => ({
      matchId: m.match_id,
      date: new Date(m.start_time * 1000).toLocaleDateString(),
      badge: m.ranked_display_badge!,
      time: m.start_time,
    }));
}
export function filterHistory(
  matches: Match[],
  search: string,
  result: string,
  sort: string,
) {
  const outcome = (m: Match) =>
    m.player_match_outcome === 1
      ? "win"
      : m.player_match_outcome === 2
        ? "loss"
        : "unscored";
  return matches
    .filter(
      (m) =>
        (!search.trim() || String(m.match_id).includes(search.trim())) &&
        (result === "all" || outcome(m) === result),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.start_time - b.start_time
        : sort === "duration"
          ? (b.match_duration_s ?? -1) - (a.match_duration_s ?? -1)
          : b.start_time - a.start_time,
    );
}
