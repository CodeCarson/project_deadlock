import { z } from "zod";

const count = z.number().finite().nonnegative();
const metric = count.nullish().transform((value) => value ?? null);
const id = count.int().safe();
export const matchSchema = z.object({
  match_id: id,
  hero_id: id,
  start_time: count.int(),
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
  images: z
    .object({
      icon_image_small: z.string().nullish(),
      icon_image_small_webp: z.string().nullish(),
    })
    .nullish(),
});
export type Hero = z.infer<typeof heroSchema>;
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
export const apiRequestSchema = z.object({
  resource: z.enum(["history", "profile", "card", "heroes", "ranks"]),
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
  historySource?: "steam" | "stored" | "unknown";
}
export const CACHE_VERSION = 1;
export interface CacheEntry {
  version: typeof CACHE_VERSION;
  data: unknown;
  fetchedAt: number;
  historySource?: "steam" | "stored" | "unknown";
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
  forceFetchedAt: z.number().finite().nonnegative().optional(),
});
export function validateResource(
  resource: ApiRequest["resource"],
  data: unknown,
) {
  switch (resource) {
    case "history":
      return z.array(matchSchema).parse(data);
    case "heroes":
      return z.array(heroSchema).parse(data);
    case "profile":
      return z.array(profileSchema).parse(data);
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
  if (request.resource === "heroes")
    return "/v1/assets/heroes?only_active=true";
  if (request.resource === "ranks") return "/v1/assets/ranks";
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
  request(raw: ApiRequest) {
    const request = apiRequestSchema.parse(raw);
    apiPath(request); // Validate player IDs even when an entry already exists in the cache.
    const key = `${request.resource}-${request.accountId ?? "all"}`;
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
    const ttl =
      request.resource === "heroes" || request.resource === "ranks"
        ? 86400000
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
      const entry: CacheEntry = {
        version: CACHE_VERSION,
        data,
        fetchedAt: this.now(),
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
