import { describe, it, expect, vi } from "vitest";
import {
  ApiClient,
  apiPath,
  matchSchema,
  mergeHistory,
  type CacheEntry,
} from "../src/core/api";
const m = (id: number, patch = {}) =>
  matchSchema.parse({
    match_id: id,
    account_id: 1234,
    hero_id: 1,
    start_time: id,
    player_kills: 4,
    ...patch,
  });
function client() {
  const entries = new Map<string, CacheEntry>();
  const fetcher = vi.fn<typeof fetch>();
  let now = 10000000;
  const api = new ApiClient(
    {
      get: async (key) => entries.get(key),
      set: async (key, value) => {
        entries.set(key, value);
      },
    },
    fetcher,
    () => now,
  );
  return {
    api,
    fetcher,
    entries,
    advance: () => {
      now += 300001;
    },
  };
}
describe("profile suggestions and durable history", () => {
  it("encodes names on the fixed host, requires bounds", () => {
    expect(apiPath({ resource: "search", query: "A&B/../../" })).toContain(
      "search_query=A%26B%2F..%2F..%2F",
    );
    expect(apiPath({ resource: "search", query: "Carson" })).toContain(
      "min_matches_played_last_30d=0",
    );
    expect(() => apiPath({ resource: "search", query: "x" })).toThrow();
  });
  it("deduplicates a search and keeps query cache filenames bounded and safe", async () => {
    const { api, fetcher, entries } = client();
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify([{ account_id: 1, personaname: "same name" }]),
      ),
    );
    await Promise.all([
      api.request({ resource: "search", query: "Carson" }),
      api.request({ resource: "search", query: "carson" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([...entries.keys()][0]).toMatch(/^search-[a-f0-9]{64}$/);
  });
  it("preserves older matches and good fields when refreshed responses shrink", async () => {
    const { api, fetcher, advance } = client();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify([m(1), m(2)]), {
        headers: { "Called-Steam": "false" },
      }),
    );
    await api.request({ resource: "history", accountId: 1234 });
    advance();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify([m(2, { player_kills: null }), m(3)])),
    );
    const result = await api.request({ resource: "history", accountId: 1234 });
    expect(result.data).toHaveLength(3);
    expect(result.providerCount).toBe(2);
    expect(result.retainedCount).toBe(1);
    expect(
      (result.data as any[]).find((x) => x.match_id === 2).player_kills,
    ).toBe(4);
    expect(mergeHistory([m(1)], [m(1), m(1)])).toHaveLength(1);
  });
});
