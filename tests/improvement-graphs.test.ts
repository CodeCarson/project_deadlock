import { expect, it } from "vitest";
import { comparisonBars, deathInterval } from "../src/core/improvement-graphs";
import { rollingPerformance } from "../src/core/coaching";
import { matchSchema } from "../src/core/api";

it("interprets fewer deaths as better, handles zero references and preserves equal comparisons", () => {
  expect(comparisonBars(2, 5, true)).toMatchObject({
    direction: "better",
    valueWidth: 40,
    referenceWidth: 100,
  });
  expect(comparisonBars(2, 5)).toMatchObject({ direction: "review" });
  expect(comparisonBars(4, 0, true).direction).toBe("review");
  expect(comparisonBars(0, 0)).toMatchObject({
    direction: "equal",
    valueWidth: 0,
    referenceWidth: 0,
  });
});

it("leaves gaps when a rolling metric has fewer than five measured games", () => {
  const games = Array.from({ length: 6 }, (_, i) =>
    matchSchema.parse({
      match_id: i + 1,
      hero_id: 1,
      start_time: i,
      player_match_outcome: 1,
      match_duration_s: 600,
      player_deaths: 2,
      player_kills: 1,
      player_assists: 3,
      last_hits: i === 0 ? null : 50,
      net_worth: 10000,
    }),
  );
  const points = rollingPerformance(games);
  expect(points[0].deaths).toBe(2);
  expect(points[0].farm).toBeNull();
  expect(points[1].farm).toBe(5);
  expect(points[1].economy).toBeCloseTo(1000);
});

it("clips death spans at match end and distinguishes missing duration", () => {
  expect(deathInterval(900, 200, 1000)).toEqual({ left: 90, width: 10 });
  expect(deathInterval(500, null, 1000)).toEqual({ left: 50, width: null });
  expect(deathInterval(1000, 20, 1000)).toBeNull();
  expect(deathInterval(1, 10, 0)).toBeNull();
});
