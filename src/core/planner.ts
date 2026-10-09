import {
  outcome,
  type Match,
  type Hero,
  type Synergy,
  type Composition,
} from "./api.js";
import { rateHistory, type Evidence } from "./performance.js";
export interface PlannerPlayer {
  accountId?: number;
  name: string;
  matches: Match[];
  lock?: number;
}
export interface HeroFit {
  heroId: number;
  score: number;
  count: number;
  wins: number;
  measured: boolean;
}
const pairKey = (a: number, b: number) =>
  [a, b].sort((x, y) => x - y).join("-");
export function playerHeroFits(
  player: PlannerPlayer,
  evidence: Evidence,
  mode: number,
): HeroFit[] {
  const matches = player.matches.filter(
    (m) =>
      m.game_mode === mode &&
      [1, 4].includes(m.match_mode ?? 0) &&
      outcome(m) !== "unscored",
  );
  const ratings = rateHistory(matches, evidence).heroes;
  return [...new Set(matches.map((m) => m.hero_id))]
    .map((heroId) => {
      const games = matches.filter((m) => m.hero_id === heroId),
        count = games.length,
        wins = games.filter((m) => outcome(m) === "win").length;
      const rated = ratings.find((r) => r.heroId === heroId);
      return {
        heroId,
        score: rated?.score ?? ((wins + 5) / (count + 10)) * 100,
        count,
        wins,
        measured: !!rated,
      };
    })
    .filter((h) => h.count >= 3)
    .sort((a, b) => b.score - a.score || b.count - a.count);
}
export function planTeam(
  players: PlannerPlayer[],
  heroes: Hero[],
  synergies: Synergy[],
  compositions: Composition[],
  evidence: Evidence,
  mode: number,
) {
  const size = mode === 1 ? 6 : 3;
  if (players.length !== size)
    throw new Error(`This mode needs ${size} team slots.`);
  const active = new Set(heroes.map((h) => h.id));
  const locks = players.flatMap((p) => (p.lock ? [p.lock] : []));
  if (new Set(locks).size !== locks.length)
    throw new Error("Two players cannot lock the same hero.");
  if (locks.some((id) => !active.has(id)))
    throw new Error("A locked hero is unavailable in the current catalog.");
  const fits = players.map((p) => playerHeroFits(p, evidence, mode));
  const personal = (i: number, id: number) =>
    players[i].accountId
      ? (fits[i].find((h) => h.heroId === id)?.score ?? 20)
      : 40;
  const pairs = new Map(
    synergies
      .filter(
        (s) =>
          s.matches_played >= 20 &&
          active.has(s.hero_id1) &&
          active.has(s.hero_id2),
      )
      .map((s) => [pairKey(s.hero_id1, s.hero_id2), s]),
  );
  const pairScore = (ids: number[]) => {
    let score = 0,
      known = 0,
      total = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        total++;
        const pair = pairs.get(pairKey(ids[i], ids[j]));
        if (pair) {
          known++;
          score += ((pair.wins + 50) / (pair.matches_played + 100)) * 100;
        } else score += 50;
      }
    return { score: total ? score / total : 50, known, total };
  };
  const templates = compositions.filter(
    (c) =>
      c.hero_ids.length === size &&
      c.matches >= 20 &&
      c.hero_ids.every((id) => active.has(id)) &&
      locks.every((id) => c.hero_ids.includes(id)),
  );
  const templateMap = new Map(
    templates.map((c) => [[...c.hero_ids].sort((a, b) => a - b).join("-"), c]),
  );
  const evaluate = (ids: number[]) => {
    const team = templateMap.get([...ids].sort((a, b) => a - b).join("-"));
    const affinity = ids.reduce((s, id, i) => s + personal(i, id), 0) / size;
    const pair = pairScore(ids);
    const fullScore = team
      ? ((team.wins + 50) / (team.wins + team.losses + 100)) * 100
      : 50;
    return {
      ids,
      score: affinity * 0.75 + pair.score * 0.15 + fullScore * 0.1,
      affinity,
      pair,
      template: team,
      fits: ids.map((id, i) => fits[i].find((h) => h.heroId === id)),
    };
  };
  const results: ReturnType<typeof evaluate>[] = [];
  // Exact assignment for recorded templates; each player gets one unique hero.
  for (const template of templates.slice(0, 5000)) {
    let states = new Map<number, { score: number; ids: number[] }>([
      [0, { score: 0, ids: [] }],
    ]);
    for (let i = 0; i < size; i++) {
      const next = new Map<number, { score: number; ids: number[] }>();
      for (const [mask, state] of states)
        for (let j = 0; j < size; j++) {
          const id = template.hero_ids[j];
          if (mask & (1 << j) || (players[i].lock && players[i].lock !== id))
            continue;
          const key = mask | (1 << j),
            score = state.score + personal(i, id);
          if (!next.has(key) || score > next.get(key)!.score)
            next.set(key, { score, ids: [...state.ids, id] });
        }
      states = next;
    }
    const best = states.get((1 << size) - 1);
    if (best) results.push(evaluate(best.ids));
  }
  const popular = [...heroes]
    .sort((a, b) => {
      const sum = (id: number) =>
        synergies
          .filter((s) => s.hero_id1 === id || s.hero_id2 === id)
          .reduce((n, s) => n + s.matches_played, 0);
      return sum(b.id) - sum(a.id);
    })
    .slice(0, 8)
    .map((h) => h.id);
  let beam: { ids: number[]; score: number }[] = [{ ids: [], score: 0 }];
  for (let i = 0; i < size; i++) {
    const pool = players[i].lock
      ? [players[i].lock!]
      : [...new Set([...fits[i].slice(0, 6).map((h) => h.heroId), ...popular])]
          .filter((id) => active.has(id))
          .slice(0, 12);
    beam = beam
      .flatMap((s) =>
        pool
          .filter((id) => !s.ids.includes(id))
          .map((id) => {
            const ids = [...s.ids, id];
            return {
              ids,
              score:
                (ids.reduce((v, h, j) => v + personal(j, h), 0) / ids.length) *
                  0.8 +
                pairScore(ids).score * 0.2,
            };
          }),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
  }
  for (const state of beam)
    if (state.ids.length === size) results.push(evaluate(state.ids));
  const unique = new Map<string, ReturnType<typeof evaluate>>();
  for (const r of results.sort((a, b) => b.score - a.score)) {
    const key = [...r.ids].sort((a, b) => a - b).join("-");
    if (!unique.has(key)) unique.set(key, r);
  }
  return [...unique.values()].slice(0, 3);
}
