import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleHelp,
  Crosshair,
  RefreshCw,
  Shield,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react";
import { bridge } from "../core/bridge";
import {
  gameModeName,
  heroSchema,
  heroSummaries,
  matchSchema,
  outcome,
  profileSchema,
  rankSchema,
  safeImage,
  summarise,
  type ApiResult,
  type Hero,
  type Match,
  type Profile,
  type Rank,
} from "../core/api";
import { z } from "zod";
import type { Settings } from "../core/schema";
import {
  HeroAnalytics,
  MatchHistory,
  PerformanceCharts,
} from "./AnalyticsViews";
import { PlayerSearch } from "./PlayerSearch";
import {
  ImprovementCenter,
  emptyResearch,
  type Research,
} from "./ImprovementCenter";
import { PostgameReview } from "./PostgameReview";
import { PerformanceRating } from "./PerformanceRating";
import { HistoryCoverage } from "./HistoryCoverage";
import { formatClock } from "../core/timer";

interface PlayerData {
  accountId: number;
  history: Match[];
  heroes: Hero[];
  ranks: Rank[];
  profile?: Profile;
  historyResult: ApiResult;
  warnings: string[];
}
const number = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
export function PlayerDashboard({
  accountId,
  onAccountChange,
  view = "Dashboard",
  savedFilters = { hero: "all", mode: "all", days: "all" },
  onFiltersChange,
  research = emptyResearch,
  onResearchChange,
}: {
  view?: "Dashboard" | "Heroes" | "Match History" | "Analysis" | "Stats";
  research?: Research;
  onResearchChange?: (research: Research) => Promise<void>;
  savedFilters?: Settings["playerFilters"];
  onFiltersChange?: (filters: Settings["playerFilters"]) => void;
  accountId: string;
  onAccountChange: (id: string) => Promise<void>;
}) {
  const [input, setInput] = useState(accountId),
    [data, setData] = useState<PlayerData>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [hero, setHero] = useState(savedFilters.hero),
    [mode, setMode] = useState(savedFilters.mode),
    [days, setDays] = useState<Settings["playerFilters"]["days"]>(
      savedFilters.days,
    );
  const generation = useRef(0);
  const setFilters = (patch: Partial<Settings["playerFilters"]>) => {
    const next = { hero, mode, days, ...patch };
    setHero(next.hero);
    setMode(next.mode);
    setDays(next.days);
    onFiltersChange?.(next);
  };
  const load = async (id: number, refresh = false, forceRefetch = false) => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    // Hide another player's results immediately. A failed lookup must never relabel old data.
    setData((previous) => (previous?.accountId === id ? previous : undefined));
    const resources = ["history", "profile", "heroes", "ranks"] as const;
    const results = await Promise.allSettled(
      resources.map((resource) =>
        Promise.resolve().then(() =>
          bridge.request({
            resource,
            accountId:
              resource === "heroes" || resource === "ranks" ? undefined : id,
            refresh,
            forceRefetch: resource === "history" && forceRefetch,
          }),
        ),
      ),
    );
    if (request !== generation.current) return;
    const history = results[0];
    if (history.status === "rejected") {
      setError(
        history.reason instanceof Error
          ? history.reason.message
          : "Could not load player matches.",
      );
      setLoading(false);
      return;
    }
    const warnings: string[] = [];
    const read = (index: number) => {
      const result = results[index];
      if (result.status === "fulfilled") {
        if (result.value.warning)
          warnings.push(`${resources[index]}: ${result.value.warning}`);
        return result.value.data;
      }
      warnings.push(`${resources[index]} is unavailable.`);
      return undefined;
    };
    try {
      const matches = z
        .array(matchSchema)
        .parse(history.value.data)
        .sort((a, b) => b.start_time - a.start_time);
      const profiles = read(1),
        heroes = read(2),
        ranks = read(3);
      if (history.value.warning) warnings.unshift(history.value.warning);
      setData({
        accountId: id,
        history: matches,
        profile: profiles
          ? z
              .array(profileSchema)
              .parse(profiles)
              .find((p) => p.account_id === id)
          : undefined,
        heroes: heroes ? z.array(heroSchema).parse(heroes) : [],
        ranks: ranks ? z.array(rankSchema).parse(ranks) : [],
        historyResult: history.value,
        warnings: [...new Set(warnings)],
      });
    } catch {
      setError("The API returned unexpected data. Try refreshing later.");
    }
    setLoading(false);
  };
  useEffect(() => {
    setInput(accountId);
    setHero(savedFilters.hero);
    setMode(savedFilters.mode);
    setDays(savedFilters.days);
    if (accountId) void load(Number(accountId));
    else setData(undefined);
    return () => {
      generation.current++;
    };
  }, [accountId]);
  const filtered = useMemo(
    () =>
      data?.history.filter(
        (m) =>
          (hero === "all" || String(m.hero_id) === hero) &&
          (mode === "all" || String(m.game_mode) === mode) &&
          (days === "all" ||
            m.start_time >= Date.now() / 1000 - Number(days) * 86400),
      ) ?? [],
    [data, hero, mode, days],
  );
  const stats = summarise(filtered),
    heroes = heroSummaries(filtered);
  const heroName = (id: number) =>
    data?.heroes.find((h) => h.id === id)?.name ?? `Hero ${id}`;
  const heroImage = (id: number) => {
    const h = data?.heroes.find((h) => h.id === id);
    return safeImage(
      h?.images?.icon_image_small_webp ?? h?.images?.icon_image_small,
    );
  };
  const selectPlayer = async (id: number) => {
    setError("");
    setInput(String(id));
    if (String(id) === accountId) await load(id, true);
    else await onAccountChange(String(id));
  };
  const saveResearch = async (value: Research) => {
    if (!onResearchChange) throw new Error("Research saving is unavailable.");
    await onResearchChange(value);
  };
  const badgeMatch = data?.history.find(
    (m) => (m.ranked_display_badge ?? 0) > 0,
  );
  const badge = badgeMatch?.ranked_display_badge ?? null;
  const tier = badge !== null ? Math.floor(badge / 10) : null;
  const subrank = badge !== null ? badge % 10 : null;
  const rank =
    tier !== null && tier !== undefined && tier > 0
      ? (data?.ranks.find((r) => r.tier === tier)?.name ?? `Tier ${tier}`) +
        (subrank ? ` ${subrank}` : "")
      : null;
  const image = safeImage(data?.profile?.avatarfull);
  return (
    <div className="player-dashboard">
      <PlayerSearch
        input={input}
        setInput={setInput}
        loading={loading}
        onSelect={selectPlayer}
        onError={setError}
      />
      {error && (
        <div className="banner error-banner" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => data && void load(data.accountId, true)}
            disabled={loading || !data}
          >
            Retry
          </button>
        </div>
      )}
      {!data && !loading && !error && (
        <section className="panel player-empty">
          <span className="future-icon">
            <UserRound size={35} />
          </span>
          <span className="phase-chip">PUBLIC PLAYER STATISTICS</span>
          <h2>Your matches. A clearer picture.</h2>
          <p>
            Load your Steam account to see the public matches available from
            Deadlock API. Missing fields stay unavailable; the dashboard never
            fills them with sample statistics.
          </p>
        </section>
      )}
      {loading && !data && (
        <section className="panel player-empty" role="status">
          <RefreshCw className="spin" size={27} />
          <h2>Fetching public player data…</h2>
          <p>
            This may take a moment if the API is refreshing Steam match history.
          </p>
        </section>
      )}
      {data && (
        <>
          <section className="panel player-profile">
            <div className="player-avatar">
              {image ? (
                <img
                  src={image}
                  alt="Player avatar"
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
              ) : (
                <UserRound size={30} />
              )}
            </div>
            <div className="player-identity">
              <span className="eyebrow">STEAM ACCOUNT {data.accountId}</span>
              <h2>{data.profile?.personaname ?? `Player ${data.accountId}`}</h2>
              <p>
                {rank ? (
                  <>
                    <Trophy size={13} /> {rank}
                    <span className="muted">
                      Last match badge ·{" "}
                      {badgeMatch &&
                        new Date(
                          badgeMatch.start_time * 1000,
                        ).toLocaleDateString()}
                    </span>
                  </>
                ) : (
                  <>
                    <Shield size={13} /> Rank not available
                  </>
                )}
              </p>
            </div>
            <div className="cache-status">
              <span
                className={`data-pill ${data.historyResult.stale ? "stale" : ""}`}
              >
                {data.historyResult.stale
                  ? "OFFLINE CACHE"
                  : data.historyResult.cached
                    ? "CACHED DATA"
                    : "API RESPONSE"}
              </span>
              <small>
                Fetched{" "}
                {new Date(data.historyResult.fetchedAt).toLocaleString()}
              </small>
              <button
                className="button secondary small"
                disabled={loading}
                onClick={() => void load(data.accountId, true)}
              >
                <RefreshCw size={13} className={loading ? "spin" : ""} />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </section>
          <section className="panel freshness-panel">
            <strong>
              {data.history.length} available matches · newest match{" "}
              {data.history[0]
                ? new Date(data.history[0].start_time * 1000).toLocaleString()
                : "unavailable"}
            </strong>
            <p>
              {data.historyResult.historySource === "steam"
                ? "The provider attempted a Steam-history fetch. This does not guarantee complete career history."
                : data.historyResult.historySource === "stored"
                  ? "The provider returned indexed history without calling Steam. This can omit recent games and does not represent your career total."
                  : "The provider did not report whether it fetched Steam history. Fetch time alone does not establish that every match is included."}
            </p>
            <p>
              Normal Refresh checks for updates. A full rebuild requests older
              Steam records too, needs provider bot access, and is limited to
              once per hour. See the provider’s{" "}
              <a
                href="https://api.deadlock-api.com/docs"
                target="_blank"
                rel="noreferrer"
              >
                match-history documentation
              </a>{" "}
              for bot access; provider subscriptions may be required.
            </p>
            <button
              className="button secondary small"
              disabled={loading}
              onClick={() => void load(data.accountId, true, true)}
            >
              Rebuild full history
            </button>
          </section>
          <HistoryCoverage
            key={`coverage-${data.accountId}`}
            accountId={data.accountId}
            matches={data.history}
            result={data.historyResult}
            research={research}
            onSave={saveResearch}
            loading={loading}
            onReload={() => load(data.accountId)}
          />
          {data.warnings.length > 0 && (
            <div className="banner info-banner">
              <CircleHelp size={16} />
              <div>
                {data.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </div>
          )}
          <div className="player-filters">
            <span className="card-label">MATCH FILTERS</span>
            <label>
              Hero
              <select
                aria-label="Filter by hero"
                value={hero}
                onChange={(e) => setFilters({ hero: e.target.value })}
              >
                <option value="all">All heroes</option>
                {[...new Set(data.history.map((m) => m.hero_id))].map((id) => (
                  <option key={id} value={id}>
                    {heroName(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select
                aria-label="Filter by game mode"
                value={mode}
                onChange={(e) => setFilters({ mode: e.target.value })}
              >
                <option value="all">All modes</option>
                {[
                  ...new Set(
                    data.history
                      .map((m) => m.game_mode)
                      .filter(
                        (v): v is number => v !== null && v !== undefined,
                      ),
                  ),
                ].map((id) => (
                  <option key={id} value={id}>
                    {gameModeName(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select
                aria-label="Filter by time period"
                value={days}
                onChange={(e) =>
                  setFilters({
                    days: e.target.value as Settings["playerFilters"]["days"],
                  })
                }
              >
                <option value="all">All available</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <span className="filter-count">
              {filtered.length} of {data.history.length} available
            </span>
          </div>
          <div className="stats-grid">
            <article className="panel stat-card">
              <span className="card-label">AVAILABLE MATCHES</span>
              <strong>{number(stats.count)}</strong>
              <small>
                {stats.wins} wins · {stats.losses} losses · {stats.unscored}{" "}
                unscored
              </small>
            </article>
            <article className="panel stat-card">
              <span className="card-label">WIN RATE</span>
              <strong>
                {stats.winRate === null ? "—" : `${number(stats.winRate, 1)}%`}
              </strong>
              <small>Based on scored wins and losses</small>
            </article>
            <article className="panel stat-card">
              <span className="card-label">KDA RATIO</span>
              <strong>{number(stats.kda, 2)}</strong>
              <small>
                {number(stats.kills)} K · {number(stats.deaths)} D ·{" "}
                {number(stats.assists)} A
              </small>
            </article>
            <article
              className="panel stat-card"
              title="Average of each match's final net worth divided by its duration. This is not total souls earned per minute."
            >
              <span className="card-label">NET WORTH / MIN</span>
              <strong>{number(stats.networthPerMinute)}</strong>
              <small>
                Final net worth / duration · {stats.economyCount} matches
              </small>
            </article>
          </div>
          <p className="data-scope">
            Statistics reflect the available public match history and selected
            filters, which may not include your full career. KDA = (kills +
            assists) / max(1, deaths).
          </p>
          {view === "Stats" && !filtered.length && (
            <section className="panel player-empty compact-empty">
              <h2>
                {data.history.length
                  ? "No matches match these filters."
                  : "No public matches available yet."}
              </h2>
              <p>
                Adjust the hero, mode or period, or check the account and
                refresh.
              </p>
            </section>
          )}
          {view === "Stats" && (
            <PerformanceRating
              key={`rating-${data.accountId}`}
              matches={data.history}
              heroes={data.heroes}
              research={research}
              onSave={saveResearch}
            />
          )}
          {(view === "Dashboard" || view === "Heroes") && (
            <PerformanceCharts matches={filtered} ranks={data.ranks} />
          )}
          {(view === "Dashboard" ||
            view === "Analysis" ||
            view === "Stats") && (
            <details className="panel stats-disclosure" open={view !== "Stats"}>
              <summary>Your improvement plan & trends</summary>
              <ImprovementCenter
                key={`improve-${data.accountId}`}
                matches={filtered}
                allMatches={data.history}
                heroes={data.heroes}
                heroFilter={hero}
                research={research}
                onSave={saveResearch}
              />
            </details>
          )}
          {(view === "Analysis" || view === "Stats") && (
            <PostgameReview
              key={`review-${data.accountId}`}
              accountId={data.accountId}
              matches={filtered}
              allMatches={data.history}
              heroes={data.heroes}
              research={research}
              onSave={saveResearch}
            />
          )}
          {view === "Stats" && (
            <>
              <details className="panel stats-disclosure">
                <summary>Explore all matches</summary>
                <MatchHistory matches={filtered} heroes={data.heroes} />
              </details>
              <details className="panel stats-disclosure">
                <summary>Explore hero statistics</summary>
                <HeroAnalytics matches={filtered} heroes={data.heroes} />
              </details>
              <details className="panel stats-disclosure">
                <summary>Explore long-term charts & reported badges</summary>
                <PerformanceCharts matches={filtered} ranks={data.ranks} />
              </details>
            </>
          )}
          {view === "Heroes" && (
            <HeroAnalytics matches={filtered} heroes={data.heroes} />
          )}
          {view === "Match History" && (
            <MatchHistory matches={filtered} heroes={data.heroes} />
          )}
          {(view === "Dashboard" || view === "Match History") && (
            <PostgameReview
              key={`review-${data.accountId}`}
              accountId={data.accountId}
              matches={filtered}
              allMatches={data.history}
              heroes={data.heroes}
              research={research}
              onSave={saveResearch}
            />
          )}
          {view === "Dashboard" &&
            (!filtered.length ? (
              <section className="panel player-empty compact-empty">
                <Swords size={26} />
                <h2>
                  {data.history.length
                    ? "No matches match these filters."
                    : "No public matches available yet."}
                </h2>
                <p>
                  {data.history.length
                    ? "Try a different hero, mode, or period."
                    : "Check your account ID and try Refresh later. Private or unindexed data may be unavailable."}
                </p>
              </section>
            ) : (
              <div className="performance-grid">
                <section className="panel hero-performance">
                  <div className="section-heading">
                    <div>
                      <h2>Hero performance</h2>
                      <p>Win rates across your filtered matches.</p>
                    </div>
                    <Swords size={19} className="muted" />
                  </div>
                  {heroes.slice(0, 8).map((h) => (
                    <div className="hero-stat-row" key={h.heroId}>
                      <div className="hero-portrait">
                        {heroImage(h.heroId) ? (
                          <img
                            src={heroImage(h.heroId)}
                            alt=""
                            onError={(e) => {
                              e.currentTarget.hidden = true;
                            }}
                          />
                        ) : (
                          <Swords size={17} />
                        )}
                      </div>
                      <div className="hero-stat-name">
                        <strong>{heroName(h.heroId)}</strong>
                        <small>
                          {h.count} matches · {number(h.kda, 2)} KDA
                        </small>
                      </div>
                      <div className="hero-winrate">
                        <strong>
                          {h.winRate === null
                            ? "—"
                            : `${number(h.winRate, 1)}%`}
                        </strong>
                        <span>
                          <i style={{ width: `${h.winRate ?? 0}%` }} />
                        </span>
                      </div>
                    </div>
                  ))}
                  {heroes.length > 8 && (
                    <p className="muted">
                      Showing the eight most-played heroes in this view.
                    </p>
                  )}
                </section>
                <section className="panel recent-matches">
                  <div className="section-heading">
                    <div>
                      <h2>Recent results</h2>
                      <p>Your latest available matches.</p>
                    </div>
                    <Crosshair size={19} className="muted" />
                  </div>
                  <div className="recent-list">
                    {filtered.slice(0, 8).map((m) => (
                      <details
                        key={m.match_id}
                        className={`recent-match ${outcome(m)}`}
                      >
                        <summary>
                          <span className="result-indicator">
                            {outcome(m) === "win"
                              ? "W"
                              : outcome(m) === "loss"
                                ? "L"
                                : "—"}
                          </span>
                          <div>
                            <strong>{heroName(m.hero_id)}</strong>
                            <small>
                              {new Date(
                                m.start_time * 1000,
                              ).toLocaleDateString()}{" "}
                              ·{" "}
                              {m.game_mode !== null && m.game_mode !== undefined
                                ? gameModeName(m.game_mode)
                                : "Mode unavailable"}
                            </small>
                          </div>
                          <span className="match-kda">
                            {number(m.player_kills)} / {number(m.player_deaths)}{" "}
                            / {number(m.player_assists)}
                          </span>
                          <span className="match-duration">
                            {m.match_duration_s === null
                              ? "—"
                              : formatClock(m.match_duration_s)}
                          </span>
                          <ArrowRight size={12} />
                        </summary>
                        <div className="match-detail-grid">
                          <span>
                            Match ID<strong>{m.match_id}</strong>
                          </span>
                          <span>
                            Final net worth
                            <strong>{number(m.net_worth)}</strong>
                          </span>
                          <span>
                            Last hits<strong>{number(m.last_hits)}</strong>
                          </span>
                          <span>
                            Denies<strong>{number(m.denies)}</strong>
                          </span>
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
