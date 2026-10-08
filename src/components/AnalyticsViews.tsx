import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { dailyPerformance, badgeTrend, filterHistory } from "../core/analytics";
import {
  heroSummaries,
  outcome,
  type Match,
  type Hero,
  type Rank,
} from "../core/api";
import { formatClock } from "../core/timer";
const n = (value: number | null, digits = 1) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const chartStyle = {
  background: "#191a22",
  border: "1px solid #34323f",
  color: "#eee",
};
export function PerformanceCharts({
  matches,
  ranks,
}: {
  matches: Match[];
  ranks: Rank[];
}) {
  const days = useMemo(() => dailyPerformance(matches), [matches]);
  const badges = useMemo(() => badgeTrend(matches), [matches]);
  const rankName = (badge: number) =>
    `${ranks.find((r) => r.tier === Math.floor(badge / 10))?.name ?? `Tier ${Math.floor(badge / 10)}`} ${badge % 10}`;
  return (
    <div className="analytics-grid">
      <section className="panel chart-panel">
        <h2>Performance over time</h2>
        <p>
          Daily scored win rate and KDA for the filtered matches. Missing values
          leave gaps. Dates use your computer’s time zone.
        </p>
        {days.length > 1 ? (
          <div
            className="chart-canvas"
            role="img"
            aria-label="Daily win rate and KDA chart"
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={days}>
                <CartesianGrid stroke="#30313c" strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={40} stroke="#9594a7" />
                <YAxis
                  yAxisId="wins"
                  domain={[0, 100]}
                  unit="%"
                  stroke="#b69ddf"
                />
                <YAxis yAxisId="kda" orientation="right" stroke="#dcb06d" />
                <Tooltip contentStyle={chartStyle} />
                <Legend />
                <Line
                  yAxisId="wins"
                  dataKey="winRate"
                  name="Win rate %"
                  stroke="#b69ddf"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="kda"
                  dataKey="kda"
                  name="KDA"
                  stroke="#dcb06d"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="chart-empty">
            At least two days of matches are needed for a trend.
          </p>
        )}
        <details className="chart-data">
          <summary>View daily values</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Matches</th>
                  <th>Scored</th>
                  <th>Win rate</th>
                  <th>KDA</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.count}</td>
                    <td>{d.wins + d.losses}</td>
                    <td>
                      {n(d.winRate)}
                      {d.winRate === null ? "" : "%"}
                    </td>
                    <td>{n(d.kda, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <section className="panel chart-panel">
        <h2>Reported rank history</h2>
        <p>
          Badges attached to matches, rather than a live rank or inferred
          rating.
        </p>
        {badges.length > 1 ? (
          <div
            className="chart-canvas"
            role="img"
            aria-label="Reported ranked match badges over time"
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={badges}>
                <CartesianGrid stroke="#30313c" strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={40} stroke="#9594a7" />
                <YAxis
                  domain={["dataMin - 1", "dataMax + 1"]}
                  stroke="#9594a7"
                  tickFormatter={(v) => rankName(Math.round(v))}
                  width={105}
                />
                <Tooltip
                  contentStyle={chartStyle}
                  formatter={(v) => [rankName(Number(v)), "Reported badge"]}
                />
                <Line
                  dataKey="badge"
                  type="stepAfter"
                  stroke="#b69ddf"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="chart-empty">
            At least two reported match badges are needed. The API may not
            include rank data.
          </p>
        )}
        {badges.length > 0 && (
          <details className="chart-data">
            <summary>View reported badges</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Match</th>
                    <th>Badge</th>
                  </tr>
                </thead>
                <tbody>
                  {badges.map((b) => (
                    <tr key={b.matchId}>
                      <td>{b.date}</td>
                      <td>{b.matchId}</td>
                      <td>{rankName(b.badge)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
export function HeroAnalytics({
  matches,
  heroes,
}: {
  matches: Match[];
  heroes: Hero[];
}) {
  const stats = useMemo(() => heroSummaries(matches), [matches]);
  const name = (id: number) =>
    heroes.find((h) => h.id === id)?.name ?? `Hero ${id}`;
  const bars = stats.slice(0, 10).map((h) => ({ ...h, name: name(h.heroId) }));
  return (
    <>
      <section className="panel chart-panel">
        <h2>Hero analytics</h2>
        <p>
          Performance for every hero in your selected public matches. Unscored
          games are excluded from win rates.
        </p>
        {bars.length > 0 ? (
          <div
            className="chart-canvas"
            role="img"
            aria-label="Matches played by hero"
          >
            <ResponsiveContainer
              width="100%"
              height={Math.max(240, bars.length * 36)}
            >
              <BarChart data={bars} layout="vertical">
                <CartesianGrid stroke="#30313c" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} stroke="#9594a7" />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={125}
                  stroke="#9594a7"
                />
                <Tooltip contentStyle={chartStyle} />
                <Bar
                  dataKey="count"
                  name="Available matches"
                  fill="#b69ddf"
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p>No matches for these filters.</p>
        )}
        <div className="table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Hero</th>
                <th>Matches</th>
                <th>W / L</th>
                <th>Unscored</th>
                <th>Win rate</th>
                <th>K / D / A</th>
                <th>KDA</th>
                <th>Net worth/min</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((h) => (
                <tr key={h.heroId}>
                  <th>{name(h.heroId)}</th>
                  <td>{h.count}</td>
                  <td>
                    {h.wins} / {h.losses}
                  </td>
                  <td>{h.unscored}</td>
                  <td>
                    {n(h.winRate)}
                    {h.winRate === null ? "" : "%"}
                  </td>
                  <td>
                    {n(h.kills, 0)} / {n(h.deaths, 0)} / {n(h.assists, 0)}
                  </td>
                  <td>{n(h.kda, 2)}</td>
                  <td>{n(h.networthPerMinute, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function MatchHistory({
  matches,
  heroes,
}: {
  matches: Match[];
  heroes: Hero[];
}) {
  const [search, setSearch] = useState(""),
    [result, setResult] = useState("all"),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(0);
  const entries = useMemo(
    () => filterHistory(matches, search, result, sort),
    [matches, search, result, sort],
  );
  useEffect(() => setPage(0), [matches, search, result, sort]);
  const pages = Math.max(1, Math.ceil(entries.length / 25));
  const current = Math.min(page, pages - 1);
  return (
    <section className="panel history-panel">
      <h2>Match history</h2>
      <p>
        Browse the available public history. Expand a match to see the fields
        returned by the API.
      </p>
      <div className="history-controls">
        <label>
          Match ID
          <input
            aria-label="Search match ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search an ID"
          />
        </label>
        <label>
          Result
          <select
            aria-label="Filter by result"
            value={result}
            onChange={(e) => setResult(e.target.value)}
          >
            <option value="all">All results</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="unscored">Unscored</option>
          </select>
        </label>
        <label>
          Order
          <select
            aria-label="Sort match history"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="duration">Longest first</option>
          </select>
        </label>
        <span>{entries.length} matching games</span>
      </div>
      {!entries.length && <p>No matches match these filters.</p>}
      {entries.slice(current * 25, (current + 1) * 25).map((m) => (
        <details className="history-match" key={m.match_id}>
          <summary>
            <span className={`result-tag ${outcome(m)}`}>{outcome(m)}</span>
            <strong>
              {heroes.find((h) => h.id === m.hero_id)?.name ??
                `Hero ${m.hero_id}`}
            </strong>
            <time>{new Date(m.start_time * 1000).toLocaleString()}</time>
            <span>
              {n(m.player_kills, 0)} / {n(m.player_deaths, 0)} /{" "}
              {n(m.player_assists, 0)}
            </span>
            <span>
              {m.match_duration_s === null
                ? "—"
                : formatClock(m.match_duration_s)}
            </span>
          </summary>
          <dl className="match-details">
            <div>
              <dt>Match ID</dt>
              <dd>{m.match_id}</dd>
            </div>
            <div>
              <dt>Final net worth</dt>
              <dd>{n(m.net_worth, 0)}</dd>
            </div>
            <div>
              <dt>Last hits</dt>
              <dd>{n(m.last_hits, 0)}</dd>
            </div>
            <div>
              <dt>Denies</dt>
              <dd>{n(m.denies, 0)}</dd>
            </div>
            <div>
              <dt>KDA</dt>
              <dd>
                {m.player_kills === null ||
                m.player_assists === null ||
                m.player_deaths === null
                  ? "—"
                  : n(
                      (m.player_kills + m.player_assists) /
                        Math.max(1, m.player_deaths),
                      2,
                    )}
              </dd>
            </div>
            <div>
              <dt>Reported badge code</dt>
              <dd>
                {m.ranked_display_badge ? n(m.ranked_display_badge, 0) : "—"}
              </dd>
            </div>
          </dl>
        </details>
      ))}
      <div className="history-pagination">
        <button
          className="button secondary small"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          Previous
        </button>
        <span>
          Page {current + 1} of {pages}
        </span>
        <button
          className="button secondary small"
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
