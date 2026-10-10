import { describe, it, expect } from "vitest";
import {
  matchSchema,
  type Hero,
  type Synergy,
  type Composition,
} from "../src/core/api";
import {
  planTeam,
  playerHeroFits,
  type PlannerPlayer,
} from "../src/core/planner";
const heroes: Hero[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Hero ${i + 1}`,
}));
const player = (id: number, hero: number): PlannerPlayer => ({
  accountId: id,
  name: `Player ${id}`,
  matches: Array.from({ length: 10 }, (_, i) =>
    matchSchema.parse({
      match_id: id * 100 + i,
      hero_id: hero,
      game_mode: 1,
      match_mode: 1,
      start_time: 100 + i,
      player_match_outcome: i < 7 ? 1 : 2,
      match_duration_s: 1800,
    }),
  ),
});
const players = Array.from({ length: 6 }, (_, i) => player(i + 1, i + 1));
const pairs: Synergy[] = heroes.flatMap((h, i) =>
  heroes.slice(i + 1).map((p) => ({
    hero_id1: h.id,
    hero_id2: p.id,
    matches_played: 100,
    wins: 55,
  })),
);
const comps: Composition[] = [
  { hero_ids: [1, 2, 3, 4, 5, 6], wins: 65, losses: 35, matches: 100 },
];
describe("evidence-based team planning", () => {
  it("matches personal hero experience to a recorded complete composition without duplicate picks", () => {
    const result = planTeam(players, heroes, pairs, comps, {}, 1)[0];
    expect(result.ids).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(result.ids).size).toBe(6);
    expect(result.template?.matches).toBe(100);
    expect(result.pair.known).toBe(15);
    expect(result.fits.every((f) => f?.count === 10)).toBe(true);
  });
  it("honors locks and rejects conflicting or unavailable locks", () => {
    expect(
      planTeam(
        players.map((p, i) => ({ ...p, lock: i === 0 ? 7 : undefined })),
        heroes,
        pairs,
        comps,
        {},
        1,
      )[0].ids[0],
    ).toBe(7);
    expect(() =>
      planTeam(
        players.map((p) => ({ ...p, lock: 1 })),
        heroes,
        pairs,
        comps,
        {},
        1,
      ),
    ).toThrow("same hero");
    expect(() =>
      planTeam(
        [{ ...players[0], lock: 99 }, ...players.slice(1)],
        heroes,
        pairs,
        comps,
        {},
        1,
      ),
    ).toThrow("unavailable");
  });
  it("labels generated plans without inventing whole-lineup results", () => {
    const result = planTeam(players, heroes, pairs, [], {}, 1)[0];
    expect(result.template).toBeUndefined();
    expect(result.pair.known).toBe(15);
    expect(result.score).toBeGreaterThan(50);
  });
  it("does not promote one-game perfect win rates and permits suggested open positions", () => {
    expect(
      playerHeroFits(
        { ...players[0], matches: players[0].matches.slice(0, 1) },
        {},
        1,
      ),
    ).toEqual([]);
    const open = players.map((p, i) =>
      i === 0 ? p : { name: `Open ${i}`, matches: [] },
    );
    expect(planTeam(open, heroes, pairs, comps, {}, 1)[0].ids).toHaveLength(6);
    expect(() =>
      planTeam(players.slice(0, 3), heroes, pairs, comps, {}, 1),
    ).toThrow("6 team slots");
  });
});

it("uses older collected hero experience, exclusions, comfort choices and distinct player alternatives", () => {
  const roster = [
    {
      ...players[0],
      favorites: [7],
      matches: [
        ...players[0].matches,
        ...player(9, 7).matches,
        ...player(10, 8).matches,
      ],
    },
    ...players.slice(1),
  ];
  const plans = planTeam(roster, heroes, pairs, comps, {}, 1, {
    preference: "comfort",
    excluded: [8],
  });
  expect(plans[0].ids[0]).toBe(7);
  expect(plans.every((p) => !p.ids.includes(8))).toBe(true);
  expect(new Set(plans.map((p) => p.ids[0])).size).toBeGreaterThan(1);
  expect(plans[0].fits[0]?.count).toBe(10);
});
it("reports core team-role gaps without inventing kits for unknown heroes", () => {
  const catalog = heroes.map((h, i) => ({
    ...h,
    name: ["Abrams", "Dynamo", "Haze"][i] ?? h.name,
    hero_type: i === 0 ? "brawler" : undefined,
  }));
  const result = planTeam(players, catalog, pairs, comps, {}, 1)[0];
  expect(result.roles.covered).toEqual(
    expect.arrayContaining(["frontline", "control", "damage", "sustain"]),
  );
  expect(result.roles.unknown).toBe(3);
});
