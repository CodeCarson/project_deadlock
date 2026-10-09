import { bridge } from "../core/bridge";
import { heroBenchmarkSchema, metricsSchema, type Match } from "../core/api";
import { durationBand, referenceKey, type Evidence } from "../core/performance";
import { z } from "zod";
export async function loadEvidence(
  matches: Match[],
  cancelled = () => false,
  onProgress?: (done: number, total: number) => void,
) {
  const scopes = [
    ...new Map(
      matches
        .filter(
          (m) =>
            (m.game_mode === 1 || m.game_mode === 4) &&
            [1, 4].includes(m.match_mode ?? 0) &&
            (m.match_duration_s ?? 0) > 0,
        )
        .map((m) => [referenceKey(m), m]),
    ).values(),
  ].slice(0, 64);
  const evidence: Evidence = {};
  const errors: string[] = [];
  let next = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, scopes.length) }, async () => {
      while (next < scopes.length && !cancelled()) {
        const match = scopes[next++];
        const options = {
          analysisMode: match.game_mode as 1 | 4,
          durationBand: durationBand(match.match_duration_s!),
        };
        try {
          const [distribution, counts] = await Promise.all([
            bridge.request({
              resource: "metrics",
              heroId: match.hero_id,
              ...options,
            }),
            bridge.request({ resource: "heroBenchmarks", ...options }),
          ]);
          const metrics = metricsSchema.parse(distribution.data);
          const count =
            z
              .array(heroBenchmarkSchema)
              .parse(counts.data)
              .find((h) => h.hero_id === match.hero_id)?.matches ?? 0;
          evidence[referenceKey(match)] = {
            metrics,
            matches: count,
            fetchedAt: Math.min(distribution.fetchedAt, counts.fetchedAt),
            stale: distribution.stale || counts.stale,
          };
        } catch (e) {
          errors.push(
            e instanceof Error ? e.message : "Reference data unavailable",
          );
        }
        onProgress?.(++done, scopes.length);
      }
    }),
  );
  return { evidence, errors: [...new Set(errors)] };
}
