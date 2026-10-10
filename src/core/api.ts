import { z } from "zod";

const count = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metric = count.nullish().transform((value) => value ?? null);
const id = count.int().safe();
export const matchSchema = z.object({
  match_id: id,
  hero_id: id,
  start_time: count.int().max(8640000000000),
  account_id: id.optional(),
  game_mode: z.number().int().nullish(),
  match_mode: z.number().int().nullish(),
  player_kills: metric,
  player_deaths: metric,
  player_assists: metric,
  match_duration_s: metric,
  net_worth: metric,
  denies: metric,
  last_hits: metric,
  player_match_outcome: z.number().int().nullish(),
  ranked_display_badge: metric,
});
export type Match = z.infer<typeof matchSchema>;
export const heroSchema = z.object({
  id,
  name: z.string(),
  hero_type: z.string().nullish(),
  description: z
    .object({ role: z.string().nullish(), playstyle: z.string().nullish() })
    .nullish(),
  images: z
    .object({
      icon_image_small: z.string().nullish(),
      icon_image_small_webp: z.string().nullish(),
    })
    .nullish(),
});
export type Hero = z.infer<typeof heroSchema>;
export const quantilesSchema = z
  .object({
    avg: count,
    std: count,
    percentile1: count,
    percentile5: count,
    percentile10: count,
    percentile25: count,
    percentile50: count,
    percentile75: count,
    percentile90: count,
    percentile95: count,
    percentile99: count,
  })
  .refine(
    (q) =>
      [
        q.percentile1,
        q.percentile5,
        q.percentile10,
        q.percentile25,
        q.percentile50,
        q.percentile75,
        q.percentile90,
        q.percentile95,
        q.percentile99,
      ].every((v, i, a) => !i || v >= a[i - 1]),
    "Invalid quantile ordering",
  );
export const metricsSchema = z.record(z.string(), quantilesSchema);
export type MetricDistribution = z.infer<typeof quantilesSchema>;
export const heroBenchmarkSchema = z.object({
  hero_id: id,
  matches: count.int(),
  wins: count.int(),
  losses: count.int(),
});
export const synergySchema = z
  .object({
    hero_id1: id,
    hero_id2: id,
    wins: count.int(),
    matches_played: count.int(),
  })
  .refine((r) => r.hero_id1 !== r.hero_id2 && r.wins <= r.matches_played);
export const compositionSchema = z
  .object({
    hero_ids: z.array(id).min(3).max(6),
    wins: count.int(),
    losses: count.int(),
    matches: count.int(),
  })
  .refine(
    (r) =>
      new Set(r.hero_ids).size === r.hero_ids.length &&
      r.wins + r.losses <= r.matches,
  );
export type Synergy = z.infer<typeof synergySchema>;
export type Composition = z.infer<typeof compositionSchema>;
export const profileSchema = z.object({
  account_id: id,
  personaname: z.string(),
  avatarfull: z.string().nullish(),
});
export type Profile = z.infer<typeof profileSchema>;
export const cardSchema = z.object({
  account_id: id,
  ranked_badge_level: metric,
  ranked_rank: metric,
  ranked_subrank: metric,
});
export type Card = z.infer<typeof cardSchema>;
export const rankSchema = z.object({ tier: id, name: z.string() });
export type Rank = z.infer<typeof rankSchema>;
export const sampleSchema = z.object({
  time_stamp_s: count,
  net_worth: metric,
  player_damage: metric,
  boss_damage: metric,
  player_healing: metric,
  teammate_healing: metric,
  kills: metric,
  deaths: metric,
  assists: metric,
  creep_kills: metric,
  neutral_kills: metric,
  gold_death_loss: metric,
  gold_lane_creep: metric,
  gold_lane_creep_orbs: metric,
  gold_neutral_creep: metric,
  gold_neutral_creep_orbs: metric,
  gold_player: metric,
  gold_player_orbs: metric,
  gold_boss: metric,
  gold_boss_orb: metric,
  gold_treasure: metric,
  gold_denied: metric,
});
export const detailPlayerSchema = z.object({
  account_id: id,
  hero_id: id,
  team: z.number().int(),
  kills: metric,
  deaths: metric,
  assists: metric,
  net_worth: metric,
  last_hits: metric,
  denies: metric,
  player_match_outcome: z.number().int().nullish(),
  stats: z
    .array(sampleSchema)
    .max(10000)
    .nullish()
    .transform((v) => v ?? []),
  death_details: z
    .array(z.object({ game_time_s: count, death_duration_s: metric }))
    .max(1000)
    .nullish()
    .transform((v) => v ?? []),
  items: z
    .array(z.object({ game_time_s: count, item_id: id, sold_time_s: metric }))
    .max(1000)
    .nullish()
    .transform((v) => v ?? []),
});
export const metadataSchema = z.object({
  match_info: z.object({
    match_id: id,
    start_time: count,
    duration_s: count,
    game_mode: z.number().int().nullish(),
    match_mode: z.number().int().nullish(),
    winning_team: z.number().int().nullish(),
    players: z.array(detailPlayerSchema).max(100),
  }),
});
export type MatchMetadata = z.infer<typeof metadataSchema>;
export const itemSchema = z.object({ id, name: z.string() });
export type Item = z.infer<typeof itemSchema>;
export const archiveSchema = z
  .object({
    format: z.literal("deadlock-companion-history"),
    version: z.literal(1),
    accountId: z.number().int().min(1).max(4294967295),
    matches: z.array(matchSchema).max(10000),
  })
  .superRefine((a, ctx) => {
    if (a.matches.some((m) => m.account_id !== a.accountId))
      ctx.addIssue({
        code: "custom",
        message: "Archive contains unverified or another player's matches.",
      });
  });
export function mergeHistory(saved: Match[], fresh: Match[]) {
  const matches = new Map(saved.map((m) => [m.match_id, m]));
  for (const m of fresh) {
    const old = matches.get(m.match_id);
    matches.set(
      m.match_id,
      old
        ? (Object.fromEntries(
            Object.entries(m).map(([k, v]) => [
              k,
              v ?? old[k as keyof Match] ?? v,
            ]),
          ) as Match)
        : m,
    );
  }
  return [...matches.values()].sort(
    (a, b) => b.start_time - a.start_time || b.match_id - a.match_id,
  );
}
export const apiRequestSchema = z.object({
  resource: z.enum([
    "history",
    "profile",
    "card",
    "heroes",
    "ranks",
    "search",
    "metadata",
    "items",
    "metrics",
    "heroBenchmarks",
    "synergy",
    "compositions",
  ]),
  heroId: id.positive().optional(),
  analysisMode: z.union([z.literal(1), z.literal(4)]).optional(),
  durationBand: z.number().int().min(0).max(3).optional(),
  cohort: z.enum(["ranked", "elite"]).optional(),
  query: z.string().trim().min(2).max(80).optional(),
  matchId: id.positive().optional(),
  accountId: z.number().int().min(1).max(4294967295).optional(),
  refresh: z.boolean().optional(),
  forceRefetch: z.boolean().optional(),
});
export type ApiRequest = z.infer<typeof apiRequestSchema>;
export interface ApiResult {
  data: unknown;
  fetchedAt: number;
  cached: boolean;
  stale: boolean;
  warning?: string;
  forceFetchedAt?: number;
  historySource?: "steam" | "stored" | "unknown";
  providerCount?: number;
  retainedCount?: number;
}
export const CACHE_VERSION = 1;
export interface CacheEntry {
  version: typeof CACHE_VERSION;
  data: unknown;
  fetchedAt: number;
  historySource?: "steam" | "stored" | "unknown";
  providerCount?: number;
  retainedCount?: number;
  forceFetchedAt?: number;
}
export interface CacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, entry: CacheEntry): Promise<void>;
}
const cacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  data: z.unknown(),
  fetchedAt: z.number().finite().nonnegative(),
  historySource: z.enum(["steam", "stored", "unknown"]).optional(),
  providerCount: id.optional(),
  retainedCount: id.optional(),
  forceFetchedAt: z.number().finite().nonnegative().optional(),
});
export function validateResource(
  resource: ApiRequest["resource"],
  data: unknown,
) {
  switch (resource) {
    case "metrics":
      return metricsSchema.parse(data);
    case "heroBenchmarks":
      return z.array(heroBenchmarkSchema).max(1000).parse(data);
    case "synergy":
      return z.array(synergySchema).max(10000).parse(data);
    case "compositions":
      return z.array(compositionSchema).max(100000).parse(data);
    case "history":
      return z.array(matchSchema).parse(data);
    case "heroes":
      return z.array(heroSchema).parse(data);
    case "profile":
    case "search":
      return z.array(profileSchema).max(1000).parse(data);
    case "metadata":
      return metadataSchema.parse(data);
    case "items":
      return z.array(itemSchema).parse(data);
    case "card":
      return cardSchema.parse(data);
    case "ranks":
      return z.array(rankSchema).parse(data);
  }
}
export function parseAccount(input: string): number {
  let value = input.trim();
  if (value.startsWith("https://")) {
    const url = new URL(value);
    if (url.username || url.password || url.port)
      throw new Error("Use a supported public profile link.");
    const paths: Record<string, RegExp> = {
      "steamcommunity.com": /^\/profiles\/(\d+)\/?$/,
      "statlocker.gg": /^\/profile\/(\d+)\/?$/,
      "deadlocktracker.gg": /^\/profile\/(\d+)\/?$/,
    };
    const match = Object.hasOwn(paths, url.hostname)
      ? paths[url.hostname].exec(url.pathname)
      : undefined;
    if (!match)
      throw new Error(
        "Use a numeric Steam account ID, Steam /profiles/ link, or supported /profile/ link. Vanity names need a numeric ID.",
      );
    value = match[1];
  }
  const steam3 = /^\[U:1:(\d+)\]$/.exec(value);
  if (steam3) value = steam3[1];
  if (!/^\d{1,20}$/.test(value))
    throw new Error(
      "Enter a numeric Steam account ID or supported profile link.",
    );
  let n = BigInt(value);
  if (n >= 76561197960265728n) n -= 76561197960265728n;
  if (n < 1n || n > 4294967295n)
    throw new Error("That is not a valid individual Steam account ID.");
  return Number(n);
}
export function apiPath(raw: ApiRequest) {
  const request = apiRequestSchema.parse(raw);
  if (
    ["metrics", "heroBenchmarks", "synergy", "compositions"].includes(
      request.resource,
    )
  ) {
    if (!request.analysisMode)
      throw new Error("Choose Normal or Street Brawl for reference data.");
    const params = new URLSearchParams({
      game_mode: request.analysisMode === 1 ? "normal" : "street_brawl",
      min_unix_timestamp: String(
        Math.floor(Date.now() / 86400000) * 86400 - 30 * 86400,
      ),
    });
    if (
      request.resource === "metrics" ||
      request.resource === "heroBenchmarks"
    ) {
      if (request.durationBand === undefined)
        throw new Error("A duration band is required.");
      params.set("match_mode", "ranked,unranked");
      const limits = [0, 1200, 1800, 2400, 14400];
      params.set("min_duration_s", String(limits[request.durationBand]));
      params.set(
        "max_duration_s",
        String(limits[request.durationBand + 1] - 1),
      );
      if (request.resource === "metrics") {
        if (!request.heroId)
          throw new Error("A hero is required for the comparison.");
        params.set("hero_ids", String(request.heroId));
      }
      return `/v1/analytics/${request.resource === "metrics" ? "player-stats/metrics" : "hero-stats"}?${params}`;
    }
    params.set("match_mode", "ranked");
    if (request.cohort === "elite") params.set("min_average_badge", "101");
    params.set("min_matches", "20");
    if (request.resource === "compositions")
      params.set("comb_size", request.analysisMode === 1 ? "6" : "3");
    return `/v1/analytics/${request.resource === "synergy" ? "hero-synergy-stats" : "hero-comb-stats"}?${params}`;
  }
  if (request.resource === "heroes")
    return "/v1/assets/heroes?only_active=true";
  if (request.resource === "ranks") return "/v1/assets/ranks";
  if (request.resource === "items") return "/v1/assets/items";
  if (request.resource === "search") {
    if (!request.query)
      throw new Error("Enter at least two characters to search.");
    return `/v1/players/steam-search?search_query=${encodeURIComponent(request.query)}&limit=8&min_matches_played_last_30d=0`;
  }
  if (request.resource === "metadata") {
    if (!request.matchId) throw new Error("A match ID is required.");
    return `/v1/matches/${request.matchId}/metadata?disable_steam=true`;
  }
  if (!request.accountId) throw new Error("A player account ID is required.");
  switch (request.resource) {
    case "history":
      return `/v1/players/${request.accountId}/match-history${request.forceRefetch ? "?force_refetch=true" : ""}`;
    case "profile":
      return `/v1/players/steam?account_ids=${request.accountId}${request.refresh ? "&refresh=true" : ""}`;
    case "card":
      return `/v1/players/${request.accountId}/card`;
  }
}
/** Fixed-host API transport: the renderer supplies an enum and account ID, never a URL. */
export class ApiClient {
  private pending = new Map<string, Promise<ApiResult>>();
  private refreshing = new Map<string, number>();
  constructor(
    private cache: CacheStore,
    private fetcher: typeof fetch = (url, options) =>
      globalThis.fetch(url, options),
    private now: () => number = Date.now,
  ) {}
  async request(raw: ApiRequest) {
    const request = apiRequestSchema.parse(raw);
    apiPath(request); // Validate player IDs even when an entry already exists in the cache.
    const key =
      request.resource === "search"
        ? `search-${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.query!.toLowerCase())))].map((v) => v.toString(16).padStart(2, "0")).join("")}`
        : ["metrics", "heroBenchmarks", "synergy", "compositions"].includes(
              request.resource,
            )
          ? `${request.resource}-${request.analysisMode}-${request.resource === "metrics" ? request.heroId : "all"}-${request.durationBand ?? "all"}-${request.cohort ?? "ranked"}`
          : `${request.resource}-${request.resource === "metadata" ? request.matchId : (request.accountId ?? "all")}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const result = this.load(request, key).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, result);
    return result;
  }
  private async load(request: ApiRequest, key: string): Promise<ApiResult> {
    // A broken/quota-limited cache is not an API outage.
    let cached: CacheEntry | undefined;
    try {
      const stored = cacheSchema.parse(await this.cache.get(key));
      if (stored.fetchedAt <= this.now())
        cached = {
          ...stored,
          data: this.validate(request, stored.data),
        };
    } catch {
      /* Missing or incompatible entries are fetched again. */
    }
    const ttl = ["heroes", "ranks", "items", "metadata"].includes(
      request.resource,
    )
      ? 86400000
      : ["metrics", "heroBenchmarks", "synergy", "compositions"].includes(
            request.resource,
          )
        ? 21600000
        : 300000;
    if (
      cached &&
      !request.refresh &&
      !request.forceRefetch &&
      this.now() - cached.fetchedAt < ttl
    )
      return { ...cached, cached: true, stale: false };
    // Keep the provider's hourly full-rebuild limit across app restarts.
    if (
      request.resource === "history" &&
      request.forceRefetch &&
      cached?.forceFetchedAt !== undefined &&
      this.now() - cached.forceFetchedAt < 3600000
    )
      return {
        ...cached,
        cached: true,
        stale: false,
        warning:
          "Full history rebuild is limited to once per hour. Use normal Refresh for recent matches.",
      };
    if (
      request.refresh &&
      !request.forceRefetch &&
      cached &&
      this.now() - (this.refreshing.get(key) ?? -Infinity) < 30000
    )
      return {
        ...cached,
        cached: true,
        stale: false,
        warning: "Refreshed recently. Wait 30 seconds before refreshing again.",
      };
    try {
      const response = await this.fetcher(
        `https://api.deadlock-api.com${apiPath(request)}`,
        {
          signal: AbortSignal.timeout(15000),
          headers: { Accept: "application/json" },
          cache:
            request.refresh || request.forceRefetch ? "no-store" : "default",
        },
      );
      const storedFallback =
        response.status === 429 &&
        request.resource === "history" &&
        !request.forceRefetch;
      if (!response.ok && !storedFallback) {
        if (response.status === 429)
          throw new Error(
            request.forceRefetch
              ? "The API's hourly full-history limit was reached. Use normal Refresh or wait an hour."
              : "Deadlock API rate limit reached. Please wait before refreshing.",
          );
        if (response.status === 404)
          throw new Error(
            request.resource === "metadata"
              ? "Detailed data is not indexed for this match. Existing history and notes are kept."
              : "No public data was found for this account yet.",
          );
        if (response.status === 401 || response.status === 403)
          throw new Error(
            "Access to the public Deadlock API was denied. Check network access or API availability.",
          );
        throw new Error(`Deadlock API returned HTTP ${response.status}.`);
      }
      let data: unknown;
      try {
        data = this.validate(request, await response.json());
      } catch {
        if (storedFallback)
          throw new Error(
            "Deadlock API rate limit reached. Please wait before refreshing.",
          );
        throw new Error(
          "The API returned an incompatible response. Your saved data has been kept.",
        );
      }
      const providerCount =
        request.resource === "history"
          ? new Set((data as Match[]).map((m) => m.match_id)).size
          : undefined;
      if (request.resource === "history")
        data = mergeHistory((cached?.data ?? []) as Match[], data as Match[]);
      const entry: CacheEntry = {
        version: CACHE_VERSION,
        data,
        fetchedAt: this.now(),
        providerCount,
        retainedCount:
          providerCount === undefined
            ? undefined
            : (data as Match[]).length - providerCount,
        historySource:
          request.resource === "history"
            ? response.headers.get("Called-Steam") === "true"
              ? "steam"
              : response.headers.get("Called-Steam") === "false" ||
                  storedFallback
                ? "stored"
                : "unknown"
            : undefined,
        forceFetchedAt:
          request.forceRefetch && request.resource === "history"
            ? this.now()
            : cached?.forceFetchedAt,
      };
      this.refreshing.set(key, this.now());
      let warning: string | undefined = storedFallback
        ? "Provider rate limit reached; showing its stored history rather than a fresh Steam response."
        : undefined;
      try {
        await this.cache.set(key, entry);
      } catch {
        warning = [warning, "The app could not save the offline cache."]
          .filter(Boolean)
          .join(" ");
      }
      return { ...entry, cached: false, stale: storedFallback, warning };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "TimeoutError"
            ? "The Deadlock API took too long to respond."
            : error.message
          : "Could not reach the Deadlock API.";
      if (cached)
        return { ...cached, cached: true, stale: true, warning: message };
      throw new Error(
        `${message} Try Refresh when your connection is available.`,
      );
    }
  }
  async recoverHistory(accountId: number, rawIds: unknown) {
    apiPath({ resource: "history", accountId });
    const ids = [
      ...new Set(z.array(id.positive()).min(1).max(30).parse(rawIds)),
    ];
    const matches: Match[] = [],
      errors: string[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, ids.length) }, async () => {
        while (next < ids.length) {
          const matchId = ids[next++];
          try {
            const result = await this.request({
              resource: "metadata",
              matchId,
            });
            const info = metadataSchema.parse(result.data).match_info;
            const player = info.players.find((p) => p.account_id === accountId);
            if (!player) throw new Error("Your account is not in this match.");
            matches.push(
              matchSchema.parse({
                account_id: accountId,
                match_id: info.match_id,
                hero_id: player.hero_id,
                start_time: info.start_time,
                game_mode: info.game_mode,
                match_mode: info.match_mode,
                match_duration_s: info.duration_s,
                player_kills: player.kills,
                player_deaths: player.deaths,
                player_assists: player.assists,
                last_hits: player.last_hits,
                denies: player.denies,
                net_worth: player.net_worth,
                player_match_outcome:
                  player.player_match_outcome ??
                  ((info.winning_team === 0 || info.winning_team === 1) &&
                  (player.team === 0 || player.team === 1)
                    ? player.team === info.winning_team
                      ? 1
                      : 2
                    : null),
              }),
            );
          } catch (e) {
            errors.push(
              `#${matchId}: ${e instanceof Error ? e.message : "Unavailable"}`,
            );
          }
        }
      }),
    );
    if (matches.length)
      await this.importHistory(accountId, {
        format: "deadlock-companion-history",
        version: 1,
        accountId,
        matches,
      });
    return { recovered: matches.length, errors };
  }
  importHistory(accountId: number, raw: unknown): Promise<ApiResult> {
    apiPath({ resource: "history", accountId });
    const archive = archiveSchema.parse(raw);
    if (archive.accountId !== accountId)
      throw new Error("This archive belongs to another player.");
    const key = `history-${accountId}`;
    if (this.pending.has(key))
      throw new Error(
        "Wait for the history request to finish before importing.",
      );
    const operation = this.loadArchive(key, accountId, archive).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, operation);
    return operation;
  }
  private async loadArchive(
    key: string,
    accountId: number,
    archive: z.infer<typeof archiveSchema>,
  ): Promise<ApiResult> {
    let stored: CacheEntry | undefined;
    try {
      stored = cacheSchema.parse(await this.cache.get(key));
      stored.data = this.validate(
        { resource: "history", accountId },
        stored.data,
      );
    } catch {
      stored = undefined;
    }
    const matches = mergeHistory(
      (stored?.data ?? []) as Match[],
      archive.matches,
    );
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      data: matches,
      fetchedAt: stored?.fetchedAt ?? 0,
      historySource: stored?.historySource ?? "unknown",
      forceFetchedAt: stored?.forceFetchedAt,
      providerCount: stored?.providerCount,
      retainedCount: Math.max(0, matches.length - (stored?.providerCount ?? 0)),
    };
    await this.cache.set(key, entry);
    return {
      ...entry,
      cached: true,
      stale: !stored,
      warning:
        "Imported local archive. These records are preserved on refresh; coverage is still not guaranteed complete.",
    };
  }
  private validate(request: ApiRequest, raw: unknown) {
    const data = validateResource(request.resource, raw);
    if (
      request.resource === "card" &&
      (data as Card).account_id !== request.accountId
    )
      throw new Error("Player card belongs to another account.");
    if (
      request.resource === "history" &&
      (data as Match[]).some(
        (m) => m.account_id !== undefined && m.account_id !== request.accountId,
      )
    )
      throw new Error("Match history belongs to another account.");
    if (
      request.resource === "metadata" &&
      (data as MatchMetadata).match_info.match_id !== request.matchId
    )
      throw new Error("Metadata belongs to another match.");
    return data;
  }
}
export function outcome(match: Match): "win" | "loss" | "unscored" {
  return match.player_match_outcome === 1
    ? "win"
    : match.player_match_outcome === 2
      ? "loss"
      : "unscored";
}
export function summarise(matches: Match[]) {
  const wins = matches.filter((m) => outcome(m) === "win").length;
  const losses = matches.filter((m) => outcome(m) === "loss").length;
  const total = (key: "player_kills" | "player_deaths" | "player_assists") =>
    matches.length && matches.every((m) => m[key] !== null)
      ? matches.reduce((sum, m) => sum + m[key]!, 0)
      : null;
  const kills = total("player_kills"),
    deaths = total("player_deaths"),
    assists = total("player_assists");
  const economy = matches.filter(
    (m) =>
      m.net_worth !== null &&
      m.match_duration_s !== null &&
      m.match_duration_s > 0,
  );
  return {
    count: matches.length,
    wins,
    losses,
    unscored: matches.length - wins - losses,
    winRate: wins + losses ? (100 * wins) / (wins + losses) : null,
    kills,
    deaths,
    assists,
    kda:
      kills !== null && deaths !== null && assists !== null
        ? (kills + assists) / Math.max(1, deaths)
        : null,
    networthPerMinute: economy.length
      ? economy.reduce(
          (sum, m) => sum + m.net_worth! / (m.match_duration_s! / 60),
          0,
        ) / economy.length
      : null,
    economyCount: economy.length,
  };
}
export function heroSummaries(matches: Match[]) {
  const groups = new Map<number, Match[]>();
  for (const m of matches) {
    const group = groups.get(m.hero_id) ?? [];
    group.push(m);
    groups.set(m.hero_id, group);
  }
  return [...groups]
    .map(([heroId, entries]) => ({ heroId, ...summarise(entries) }))
    .sort((a, b) => b.count - a.count);
}
export function safeImage(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export const gameModeName = (mode: number) =>
  ({
    1: "Normal",
    2: "1v1 test",
    3: "Sandbox",
    4: "Street Brawl",
    5: "Explore NYC",
    6: "Internal",
  })[mode] ?? `Mode ${mode}`;
