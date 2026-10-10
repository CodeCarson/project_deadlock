import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { bridge } from "../core/bridge";
import {
  heroSchema,
  matchSchema,
  profileSchema,
  synergySchema,
  compositionSchema,
  type Hero,
  type Synergy,
  type Composition,
} from "../core/api";
import { type Evidence } from "../core/performance";
import { heroRoles } from "../core/hero-guide";
import { planTeam, playerHeroFits, type PlannerPlayer } from "../core/planner";
import { winInterval } from "../core/coaching";
import { loadEvidence } from "./evidence";
import { PlayerSearch } from "./PlayerSearch";
import type { Settings } from "../core/schema";
type Slot = PlannerPlayer & { input: string; loading: boolean; error: string };
export function TeamPlanner({
  accountId,
  saved,
  onSave,
}: {
  accountId: string;
  saved: Settings["planner"];
  onSave: (value: Settings["planner"]) => Promise<void>;
}) {
  const [mode, setMode] = useState<1 | 4>(saved.mode),
    [cohort, setCohort] = useState(saved.cohort),
    [preference, setPreference] = useState(saved.preference),
    [excluded, setExcluded] = useState<number[]>(saved.excluded);
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: 6 }, (_, i) => ({
      input: saved.accountIds[i] || (i === 0 ? accountId : ""),
      name: `Open position ${i + 1}`,
      matches: [],
      lock: saved.locks[i] || undefined,
      favorites: saved.favorites[i],
      loading: false,
      error: "",
    })),
  );
  const [heroes, setHeroes] = useState<Hero[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [plans, setPlans] = useState<ReturnType<typeof planTeam>>([]),
    [pairs, setPairs] = useState<Synergy[]>([]),
    [source, setSource] = useState("");
  const tokens = useRef([0, 0, 0, 0, 0, 0]),
    generation = useRef(0),
    mounted = useRef(true);
  const update = (i: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const invalidate = () => {
    generation.current++;
    setPlans([]);
    setStatus("");
    setBusy(false);
  };
  const select = async (i: number, id: number) => {
    const token = ++tokens.current[i];
    invalidate();
    update(i, {
      input: String(id),
      accountId: undefined,
      matches: [],
      loading: true,
      error: "",
    });
    try {
      const [history, profile] = await Promise.all([
        bridge.request({ resource: "history", accountId: id }),
        bridge.request({ resource: "profile", accountId: id }),
      ]);
      const matches = z.array(matchSchema).parse(history.data);
      const name =
        z
          .array(profileSchema)
          .parse(profile.data)
          .find((p) => p.account_id === id)?.personaname ?? `Player ${id}`;
      if (mounted.current && tokens.current[i] === token)
        update(i, {
          accountId: id,
          matches,
          name,
          loading: false,
          error: history.stale
            ? "Using saved history; provider coverage may be incomplete."
            : "",
        });
    } catch (e) {
      if (mounted.current && tokens.current[i] === token)
        update(i, {
          loading: false,
          error: e instanceof Error ? e.message : "Player data unavailable",
        });
    }
  };
  useEffect(() => {
    mounted.current = true;
    void bridge
      .request({ resource: "heroes" })
      .then((r) => {
        if (mounted.current) setHeroes(z.array(heroSchema).parse(r.data));
      })
      .catch((e) => {
        if (mounted.current) setStatus(e.message);
      });
    slots.forEach((slot, i) => {
      if (slot.input) void select(i, Number(slot.input));
    });
    return () => {
      mounted.current = false;
      generation.current++;
      tokens.current = tokens.current.map((t) => t + 1);
    };
  }, []);
  const size = mode === 1 ? 6 : 3;
  const active = slots.slice(0, size);
  const generate = async () => {
    const ids = active.flatMap((s) => (s.accountId ? [s.accountId] : []));
    if (new Set(ids).size !== ids.length) {
      setStatus("Each team position must use a different Steam account.");
      return;
    }
    const token = ++generation.current;
    setBusy(true);
    setStatus("Loading recorded compositions and hero references…");
    setPlans([]);
    try {
      const options = { analysisMode: mode, cohort };
      const results = await Promise.all([
        bridge.request({ resource: "synergy", ...options }),
        bridge.request({ resource: "compositions", ...options }),
      ]);
      if (token !== generation.current) return;
      const synergies = z.array(synergySchema).parse(results[0].data),
        compositions = z.array(compositionSchema).parse(results[1].data);
      const roster = active.map((p) => ({
        ...p,
        matches: p.matches,
      }));
      const candidates = roster.flatMap((p) => {
        const preferred = playerHeroFits(p, {}, mode)
          .slice(0, 8)
          .map((h) => h.heroId);
        return preferred.flatMap((id) =>
          p.matches.filter((m) => m.hero_id === id).slice(0, 10),
        );
      });
      const reference = await loadEvidence(
        candidates,
        () => token !== generation.current,
        (done, total) => {
          if (token === generation.current)
            setStatus(
              `Comparing players' hero performance (${done}/${total})…`,
            );
        },
      );
      if (token !== generation.current) return;
      const picks = planTeam(
        roster,
        heroes,
        synergies,
        compositions,
        reference.evidence,
        mode,
        { preference, excluded },
      );
      if (!picks.length)
        throw new Error(
          "No valid unique-hero composition fits these locks. Try unlocking a pick.",
        );
      await onSave({
        mode,
        cohort,
        accountIds: slots.map((p) => (p.accountId ? String(p.accountId) : "")),
        locks: slots.map((p) => p.lock ?? 0),
        favorites: slots.map((p) => p.favorites ?? []),
        preference,
        excluded,
      });
      if (token !== generation.current) return;
      setPairs(synergies);
      setPlans(picks);
      setSource(
        `${cohort === "elite" ? "Ascendant/Eternus (average badge 101+)" : "Ranked"} · last 30 days · ${synergies.length} pairs and ${compositions.length} complete compositions · oldest fetch ${new Date(Math.min(...results.map((r) => r.fetchedAt))).toLocaleString()}${results.some((r) => r.stale) ? " · saved offline data" : ""}`,
      );
      setStatus(
        reference.errors.length
          ? "Plan ready. Some hero comparisons were unavailable; those fits use smoothed personal win rate."
          : "Plan ready. Open positions are suggested fills; unfamiliar picks are marked.",
      );
    } catch (e) {
      if (token === generation.current)
        setStatus(
          e instanceof Error ? e.message : "Could not build a team plan.",
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };
  const name = (id: number) =>
    heroes.find((h) => h.id === id)?.name ?? `Hero ${id}`;
  return (
    <div className="team-planner">
      <section className="panel">
        <h2>Build around your team</h2>
        <p>
          Use your collected history, choose comfort heroes, and leave empty
          positions for suggested fills.
        </p>
        <div className="history-controls">
          <label>
            Team mode
            <select
              aria-label="Team planner mode"
              value={mode}
              onChange={(e) => {
                invalidate();
                setMode(Number(e.target.value) as 1 | 4);
              }}
            >
              <option value="1">Normal · six heroes</option>
              <option value="4">Street Brawl · three heroes</option>
            </select>
          </label>
          <label>
            Composition evidence
            <select
              aria-label="Team evidence cohort"
              value={cohort}
              onChange={(e) => {
                invalidate();
                setCohort(e.target.value as "ranked" | "elite");
              }}
            >
              <option value="ranked">All ranked games</option>
              <option value="elite">Ascendant / Eternus games</option>
            </select>
          </label>
          <label>
            Selection style
            <select
              aria-label="Selection style"
              value={preference}
              onChange={(e) => {
                invalidate();
                setPreference(e.target.value as typeof preference);
              }}
            >
              <option value="balanced">Balanced</option>
              <option value="comfort">Comfort picks first</option>
              <option value="explore">Explore more heroes</option>
            </select>
          </label>
          <label>
            Exclude a hero
            <select
              aria-label="Exclude a hero"
              value=""
              onChange={(e) => {
                invalidate();
                setExcluded((v) => [
                  ...new Set([...v, Number(e.target.value)]),
                ]);
              }}
            >
              <option value="">Choose a hero…</option>
              {heroes
                .filter((h) => !excluded.includes(h.id))
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="hero-chips">
          {excluded.map((id) => (
            <button
              className="hero-chip"
              key={id}
              onClick={() => {
                invalidate();
                setExcluded((v) => v.filter((h) => h !== id));
              }}
            >
              {name(id)} excluded ×
            </button>
          ))}
        </div>
      </section>
      <div className="planner-roster">
        {active.map((slot, i) => (
          <fieldset className="planner-slot" key={i}>
            <legend>
              Position {i + 1}
              {i === 0 ? " · you" : ""}
            </legend>
            <PlayerSearch
              fieldId={`team-player-${i}`}
              label={`Position ${i + 1} Steam name or ID`}
              input={slot.input}
              setInput={(input) => {
                tokens.current[i]++;
                invalidate();
                update(i, {
                  input,
                  accountId: undefined,
                  matches: [],
                  name: `Open position ${i + 1}`,
                  loading: false,
                  error: "",
                });
              }}
              loading={slot.loading}
              onSelect={(id) => select(i, id)}
              onError={(error) => update(i, { error })}
            />
            {slot.accountId && (
              <p>
                {slot.name} ·{" "}
                {slot.matches.filter((m) => m.game_mode === mode).length}{" "}
                collected mode games · account {slot.accountId}. Older games may
                still be missing.
              </p>
            )}
            {slot.error && <p role="status">{slot.error}</p>}
            <label>
              Comfort pool
              <select
                aria-label={`Position ${i + 1} comfort hero`}
                value=""
                onChange={(e) => {
                  invalidate();
                  update(i, {
                    favorites: [
                      ...new Set([
                        ...(slot.favorites ?? []),
                        Number(e.target.value),
                      ]),
                    ].slice(0, 12),
                  });
                }}
              >
                <option value="">Add a hero…</option>
                {heroes
                  .filter(
                    (h) =>
                      !(slot.favorites ?? []).includes(h.id) &&
                      !excluded.includes(h.id),
                  )
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="hero-chips">
              {slot.favorites?.map((id) => (
                <button
                  className="hero-chip"
                  key={id}
                  onClick={() => {
                    invalidate();
                    update(i, {
                      favorites: slot.favorites?.filter((h) => h !== id),
                    });
                  }}
                >
                  {name(id)} ×
                </button>
              ))}
            </div>
            <label>
              Preferred hero lock
              <select
                aria-label={`Position ${i + 1} hero lock`}
                value={slot.lock ?? 0}
                onChange={(e) => {
                  invalidate();
                  update(i, { lock: Number(e.target.value) || undefined });
                }}
              >
                <option value="0">Flexible</option>
                {heroes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
      </div>
      <section className="panel">
        <button
          className="button primary"
          disabled={
            busy ||
            !heroes.length ||
            active.some((s) => s.loading) ||
            !active.some((s) => s.accountId)
          }
          onClick={() => void generate()}
        >
          {busy ? "Building your composition…" : "Recommend team composition"}
        </button>
        {status && <p role="status">{status}</p>}
        {source && plans.length > 0 && <p className="muted">{source}</p>}
        <p className="muted">
          Uses verified public ranked data. The API does not identify
          professional tournament matches, so these results are not labelled as
          pro data. Statistical co-occurrence does not prove a combo causes
          wins.
        </p>
      </section>
      {plans.map((plan, index) => {
        const comp = plan.template,
          interval = comp ? winInterval(comp.wins, comp.losses) : null;
        return (
          <section className="panel recommended-comp" key={plan.ids.join("-")}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {index === 0 ? "RECOMMENDED" : "ALTERNATIVE"}
                </span>
                <h2>{index === 0 ? "Best fit" : `Alternative ${index}`}</h2>
              </div>
              <strong>{plan.score.toFixed(1)} / 100 fit</strong>
            </div>
            <p>
              {comp
                ? `Recorded complete lineup: ${comp.matches} matches, ${((comp.wins / (comp.wins + comp.losses)) * 100).toFixed(1)}% scored win rate${interval ? `, 95% interval ${interval.low.toFixed(1)}–${interval.high.toFixed(1)}%` : ""}.`
                : "Generated from player fit and recorded hero pairs; no qualifying full-lineup record is available."}
            </p>
            {index > 0 && (
              <small>
                Alternative player picks are prioritised when unlocked. Check
                unfamiliar picks below.
              </small>
            )}
            <p className="role-check">
              Roles: {plan.roles.covered.join(" · ") || "unknown"}
              {plan.roles.missing.length
                ? ` · Check ${plan.roles.missing.join(" / ")} coverage`
                : " · Core roles covered"}
              {plan.roles.unknown
                ? ` · ${plan.roles.unknown} hero kits unclassified`
                : ""}
            </p>
            <div className="comp-picks">
              {plan.ids.map((id, i) => {
                const fit = plan.fits[i],
                  hero = heroes.find((h) => h.id === id);
                return (
                  <article key={i}>
                    <small>
                      {active[i].accountId
                        ? active[i].name
                        : `Open position ${i + 1}`}
                    </small>
                    <h3>{name(id)}</h3>
                    <p>
                      {heroRoles(hero).join(" · ") ||
                        hero?.hero_type ||
                        "Role information unavailable"}
                    </p>
                    <small>
                      {fit
                        ? `${fit.count} personal games · ${fit.wins} wins · ${fit.measured ? "hero-adjusted performance fit" : "result-based provisional fit"} ${fit.score.toFixed(1)}`
                        : active[i].accountId
                          ? "Unfamiliar pick: no three-game sample in collected history."
                          : "Suggested fill for an open team position."}
                      {active[i].lock ? " · locked" : ""}
                    </small>
                  </article>
                );
              })}
            </div>
            <details>
              <summary>Why this lineup & pair evidence</summary>
              <p>
                Fit combines personal hero performance (75%), smoothed pair
                results (15%), and available full-composition results (10%).
                Personal scope is up to 60 scored games from the last 90 days.
                The four leading experienced heroes are benchmarked; other picks
                use personal wins with ten neutral games of weight. Unfamiliar
                picks receive a low fit. Pair/full-lineup rates use 100 neutral
                results of weight. This index is not a forecast of your team's
                win probability.
              </p>
              <p>
                {plan.pair.known}/{plan.pair.total} hero pairs have at least 20
                recorded games. Team roles and builds can vary; agree on
                initiation, objective conversion and resource allocation before
                queueing.
              </p>
              <ul>
                {pairs
                  .filter(
                    (p) =>
                      plan.ids.includes(p.hero_id1) &&
                      plan.ids.includes(p.hero_id2),
                  )
                  .map((p) => (
                    <li key={`${p.hero_id1}-${p.hero_id2}`}>
                      {name(p.hero_id1)} + {name(p.hero_id2)}:{" "}
                      {p.matches_played} games,{" "}
                      {((p.wins / p.matches_played) * 100).toFixed(1)}% wins
                    </li>
                  ))}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}
