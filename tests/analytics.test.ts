import { describe, it, expect } from "vitest";
import {
  dailyPerformance,
  badgeTrend,
  filterHistory,
} from "../src/core/analytics";
import { matchSchema } from "../src/core/api";
const m = (
  id: number,
  time: string,
  outcome = 1,
  badge: number | null = null,
) =>
  matchSchema.parse({
    match_id: id,
    hero_id: 1,
    start_time: Date.parse(time) / 1000,
    player_match_outcome: outcome,
    player_kills: 4,
    player_deaths: 2,
    player_assists: 4,
    match_duration_s: 600,
    net_worth: 10000,
    ranked_display_badge: badge,
  });
describe("historical analytics", () => {
  it("groups on the chosen local calendar day and excludes unavailable outcomes from win rate", () => {
    const entries = [
      m(1, "2026-10-08T02:00:00Z"),
      m(2, "2026-10-08T04:00:00Z", 2),
      m(3, "2026-10-08T12:00:00Z", 0),
    ];
    const days = dailyPerformance(entries, "America/Chicago");
    expect(days.map((d) => d.date)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(days[0]).toMatchObject({
      count: 2,
      winRate: 50,
      kda: 4,
      networthPerMinute: 1000,
    });
    expect(days[1]).toMatchObject({ winRate: null, unscored: 1 });
  });
  it("uses only observed badges without inventing missing ranks or mutating source history", () => {
    const entries = [
      m(2, "2026-10-08T12:00:00Z", 1, 72),
      m(1, "2026-10-07T12:00:00Z", 1, 71),
      m(3, "2026-10-09T12:00:00Z"),
    ];
    expect(badgeTrend(entries).map((b) => b.badge)).toEqual([71, 72]);
    expect(entries[0].match_id).toBe(2);
  });
  it("supports result filtering, ID search and chronological ordering without changing the source", () => {
    const entries = [
      m(101, "2026-10-07T12:00:00Z", 2),
      m(102, "2026-10-08T12:00:00Z", 1),
    ];
    expect(
      filterHistory(entries, "10", "win", "oldest").map((m) => m.match_id),
    ).toEqual([102]);
    expect(
      filterHistory(entries, "", "all", "newest").map((m) => m.match_id),
    ).toEqual([102, 101]);
    expect(entries[0].match_id).toBe(101);
  });
});
