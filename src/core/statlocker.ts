import { z } from "zod";
import { matchSchema, parseAccount, mergeHistory, type Match } from "./api.js";

export const historyCheckSchema = z.object({
  provider: z.enum(["Deadlock API", "Statlocker"]),
  status: z.enum(["available", "partial", "unavailable"]),
  count: z.number().int().nonnegative(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  fetchedAt: z.number().finite().nonnegative(),
  message: z.string(),
});
export type HistoryCheck = z.infer<typeof historyCheckSchema>;
const envelope = z.object({
  accountId: z.union([z.string(), z.number()]).optional(),
  matchHistory: z.array(z.record(z.string(), z.unknown())).max(10000),
  profileAggregateStats: z
    .object({
      accountId: z.union([z.string(), z.number()]).optional(),
      totalMatches: z.number().int().nonnegative().nullable().optional(),
    })
    .nullish(),
});

/** Published Statlocker profile endpoint; never accepts a renderer-supplied URL. */
export function statlockerUrl(accountId: number, gameMode: 1 | 4) {
  if (!Number.isInteger(accountId) || accountId < 1 || accountId > 4294967295)
    throw new Error("Invalid Steam account.");
  return `https://statlocker.gg/api/profile/data/matches/${accountId}/true?gameMode=${gameMode}`;
}
export function parseStatlockerHistory(
  raw: unknown,
  accountId: number,
  gameMode: 1 | 4,
) {
  const data = envelope.parse(raw);
  for (const identity of [
    data.accountId,
    data.profileAggregateStats?.accountId,
  ]) {
    if (identity !== undefined && parseAccount(String(identity)) !== accountId)
      throw new Error("Statlocker returned another player's profile.");
  }
  const matches = data.matchHistory.map((row) => {
    if (
      row.account_id !== undefined &&
      parseAccount(String(row.account_id)) !== accountId
    )
      throw new Error("Statlocker returned another player's match.");
    // Preserve missing fields as null. A team outcome is valid only for known teams.
    const validTeams =
      [0, 1].includes(Number(row.match_result)) &&
      [0, 1].includes(Number(row.player_team)) &&
      row.match_result != null &&
      row.player_team != null;
    const outcome = validTeams
      ? Number(row.match_result) === Number(row.player_team)
        ? 1
        : 2
      : null;
    const match = matchSchema.parse({
      ...row,
      account_id: accountId,
      game_mode: row.game_mode ?? gameMode,
      player_match_outcome: row.player_match_outcome ?? outcome,
    });
    if (match.game_mode !== gameMode)
      throw new Error("Statlocker returned a different game mode.");
    return match;
  });
  return {
    matches: mergeHistory([], matches),
    total: data.profileAggregateStats?.totalMatches ?? null,
  };
}

export async function fetchStatlockerHistory(
  accountId: number,
  fetcher: typeof fetch,
  now: () => number,
) {
  const modes = [1, 4] as const;
  const responses = await Promise.allSettled(
    modes.map(async (mode) => {
      const response = await fetcher(statlockerUrl(accountId, mode), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Statlocker access denied; its public endpoint may require a key."
            : response.status === 429
              ? "Statlocker rate limit reached."
              : `Statlocker returned HTTP ${response.status}.`,
        );
      try {
        return parseStatlockerHistory(await response.json(), accountId, mode);
      } catch {
        throw new Error(
          "Statlocker returned an unsupported or mismatched profile response.",
        );
      }
    }),
  );
  let matches: Match[] = [];
  const errors: string[] = [];
  const totals: number[] = [];
  for (const [i, result] of responses.entries()) {
    if (result.status === "fulfilled") {
      matches = mergeHistory(matches, result.value.matches);
      if (result.value.total !== null) totals.push(result.value.total);
    } else
      errors.push(
        `${modes[i] === 1 ? "Normal" : "Street Brawl"}: ${result.reason instanceof Error ? result.reason.message : "Request failed."}`,
      );
  }
  const check: HistoryCheck = {
    provider: "Statlocker",
    status:
      errors.length === 2
        ? "unavailable"
        : errors.length
          ? "partial"
          : "available",
    count: matches.length,
    // The aggregate may describe a different scope than the returned list. Never sum or call it a career total.
    reportedTotal: totals.length ? Math.max(...totals) : null,
    fetchedAt: now(),
    message:
      errors.join(" ") ||
      "Normal and Street Brawl checked. Other modes are not covered by this source.",
  };
  return { matches, check };
}
