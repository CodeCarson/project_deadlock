import { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { z } from "zod";
import { bridge } from "../core/bridge";
import {
  metadataSchema,
  itemSchema,
  outcome,
  type Hero,
  type Item,
  type Match,
  type MatchMetadata,
} from "../core/api";
import {
  gameCoaching,
  referenceKey,
  type Reference,
} from "../core/performance";
import { loadEvidence } from "./evidence";
import { reviewDetails } from "../core/coaching";
import { formatClock } from "../core/timer";
import type { Research } from "./ImprovementCenter";
const n = (value: number | null | undefined, d = 1) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: d });
export function PostgameReview({
  accountId,
  matches,
  allMatches = matches,
  heroes,
  research,
  onSave,
}: {
  accountId: number;
  matches: Match[];
  allMatches?: Match[];
  heroes: Hero[];
  research: Research;
  onSave: (r: Research) => Promise<void>;
}) {
  const [selected, setSelected] = useState(matches[0]?.match_id ?? 0),
    [metadata, setMetadata] = useState<MatchMetadata>(),
    [items, setItems] = useState<Item[]>([]),
    [reference, setReference] = useState<Reference>(),
    [referenceSubject, setReferenceSubject] = useState("");
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  const [source, setSource] = useState(""),
    [resultWarning, setResultWarning] = useState("");
  const generation = useRef(0);
  const match = matches.find((m) => m.match_id === selected) ?? matches[0];
  useEffect(() => {
    generation.current++;
    setMetadata(undefined);
    setReference(undefined);
    setReferenceSubject("");
    setLoading(false);
    setError("");
    setSource("");
    setResultWarning("");
    setNote(
      research.notes.find((n) => n.matchId === match?.match_id)?.text ?? "",
    );
    if (match && (match.game_mode === 1 || match.game_mode === 4)) {
      const token = generation.current;
      void loadEvidence([match], () => token !== generation.current).then(
        (result) => {
          if (token === generation.current) {
            setReference(result.evidence[referenceKey(match)]);
            setReferenceSubject(referenceKey(match));
          }
        },
      );
    }
    return () => {
      generation.current++;
    };
  }, [accountId, match?.match_id]);
  const load = async () => {
    if (!match) return;
    const token = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        bridge.request({ resource: "metadata", matchId: match.match_id }),
        bridge.request({ resource: "items" }),
        loadEvidence([match], () => token !== generation.current),
      ]);
      if (token !== generation.current) return;
      if (results[2].status === "fulfilled") {
        setReference(results[2].value.evidence[referenceKey(match)]);
        setReferenceSubject(referenceKey(match));
      }
      if (results[0].status === "rejected") throw results[0].reason;
      const data = metadataSchema.parse(results[0].value.data);
      const player = reviewDetails(data, accountId).player;
      if (player.hero_id !== match.hero_id)
        throw new Error(
          "Match hero differs from history; refresh before reviewing.",
        );
      setMetadata(data);
      setSource(
        `${results[0].value.stale ? "Saved offline data" : results[0].value.cached ? "Cached metadata" : "Provider metadata"} · fetched ${new Date(results[0].value.fetchedAt).toLocaleString()}`,
      );
      setResultWarning(results[0].value.warning ?? "");
      if (results[1].status === "fulfilled")
        setItems(z.array(itemSchema).parse(results[1].value.data));
    } catch (e) {
      if (token === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Detailed data is unavailable for this match.",
        );
    } finally {
      if (token === generation.current) setLoading(false);
    }
  };
  const detail =
    metadata &&
    match &&
    metadata.match_info.match_id === match.match_id &&
    metadata.match_info.players.some((p) => p.account_id === accountId)
      ? reviewDetails(metadata, accountId)
      : undefined;
  const coaching = match
    ? gameCoaching(
        { ...match, account_id: accountId },
        allMatches,
        heroes.find((h) => h.id === match.hero_id),
        referenceSubject === referenceKey(match) ? reference : undefined,
        metadata,
      )
    : undefined;
  const duration = metadata?.match_info.duration_s ?? 0;
  const income = detail?.final;
  const sumIncome = (
    a: number | null | undefined,
    b: number | null | undefined,
  ) =>
    a === null || a === undefined || b === null || b === undefined
      ? null
      : a + b;
  const incomeSources = [
    {
      name: "Lane creeps + orbs",
      value: sumIncome(income?.gold_lane_creep, income?.gold_lane_creep_orbs),
    },
    {
      name: "Neutral creeps + orbs",
      value: sumIncome(
        income?.gold_neutral_creep,
        income?.gold_neutral_creep_orbs,
      ),
    },
    {
      name: "Players + orbs",
      value: sumIncome(income?.gold_player, income?.gold_player_orbs),
    },
    {
      name: "Objectives + orbs",
      value: sumIncome(income?.gold_boss, income?.gold_boss_orb),
    },
    { name: "Treasure", value: income?.gold_treasure ?? null },
    { name: "Denied", value: income?.gold_denied ?? null },
  ];
  const saveNote = async () => {
    if (!match) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...research,
        notes: [
          ...research.notes.filter((n) => n.matchId !== match.match_id),
          ...(note.trim()
            ? [{ matchId: match.match_id, text: note.trim() }]
            : []),
        ].slice(-500),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save your review note.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel postgame-review">
      <span className="eyebrow">TURN A RESULT INTO A PRACTICE PLAN</span>
      <h2>Postgame review</h2>
      <div className="history-controls">
        <label>
          Match to review
          <select
            aria-label="Match to review"
            value={match?.match_id ?? 0}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {matches.map((m) => (
              <option key={m.match_id} value={m.match_id}>
                {new Date(m.start_time * 1000).toLocaleDateString()} ·{" "}
                {heroes.find((h) => h.id === m.hero_id)?.name ??
                  `Hero ${m.hero_id}`}{" "}
                · {outcome(m)} · #{m.match_id}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={loading || !match}
          onClick={() => void load()}
        >
          {loading ? "Loading review…" : "Load detailed review"}
        </button>
      </div>
      {coaching && (
        <section className="match-coaching">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                #{match!.match_id} · {coaching.name}
              </span>
              <h3>Your next-game focus</h3>
              <small>{coaching.identity}</small>
            </div>
          </div>
          <div className="coaching-pair">
            <article>
              <h4>{coaching.title}</h4>
              {coaching.weakest ? (
                <p>
                  {coaching.weakest.label}:{" "}
                  <strong>{n(coaching.weakest.value)}</strong> versus{" "}
                  {n(coaching.weakest.expected)} reference.
                </p>
              ) : (
                <p>
                  Not enough comparable games yet. Load details or recover older
                  history.
                </p>
              )}
            </article>
            <article>
              <h4>One change for next game</h4>
              <p>{coaching.action}</p>
              {coaching.weakest?.key === "deaths" && coaching.moment && (
                <small>
                  Start with the death at{" "}
                  {formatClock(coaching.moment.game_time_s)}
                  {coaching.moment.death_duration_s != null
                    ? ` (${Math.round(Math.min(coaching.moment.death_duration_s, Math.max(0, (match!.match_duration_s ?? 0) - coaching.moment.game_time_s)))}s dead)`
                    : ""}
                  .
                </small>
              )}
            </article>
          </div>
          <button
            className="button secondary small"
            onClick={() =>
              setNote((old) =>
                `${old}${old ? "\n\n" : ""}${coaching.name} — ${coaching.weakest?.label ?? "Decision review"}: ${coaching.action}`.slice(
                  0,
                  1500,
                ),
              )
            }
          >
            Add this focus to my note
          </button>
          {reference && (
            <details className="coach-source">
              <summary>Comparison source</summary>
              <small>
                {coaching.weakest?.source ?? "Hero reference"} ·{" "}
                {reference.matches} indexed games · fetched{" "}
                {new Date(reference.fetchedAt).toLocaleString()}
                {reference.stale ? " · offline" : ""}. Stats show outcomes; they
                cannot identify the cause of every decision.
              </small>
            </details>
          )}
        </section>
      )}
      {error && (
        <p role="status" className="review-error">
          {error}
        </p>
      )}
      {detail && (
        <>
          <p className="muted">{source}</p>
          {resultWarning && <p>{resultWarning}</p>}
          <div className="review-metrics">
            {[
              [
                "Kill participation",
                detail.participation === null
                  ? "—"
                  : `${n(detail.participation)}%`,
              ],
              [
                "Team net-worth share",
                detail.worthShare === null ? "—" : `${n(detail.worthShare)}%`,
              ],
              [
                "Team hero-damage share",
                detail.damageShare === null ? "—" : `${n(detail.damageShare)}%`,
              ],
              [
                "Reported time dead",
                `${formatClock(detail.deadSeconds)}${detail.deathCoverage ? "" : " (partial)"}`,
              ],
              ["Hero damage", n(detail.final?.player_damage, 0)],
              ["Objective damage", n(detail.final?.boss_damage, 0)],
              ["Teammate healing", n(detail.final?.teammate_healing, 0)],
              [
                "Recorded soul loss on death",
                n(detail.final?.gold_death_loss, 0),
              ],
            ].map(([label, value]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <p className="muted">
            Participation is (kills + assists) / team kills. Shares need
            complete team totals. Damage/healing use a terminal snapshot within
            30 seconds of match end and may omit the final seconds; earlier
            snapshots are not presented as final totals. Hero roles differ, so
            shares are context rather than performance grades.
          </p>
          <div className="review-grid">
            <section>
              <h3>Death-review moments</h3>
              <p>
                {detail.lateDeaths.length} recorded deaths after 15:00.{" "}
                {detail.deathCoverage
                  ? `${n(duration ? (detail.deadSeconds / duration) * 100 : 0)}% of match time was spent dead.`
                  : "Death records are incomplete; the listed time is a partial sum."}{" "}
                Review the decision before each death rather than assuming every
                death was avoidable.
              </p>
              <div className="death-events">
                {detail.player.death_details.length ? (
                  detail.player.death_details.map((d, i) => (
                    <span key={i}>
                      {formatClock(d.game_time_s)} ·{" "}
                      {d.death_duration_s === null
                        ? "duration unavailable"
                        : `${formatClock(Math.min(d.death_duration_s, Math.max(0, duration - d.game_time_s)))} dead`}
                    </span>
                  ))
                ) : (
                  <p>No death timestamps were supplied.</p>
                )}
              </div>
              <ol>
                <li>
                  Was the fight needed, and what enemy information was missing?
                </li>
                <li>
                  Did you have a safe escape route or a teammate close enough to
                  help?
                </li>
                <li>
                  Which reachable wave or objective did the death prevent you
                  from contesting?
                </li>
              </ol>
            </section>
            <section>
              <h3>Resource and combat progression</h3>
              <p>
                Recorded snapshots at their actual timestamps; no precise
                lane-time values are invented between samples.
              </p>
              {detail.player.stats.length > 1 ? (
                <div
                  className="chart-canvas"
                  role="img"
                  aria-label="Selected match net worth and hero damage progression"
                >
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart
                      data={[...detail.player.stats].sort(
                        (a, b) => a.time_stamp_s - b.time_stamp_s,
                      )}
                    >
                      <CartesianGrid stroke="#30313c" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="time_stamp_s"
                        tickFormatter={formatClock}
                        stroke="#9594a7"
                      />
                      <YAxis stroke="#9594a7" />
                      <Tooltip
                        labelFormatter={(v) => formatClock(Number(v))}
                        contentStyle={{
                          background: "#191a22",
                          border: "1px solid #34323f",
                        }}
                      />
                      <Legend />
                      <Line
                        dataKey="net_worth"
                        name="Net worth"
                        stroke="#dcb06d"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="player_damage"
                        name="Hero damage"
                        stroke="#b69ddf"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p>At least two recorded snapshots are needed.</p>
              )}
              <details>
                <summary>View recorded snapshots</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Net worth</th>
                        <th>Hero damage</th>
                        <th>Lane kills</th>
                        <th>Neutral kills</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.player.stats.map((s, i) => (
                        <tr key={i}>
                          <td>{formatClock(s.time_stamp_s)}</td>
                          <td>{n(s.net_worth, 0)}</td>
                          <td>{n(s.player_damage, 0)}</td>
                          <td>{n(s.creep_kills, 0)}</td>
                          <td>{n(s.neutral_kills, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          </div>
          <h3>Reported resource sources</h3>
          <p>
            Recorded income counters from the terminal snapshot. This is a
            subset of sources; shared awards and other sources can be missing,
            so it is not total earned souls. Use it to review how much lane,
            neutral and combat income your route produced.
          </p>
          <div className="review-metrics">
            {incomeSources.map((source) => (
              <article key={source.name}>
                <small>{source.name}</small>
                <strong>{n(source.value, 0)}</strong>
              </article>
            ))}
          </div>
          <details className="purchase-review">
            <summary>
              Item purchase timeline ({detail.player.items.length} recorded
              events)
            </summary>
            <p>
              Recorded purchases, upgrades and other item events. Repeated IDs
              can represent upgrades; this is not a reconstructed final
              inventory.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Item / event</th>
                    <th>Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.player.items]
                    .sort((a, b) => a.game_time_s - b.game_time_s)
                    .map((item, i) => (
                      <tr key={i}>
                        <td>{formatClock(item.game_time_s)}</td>
                        <td>
                          {items.find((x) => x.id === item.item_id)?.name ??
                            `Item ${item.item_id}`}
                        </td>
                        <td>
                          {item.sold_time_s
                            ? formatClock(item.sold_time_s)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {research.notes.length > 0 && (
        <details className="saved-journal">
          <summary>
            Saved review journal ({research.notes.length} notes)
          </summary>
          {[...research.notes]
            .reverse()
            .slice(0, 20)
            .map((entry) => (
              <article key={entry.matchId}>
                <strong>Match #{entry.matchId}</strong>
                <p>{entry.text}</p>
                {matches.some((m) => m.match_id === entry.matchId) && (
                  <button
                    className="button secondary small"
                    onClick={() => setSelected(entry.matchId)}
                  >
                    Review this match
                  </button>
                )}
              </article>
            ))}
        </details>
      )}
      {match && (
        <div className="review-note">
          <h3>Your decision journal</h3>
          <label>
            Review note for match {match.match_id}
            <textarea
              aria-label="Match review note"
              maxLength={1500}
              rows={3}
              value={note}
              placeholder="One decision to repeat, one to change, and a concrete focus for the next game."
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            disabled={saving}
            onClick={() => void saveNote()}
          >
            {saving ? "Saving…" : "Save review note"}
          </button>
          <small>
            Notes stay in your local app profile and persist across launches.
            Empty text removes this match's note.
          </small>
        </div>
      )}
    </section>
  );
}
