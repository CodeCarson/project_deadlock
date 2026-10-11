import { it, expect, vi } from "vitest";
import { ApiClient, matchSchema, type CacheEntry } from "../src/core/api";
import { parseStatlockerHistory, statlockerUrl } from "../src/core/statlocker";
const row = (match_id: number, patch = {}) => ({
  match_id,
  hero_id: 1,
  start_time: match_id,
  player_kills: 3,
  player_team: 0,
  match_result: 0,
  ...patch,
});
const envelope = (rows: unknown[], patch = {}) => ({
  accountId: "1234",
  matchHistory: rows,
  profileAggregateStats: { accountId: "1234", totalMatches: 506 },
  ...patch,
});
function setup() {
  const entries = new Map<string, CacheEntry>();
  let time = 10000000;
  const fetcher = vi.fn<typeof fetch>();
  const api = new ApiClient(
    {
      get: async (key) => entries.get(key),
      set: async (key, entry) => {
        entries.set(key, entry);
      },
    },
    fetcher,
    () => time,
  );
  return {
    api,
    fetcher,
    entries,
    advance: () => {
      time += 300001;
    },
  };
}
it("normalizes known outcomes, preserves missing metrics and rejects mismatched accounts/modes", () => {
  const parsed = parseStatlockerHistory(
    envelope([
      row(1),
      row(2, { match_result: 1 }),
      row(3, { player_team: null }),
    ]),
    1234,
    1,
  );
  expect(parsed.matches.find((m) => m.match_id === 1)).toMatchObject({
    account_id: 1234,
    game_mode: 1,
    player_match_outcome: 1,
    net_worth: null,
  });
  expect(
    parsed.matches.find((m) => m.match_id === 2)?.player_match_outcome,
  ).toBe(2);
  expect(
    parsed.matches.find((m) => m.match_id === 3)?.player_match_outcome,
  ).toBeNull();
  expect(() =>
    parseStatlockerHistory(envelope([row(1, { account_id: 456 })]), 1234, 1),
  ).toThrow();
  expect(() =>
    parseStatlockerHistory(envelope([row(1)], { accountId: "456" }), 1234, 1),
  ).toThrow();
  expect(() =>
    parseStatlockerHistory(envelope([row(1, { game_mode: 4 })]), 1234, 1),
  ).toThrow();
  expect(() => statlockerUrl(0, 1)).toThrow();
  expect(statlockerUrl(1234, 1)).toBe(
    "https://statlocker.gg/api/profile/data/matches/1234/true?gameMode=1",
  );
});
it("merges all available games without duplicates, keeps better primary fields, caches and persists the union", async () => {
  const { api, entries, fetcher } = setup();
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("statlocker.gg"))
      return new Response(
        JSON.stringify(
          envelope(
            String(url).endsWith("=1")
              ? Array.from({ length: 506 }, (_, i) => row(i + 1))
              : [],
          ),
        ),
      );
    return new Response(
      JSON.stringify(
        Array.from({ length: 260 }, (_, i) =>
          matchSchema.parse({
            ...row(i + 247),
            player_kills: 8,
            account_id: 1234,
          }),
        ),
      ),
      { headers: { "Called-Steam": "false" } },
    );
  });
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(result.data).toHaveLength(506);
  expect(
    (result.data as any[]).find((m) => m.match_id === 506).player_kills,
  ).toBe(8);
  expect(entries.get("history-1234")?.data).toHaveLength(506);
  expect(result.historyChecks?.map((c) => c.count)).toEqual([260, 506]);
  expect(result.historyChecks?.[1].reportedTotal).toBe(506);
  await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("keeps collected games when Statlocker becomes unavailable and avoids erasing primary history", async () => {
  const { api, fetcher, advance } = setup();
  let denied = false;
  fetcher.mockImplementation(async (url) =>
    String(url).includes("statlocker.gg")
      ? denied
        ? new Response("", { status: 403 })
        : new Response(
            JSON.stringify(
              envelope(String(url).endsWith("=1") ? [row(1)] : []),
            ),
          )
      : new Response(JSON.stringify([row(2)])),
  );
  await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  denied = true;
  advance();
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
    refresh: true,
  });
  expect(result.data).toHaveLength(2);
  expect(result.historyChecks?.[1]).toMatchObject({
    status: "unavailable",
    count: 0,
  });
  expect(result.historyChecks?.[1].message).toContain("retained");
});
it("can serve Statlocker games when the primary API fails, and labels partial mode coverage", async () => {
  const { api, fetcher } = setup();
  fetcher.mockImplementation(async (url) =>
    String(url).includes("statlocker.gg") && String(url).endsWith("=1")
      ? new Response(JSON.stringify(envelope([row(1)])))
      : new Response("", { status: 503 }),
  );
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(result.data).toHaveLength(1);
  expect(result.historyChecks?.map((c) => c.status)).toEqual([
    "unavailable",
    "partial",
  ]);
  expect(result.warning).toContain("503");
});
it("rejects incompatible secondary data without relabeling or poisoning the saved archive", async () => {
  const { api, fetcher, entries } = setup();
  fetcher.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("statlocker.gg")
            ? envelope([row(1)], { accountId: "456" })
            : [row(2)],
        ),
      ),
  );
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(result.data).toHaveLength(1);
  expect(entries.get("history-1234")?.data).toHaveLength(1);
  expect(result.historyChecks?.[1].status).toBe("unavailable");
});
it("automatically requests older Steam pages after bot access is confirmed, once per hour", async () => {
  const { api, fetcher } = setup();
  let primaryCalls = 0;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("statlocker.gg"))
      return new Response("", { status: 403 });
    primaryCalls++;
    return new Response(
      JSON.stringify(
        String(url).includes("force_refetch=true")
          ? [row(1), row(2)]
          : [row(2)],
      ),
      { headers: { "Called-Steam": "true" } },
    );
  });
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(result.data).toHaveLength(2);
  expect(result.forceFetchedAt).toBeDefined();
  expect(primaryCalls).toBe(2);
  await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(primaryCalls).toBe(2);
});

it("retains recent games and cools down automatic rebuilds even when older-page access fails", async () => {
  const { api, fetcher, advance } = setup();
  let rebuilds = 0;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("statlocker.gg"))
      return new Response("", { status: 403 });
    if (String(url).includes("force_refetch=true")) {
      rebuilds++;
      return new Response("", { status: 429 });
    }
    return new Response(JSON.stringify([row(2)]), {
      headers: { "Called-Steam": "true" },
    });
  });
  const result = await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(result.data).toHaveLength(1);
  expect(result.forceFetchedAt).toBeDefined();
  advance();
  await api.request({
    resource: "history",
    accountId: 1234,
    includeStatlocker: true,
  });
  expect(rebuilds).toBe(1);
});
