import { describe, it, expect } from "vitest";
import { matchSchema, quantilesSchema, type Match } from "../src/core/api";
import {
  percentile,
  matchScore,
  referenceKey,
  rateHistory,
  recentRatedScope,
  durationBand,
} from "../src/core/hero-fit";
const q = quantilesSchema.parse({
  avg: 50,
  std: 20,
  percentile1: 1,
  percentile5: 5,
  percentile10: 10,
  percentile25: 25,
  percentile50: 50,
  percentile75: 75,
  percentile90: 90,
  percentile95: 95,
  percentile99: 99,
});
const match = (patch = {}) =>
  matchSchema.parse({
    match_id: 1,
    account_id: 1,
    hero_id: 1,
    game_mode: 1,
    match_mode: 1,
    start_time: 1000,
    player_match_outcome: 1,
    match_duration_s: 1800,
    player_kills: 25,
    player_assists: 25,
    player_deaths: 50,
    last_hits: 50,
    net_worth: 1500,
    ...patch,
  });
const ref = {
  metrics: {
    deaths: q,
    kills_plus_assists: q,
    last_hits: q,
    net_worth_per_min: q,
  },
  matches: 1000,
  fetchedAt: 1000,
  stale: false,
};
describe("team planner hero performance", () => {
  it("interpolates published quantiles and resolves tied values without zero division", () => {
    expect(percentile(37.5, q)).toBe(37.5);
    expect(percentile(-1, q)).toBe(0);
    expect(percentile(101, q)).toBe(100);
    const tied = { ...q, percentile1: 0, percentile5: 0, percentile10: 0 };
    expect(percentile(0, tied)).toBe(5.5);
    expect(() => quantilesSchema.parse({ ...q, percentile75: 10 })).toThrow();
  });
  it("requires full metrics, adequate evidence and matching hero/mode/duration", () => {
    const m = match(),
      key = referenceKey(m);
    expect(matchScore(m, { [key]: ref })?.score).toBe(55);
    expect(matchScore(match({ last_hits: null }), { [key]: ref })).toBeNull();
    expect(matchScore(m, { [key]: { ...ref, matches: 99 } })).toBeNull();
    expect(matchScore(match({ hero_id: 2 }), { [key]: ref })).toBeNull();
    expect(matchScore(match({ game_mode: 4 }), { [key]: ref })).toBeNull();
    expect(durationBand(1799)).toBe(1);
    expect(durationBand(1800)).toBe(2);
  });
  it("pulls small samples toward neutral and caps survival credit for low combat", () => {
    const m = match({ player_kills: 0, player_assists: 0, player_deaths: 0 });
    expect(matchScore(m, { [referenceKey(m)]: ref })?.survival).toBe(50);
    const games = Array.from({ length: 5 }, (_, i) =>
      match({ match_id: i + 1, hero_id: 1 }),
    );
    games.push(
      match({
        match_id: 6,
        hero_id: 2,
        player_kills: 99,
        player_assists: 0,
        last_hits: 99,
        player_deaths: 0,
      }),
    );
    const result = rateHistory(games, {
      [referenceKey(games[0])]: ref,
      [referenceKey(games[5])]: ref,
    });
    expect(result.heroes).toHaveLength(1);
    expect(result.heroes[0].score).toBeCloseTo(51.6667, 3);
    expect(result.overall.score).toBeLessThan(65);
  });
  it("limits ratings to recent scored games of the selected mode", () => {
    const now = 1800000000000;
    const games = Array.from({ length: 70 }, (_, i) =>
      match({ match_id: i + 1, start_time: now / 1000 - i * 3600 }),
    );
    games.push(
      match({ game_mode: 4, start_time: now / 1000 }),
      match({ start_time: now / 1000 - 91 * 86400 }),
      match({ player_match_outcome: 5, start_time: now / 1000 }),
    );
    expect(recentRatedScope(games, 1, now)).toHaveLength(60);
    expect(
      recentRatedScope(
        [
          match({ match_mode: 2, start_time: now / 1000 }),
          match({ match_mode: 3, start_time: now / 1000 }),
          match({ match_mode: undefined, start_time: now / 1000 }),
        ],
        1,
        now,
      ),
    ).toEqual([]);
    expect(games).toHaveLength(73);
  });
});
