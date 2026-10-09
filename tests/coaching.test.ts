import { describe, it, expect } from "vitest";
import { matchSchema, metadataSchema } from "../src/core/api";
import {
  performance,
  comparison,
  reviewDetails,
  winInterval,
  rollingPerformance,
} from "../src/core/coaching";
const match = (patch = {}) =>
  matchSchema.parse({
    match_id: 1,
    hero_id: 1,
    start_time: 100,
    player_match_outcome: 1,
    player_kills: 2,
    player_assists: 4,
    player_deaths: 2,
    last_hits: 60,
    net_worth: 10000,
    match_duration_s: 600,
    ...patch,
  });
describe("evidence-based personal coaching", () => {
  it("weights rates by duration, excludes missing metrics and never divides by zero", () => {
    const result = performance([
      match(),
      match({
        match_id: 2,
        match_duration_s: 1800,
        player_deaths: 4,
        last_hits: null,
      }),
      match({ match_id: 3, match_duration_s: 0 }),
    ]);
    expect(result.deaths.value).toBe(1.5);
    expect(result.deaths.count).toBe(2);
    expect(result.farm).toEqual({ value: 6, count: 1 });
    expect(
      performance([match({ match_duration_s: 0 })]).combat.value,
    ).toBeNull();
  });
  it("uses disjoint equal scored windows and ignores invalid outcomes", () => {
    const matches = Array.from({ length: 11 }, (_, i) =>
      match({ match_id: i + 1, start_time: i, player_deaths: i < 5 ? 5 : 1 }),
    );
    matches.push(
      match({ match_id: 99, start_time: 99, player_match_outcome: 5 }),
    );
    const result = comparison(matches);
    expect(result.window).toBe(5);
    expect(result.recent.deaths.value).toBe(1);
    expect(result.previous.count).toBe(5);
    expect(matches[0].match_id).toBe(1);
    expect(rollingPerformance(matches)).toHaveLength(7);
  });
  it("uses wide intervals for small samples and handles no scored games", () => {
    expect(winInterval(0, 0)).toBeNull();
    expect(winInterval(1, 0)!.low).toBeLessThan(30);
    expect(winInterval(50, 50)!.low).toBeGreaterThan(40);
  });
  it("requires correct player identity, terminal stats and complete team shares", () => {
    const metadata = metadataSchema.parse({
      match_info: {
        match_id: 1,
        start_time: 1,
        duration_s: 1000,
        game_mode: 1,
        players: [
          {
            account_id: 1,
            hero_id: 1,
            team: 0,
            kills: 2,
            deaths: 1,
            assists: 2,
            net_worth: 10000,
            stats: [{ time_stamp_s: 990, player_damage: 3000 }],
            death_details: [{ game_time_s: 970, death_duration_s: 90 }],
          },
          {
            account_id: 2,
            hero_id: 2,
            team: 0,
            kills: 6,
            net_worth: 10000,
            stats: [{ time_stamp_s: 990, player_damage: 7000 }],
          },
        ],
      },
    });
    for (let i = 0; i < 10; i++)
      metadata.match_info.players.push(
        metadataSchema.parse({
          match_info: {
            match_id: 1,
            start_time: 1,
            duration_s: 1000,
            players: [
              {
                account_id: 10 + i,
                hero_id: 1,
                team: i < 4 ? 0 : 1,
                kills: 0,
                deaths: 0,
                assists: 0,
                net_worth: 0,
                stats: [{ time_stamp_s: 1000, player_damage: 0 }],
              },
            ],
          },
        }).match_info.players[0],
      );
    const review = reviewDetails(metadata, 1);
    expect(review.participation).toBe(50);
    expect(review.damageShare).toBe(30);
    expect(review.deadSeconds).toBe(30);
    expect(review.deathCoverage).toBe(true);
    expect(() => reviewDetails(metadata, 3)).toThrow("not present");
    metadata.match_info.players[1].stats[0].time_stamp_s = 500;
    expect(reviewDetails(metadata, 1).damageShare).toBeNull();
    metadata.match_info.players[0].assists = 20;
    expect(reviewDetails(metadata, 1).participation).toBeNull();
    metadata.match_info.players.pop();
    const partial = reviewDetails(metadata, 1);
    expect(partial.participation).toBeNull();
    expect(partial.worthShare).toBeNull();
    expect(partial.damageShare).toBeNull();
  });
});
