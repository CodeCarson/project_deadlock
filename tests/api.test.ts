import { describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  apiPath,
  parseAccount,
  matchSchema,
  summarise,
  heroSummaries,
  safeImage,
  type CacheEntry,
} from "../src/core/api";
const fixture = (overrides = {}) =>
  matchSchema.parse({
    match_id: 123,
    hero_id: 1,
    start_time: 100,
    account_id: 1234,
    player_kills: 8,
    player_deaths: 2,
    player_assists: 6,
    net_worth: 12000,
    match_duration_s: 1200,
    player_match_outcome: 1,
    ...overrides,
  });
function setup(data: unknown = [fixture()]) {
  let time = 1000000;
  const entries = new Map<string, CacheEntry>();
  const cache = {
    get: vi.fn(async (key: string) => entries.get(key)),
    set: vi.fn(async (key: string, entry: CacheEntry) => {
      entries.set(key, entry);
    }),
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(data));
  return {
    client: new ApiClient(cache, fetcher, () => time),
    cache,
    entries,
    fetcher,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const request = { resource: "history" as const, accountId: 1234 };
describe("public player identity and statistics", () => {
  it("accepts supported numeric IDs and profile links without requesting Steam credentials", () => {
    for (const input of [
      "1234",
      "76561197960266962",
      "[U:1:1234]",
      "https://steamcommunity.com/profiles/76561197960266962",
      "https://statlocker.gg/profile/1234",
      "https://deadlocktracker.gg/profile/1234/",
    ])
      expect(parseAccount(input)).toBe(1234);
  });
  it("rejects vanity names, misleading hosts, unsupported Steam IDs and invalid bounds", () => {
    for (const input of [
      "0",
      "-1",
      "4294967296",
      "76561197960265728",
      "76561202255233024",
      "https://steamcommunity.com/id/person",
      "https://steamcommunity.com.evil.test/profiles/1234",
      "https://constructor/profiles/1234",
      "https://user:pass@steamcommunity.com/profiles/1234",
      "http://steamcommunity.com/profiles/1234",
    ])
      expect(() => parseAccount(input)).toThrow();
    expect(parseAccount("4294967295")).toBe(4294967295);
    expect(() => apiPath({ resource: "history" })).toThrow();
    expect(apiPath({ resource: "profile", accountId: 1234 })).toBe(
      "/v1/players/steam?account_ids=1234",
    );
    expect(() => apiPath({ resource: "history", accountId: -2 })).toThrow();
    expect(() => apiPath({ resource: "arbitrary" } as never)).toThrow();
  });
  it("excludes unscored games from win rate and handles unavailable metrics honestly", () => {
    const matches = [
      fixture(),
      fixture({ match_id: 124, player_match_outcome: 2 }),
      fixture({
        match_id: 125,
        hero_id: 2,
        player_match_outcome: 5,
        match_duration_s: 0,
      }),
    ];
    expect(summarise(matches)).toMatchObject({
      count: 3,
      wins: 1,
      losses: 1,
      unscored: 1,
      winRate: 50,
      kda: 7,
      networthPerMinute: 600,
      economyCount: 2,
    });
    expect(heroSummaries(matches).map((h) => [h.heroId, h.count])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(
      summarise([fixture({ player_kills: undefined, net_worth: null })]),
    ).toMatchObject({ kills: null, kda: null, networthPerMinute: null });
    expect(summarise([])).toMatchObject({ count: 0, winRate: null, kda: null });
    expect(summarise([fixture({ player_deaths: 0 })]).kda).toBe(14);
    expect(() => fixture({ match_id: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
  it("allows only safe HTTPS image URLs", () => {
    expect(safeImage("https://assets.deadlock-api.com/image.png")).toBe(
      "https://assets.deadlock-api.com/image.png",
    );
    for (const input of [
      "javascript:alert(1)",
      "file:///tmp/file",
      "http://host.test/x",
      "https://user:pass@host.test/x",
      null,
    ])
      expect(safeImage(input)).toBeUndefined();
  });
});
describe("API transport and offline cache", () => {
  it("deduplicates concurrent fetches, uses the cache, and expires player data after five minutes", async () => {
    const { client, fetcher, advance } = setup();
    const results = await Promise.all([
      client.request(request),
      client.request(request),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ cached: false, stale: false });
    expect((await client.request(request)).cached).toBe(true);
    advance(300001);
    await client.request(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.deadlock-api.com/v1/players/1234/match-history",
    );
  });
  it("limits rapid force-refresh calls and requests Steam refresh after the cooldown", async () => {
    const { client, fetcher, advance } = setup();
    await client.request(request);
    expect(
      (await client.request({ ...request, refresh: true })).warning,
    ).toContain("30 seconds");
    advance(30001);
    await client.request({ ...request, refresh: true });
    expect(String(fetcher.mock.calls[1][0])).toContain("force_refetch=true");
  });
  it("retains verified cached results with a visible warning on rate limits and malformed responses", async () => {
    const { client, fetcher, advance } = setup();
    const live = await client.request(request);
    advance(300001);
    fetcher.mockResolvedValueOnce(new Response("", { status: 429 }));
    const offline = await client.request(request);
    expect(offline).toMatchObject({
      data: live.data,
      cached: true,
      stale: true,
      fetchedAt: live.fetchedAt,
    });
    expect(offline.warning).toContain("rate limit");
    fetcher.mockResolvedValueOnce(Response.json({ wrong: "shape" }));
    expect((await client.request(request)).warning).toContain("incompatible");
  });
  it("rejects account-mismatched history and card responses rather than mislabelling them", async () => {
    const { client } = setup([fixture({ account_id: 999 })]);
    await expect(client.request(request)).rejects.toThrow("incompatible");
    const card = setup({ account_id: 999 });
    await expect(
      card.client.request({ resource: "card", accountId: 1234 }),
    ).rejects.toThrow("incompatible");
  });
  it("ignores incompatible cache entries and survives cache read/write failures", async () => {
    const { client, cache, entries, fetcher } = setup();
    entries.set("history-1234", {
      version: 1,
      data: [fixture({ account_id: 999 })],
      fetchedAt: 1000000,
    });
    await client.request(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    cache.get.mockRejectedValueOnce(new Error("read failure"));
    cache.set.mockRejectedValueOnce(new Error("disk full"));
    const result = await client.request(request);
    expect(result).toMatchObject({ cached: false, stale: false });
    expect(result.warning).toContain("could not save");
  });
  it("reports an outage without showing sample data when no valid cache exists", async () => {
    const { client, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(client.request(request)).rejects.toThrow(
      "Network unavailable",
    );
  });
  it("uses a one-day lifetime for hero assets and rejects future cache timestamps", async () => {
    const { client, entries, fetcher, advance } = setup([
      { id: 1, name: "Hero" },
    ]);
    await client.request({ resource: "heroes" });
    advance(300001);
    expect((await client.request({ resource: "heroes" })).cached).toBe(true);
    entries.set("heroes-all", { version: 1, data: [], fetchedAt: 999999999 });
    await client.request({ resource: "heroes" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(86400001);
    await client.request({ resource: "heroes" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
