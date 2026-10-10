import {
  outcome,
  type Match,
  type Hero,
  type Synergy,
  type Composition,
} from "./api.js";
import { heroRoles, type TeamRole } from "./hero-guide.js";
import { rateHistory, recentRatedScope, type Evidence } from "./performance.js";
export interface PlannerPlayer {
  accountId?: number;
  name: string;
  matches: Match[];
  lock?: number;
  favorites?: number[];
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
  const ratings = rateHistory(recentRatedScope(matches, mode), evidence).heroes;
  return [...new Set(matches.map((m) => m.hero_id))]
    .map((heroId) => {
      const games = matches.filter((m) => m.hero_id === heroId),
        count = games.length,
        wins = games.filter((m) => outcome(m) === "win").length;
      const rated = ratings.find((r) => r.heroId === heroId);
      return {
        heroId,
        score: rated?.score ?? ((wins + 10) / (count + 20)) * 100,
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
  options: {
    preference?: "comfort" | "balanced" | "explore";
    excluded?: number[];
  } = {},
) {
  const size = mode === 1 ? 6 : 3;
  if (players.length !== size)
    throw new Error(`This mode needs ${size} team slots.`);
  const excluded = new Set(options.excluded ?? []);
  const active = new Set(
    heroes.filter((h) => !excluded.has(h.id)).map((h) => h.id),
  );
  const locks = players.flatMap((p) => (p.lock ? [p.lock] : []));
  if (new Set(locks).size !== locks.length)
    throw new Error("Two players cannot lock the same hero.");
  if (locks.some((id) => !active.has(id)))
    throw new Error(
      "A locked hero is excluded or unavailable. Remove its exclusion or unlock it.",
    );
  const fits = players.map((p) => playerHeroFits(p, evidence, mode));
  const personal = (i: number, id: number) => {
    const fit = fits[i].find((h) => h.heroId === id);
    const base = players[i].accountId
      ? (fit?.score ?? (options.preference === "explore" ? 35 : 20))
      : 40;
    const comfort = players[i].favorites?.includes(id) ? 15 : 0;
    const experience = fit ? Math.min(5, Math.log2(fit.count + 1)) : 0;
    return Math.min(100, base + comfort + experience);
  };
  const heroMap = new Map(heroes.map((h) => [h.id, h]));
  const roles = (ids: number[]) => {
    const available = new Set(ids.flatMap((id) => heroRoles(heroMap.get(id))));
    const required: TeamRole[] = ["frontline", "control", "damage"];
    const unknown = ids.filter(
      (id) => !heroRoles(heroMap.get(id)).length,
    ).length;
    return {
      covered: [...available],
      missing: required.filter((r) => !available.has(r)),
      unknown,
    };
  };
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
    const coverage = roles(ids);
    const balance =
      coverage.unknown === size
        ? 50
        : Math.max(0, 100 - coverage.missing.length * 25);
    const personalWeight =
      options.preference === "comfort"
        ? 0.85
        : options.preference === "explore"
          ? 0.55
          : 0.7;
    return {
      ids,
      score:
        affinity * personalWeight +
        pair.score * (0.85 - personalWeight) +
        fullScore * 0.1 +
        balance * 0.05,
      roles: coverage,
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
  const popularity = new Map<number, number>();
  for (const pair of synergies)
    for (const id of [pair.hero_id1, pair.hero_id2])
      popularity.set(id, (popularity.get(id) ?? 0) + pair.matches_played);
  const popular = [...heroes]
    .filter((h) => active.has(h.id))
    .sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0))
    .slice(0, 8)
    .map((h) => h.id);
  const primary = players.findIndex((p) => p.accountId && !p.lock);
  let beam: { ids: number[]; score: number }[] = [{ ids: [], score: 0 }];
  for (let i = 0; i < size; i++) {
    const pool = players[i].lock
      ? [players[i].lock!]
      : [
          ...new Set([
            ...(players[i].favorites ?? []),
            ...fits[i].slice(0, 8).map((h) => h.heroId),
            ...popular,
          ]),
        ]
          .filter((id) => active.has(id))
          .slice(0, 18);
    const expanded = beam
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
      .sort((a, b) => b.score - a.score);
    // Reserve search capacity for each primary-player pick. A single high-fit
    // hero must not remove every alternative before the team is complete.
    if (primary >= 0 && i >= primary) {
      const groups = new Map<number, typeof beam>();
      for (const state of expanded) {
        const key = state.ids[primary];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(state);
      }
      const width = Math.max(1, Math.floor(200 / Math.max(1, groups.size)));
      beam = [...groups.values()].flatMap((states) => states.slice(0, width));
    } else beam = expanded.slice(0, 200);
  }
  for (const state of beam)
    if (state.ids.length === size) results.push(evaluate(state.ids));
  const unique = new Map<string, ReturnType<typeof evaluate>>();
  for (const r of results.sort((a, b) => b.score - a.score)) {
    const key =
      [...r.ids].sort((a, b) => a - b).join("-") +
      (primary >= 0 ? `:${r.ids[primary]}` : "");
    if (!unique.has(key)) unique.set(key, r);
  }
  const ranked = [...unique.values()];
  const selected: typeof ranked = [];
  while (selected.length < 3) {
    const candidates = ranked.filter((r) => !selected.includes(r));
    if (!candidates.length) break;
    const alternative =
      primary >= 0 && selected.length
        ? candidates.find(
            (r) =>
              selected.every((s) => s.ids[primary] !== r.ids[primary]) &&
              r.score >= ranked[0].score - 12,
          )
        : undefined;
    selected.push(alternative ?? candidates[0]);
  }
  return selected;
}
