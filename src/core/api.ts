import { z } from "zod";
import {
  fetchStatlockerHistory,
  historyCheckSchema,
  type HistoryCheck,
} from "./statlocker.js";

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
    "heroes",
    "search",
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
  accountId: z.number().int().min(1).max(4294967295).optional(),
  refresh: z.boolean().optional(),
  forceRefetch: z.boolean().optional(),
  includeStatlocker: z.boolean().optional(),
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
  historyChecks?: HistoryCheck[];
}
export const CACHE_VERSION = 1;
export interface CacheEntry {
  version: typeof CACHE_VERSION;
  data: unknown;
  fetchedAt: number;
  historySource?: "steam" | "stored" | "unknown";
  providerCount?: number;
  retainedCount?: number;
  historyChecks?: HistoryCheck[];
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
  historyChecks: z.array(historyCheckSchema).max(2).optional(),
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
  if (request.resource === "search") {
    if (!request.query)
      throw new Error("Enter at least two characters to search.");
    return `/v1/players/steam-search?search_query=${encodeURIComponent(request.query)}&limit=8&min_matches_played_last_30d=0`;
  }
  if (!request.accountId) throw new Error("A player account ID is required.");
  switch (request.resource) {
    case "history":
      return `/v1/players/${request.accountId}/match-history${request.forceRefetch ? "?force_refetch=true" : ""}`;
    case "profile":
      return `/v1/players/steam?account_ids=${request.accountId}${request.refresh ? "&refresh=true" : ""}`;
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
          : `${request.resource}-${request.accountId ?? "all"}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const result = (
      request.resource === "history" && request.includeStatlocker
        ? this.loadCombinedHistory(request, key)
        : this.load(request, key)
    ).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }
  private async loadCombinedHistory(
    request: ApiRequest,
    key: string,
  ): Promise<ApiResult> {
    const secondaryKey = `statlocker-${request.accountId}`;
    const secondary = async () => {
      try {
        const entry = cacheSchema.parse(await this.cache.get(secondaryKey));
        if (
          entry.fetchedAt <= this.now() &&
          this.now() - entry.fetchedAt < (request.refresh ? 30000 : 300000)
        ) {
          return {
            matches: this.validate(
              { resource: "history", accountId: request.accountId },
              entry.data,
            ) as Match[],
            check: historyCheckSchema.parse(entry.historyChecks?.[0]),
          };
        }
      } catch {
        /* A missing source cache is fetched independently. */
      }
      const result = await fetchStatlockerHistory(
        request.accountId!,
        this.fetcher,
        this.now,
      );
      // Keep a previously collected source archive even when access goes away.
      if (result.check.status === "unavailable") {
        try {
          const old = cacheSchema.parse(await this.cache.get(secondaryKey));
          result.matches = this.validate(
            { resource: "history", accountId: request.accountId },
            old.data,
          ) as Match[];
          result.check.message += ` ${result.matches.length} previously collected records retained.`;
        } catch {
          /* No previous source archive. */
        }
      }
      await this.cache
        .set(secondaryKey, {
          version: CACHE_VERSION,
          data: result.matches,
          fetchedAt: this.now(),
          historyChecks: [result.check],
        })
        .catch(() => {});
      return result;
    };
    const primaryHistory = async () => {
      const result = await this.load(request, key);
      // Once Steam access is confirmed, request its older pages automatically at most hourly.
      if (
        result.historySource === "steam" &&
        !request.forceRefetch &&
        (result.forceFetchedAt === undefined ||
          this.now() - result.forceFetchedAt >= 3600000)
      ) {
        try {
          const rebuilt = await this.load(
            { ...request, forceRefetch: true },
            key,
          );
          return { ...rebuilt, forceFetchedAt: this.now() };
        } catch (error) {
          return {
            ...result,
            forceFetchedAt: this.now(),
            warning:
              error instanceof Error
                ? error.message
                : "Older-history rebuild unavailable.",
          };
        }
      }
      return result;
    };
    const [primary, extra] = await Promise.allSettled([
      primaryHistory(),
      secondary(),
    ]);
    if (
      primary.status === "rejected" &&
      (extra.status === "rejected" ||
        (extra.value.check.status === "unavailable" &&
          !extra.value.matches.length))
    )
      throw primary.reason;
    const base: ApiResult =
      primary.status === "fulfilled"
        ? primary.value
        : {
            data: [],
            fetchedAt: 0,
            cached: false,
            stale: true,
            warning:
              primary.reason instanceof Error
                ? primary.reason.message
                : "Deadlock API unavailable.",
          };
    const additional =
      extra.status === "fulfilled"
        ? extra.value
        : {
            matches: [],
            check: {
              provider: "Statlocker" as const,
              status: "unavailable" as const,
              count: 0,
              reportedTotal: null,
              fetchedAt: this.now(),
              message: "Statlocker could not be checked.",
            },
          };
    // Primary provider wins overlapping fields; null primary fields keep secondary evidence.
    const matches = mergeHistory(additional.matches, base.data as Match[]);
    const checks: HistoryCheck[] = [
      {
        provider: "Deadlock API",
        status:
          primary.status === "rejected" || base.stale
            ? "unavailable"
            : "available",
        count: base.providerCount ?? (base.data as Match[]).length,
        reportedTotal: null,
        fetchedAt: base.fetchedAt,
        message:
          base.warning ??
          (base.historySource === "steam"
            ? "Steam history received."
            : "Indexed archive; full Steam history requires bot access."),
      },
      additional.check,
    ];
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      ...base,
      data: matches,
      historyChecks: checks,
      retainedCount: Math.max(0, matches.length - (base.providerCount ?? 0)),
    };
    let warning = base.warning;
    try {
      await this.cache.set(key, entry);
    } catch {
      warning = [warning, "The combined archive could not be saved."]
        .filter(Boolean)
        .join(" ");
    }
    return { ...base, ...entry, warning };
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
    const ttl = ["heroes"].includes(request.resource)
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
          throw new Error("No public data was found for this account yet.");
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
  private validate(request: ApiRequest, raw: unknown) {
    const data = validateResource(request.resource, raw);
    if (
      request.resource === "history" &&
      (data as Match[]).some(
        (m) => m.account_id !== undefined && m.account_id !== request.accountId,
      )
    )
      throw new Error("Match history belongs to another account.");
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
