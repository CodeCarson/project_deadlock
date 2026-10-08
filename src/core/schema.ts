import { z } from "zod";
import defaults from "../../config/timing-rules.json" with { type: "json" };
const seconds = z.number().int().min(0).max(86400);
export const ruleSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    category: z.enum(["camp", "breakable", "objective", "custom"]),
    mode: z.enum(["once", "interval", "conditional"]),
    firstSpawn: seconds.nullable(),
    repeatSeconds: seconds.min(1).nullable(),
    respawnSeconds: seconds.min(1).nullable(),
    enabled: z.boolean(),
    confirmed: z.boolean(),
    source: z.string().max(500),
    location: z.string().max(100),
  })
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (r.category === "camp" && r.mode !== "conditional")
      fail("Camps must use conditional respawns.");
    if (r.confirmed && r.category !== "custom" && !r.source.trim())
      fail("Add a timing source or patch note for game events.");
    if (r.enabled && !r.confirmed)
      fail("Confirm a timing rule before enabling it.");
    if (r.enabled && r.mode !== "conditional" && r.firstSpawn === null)
      fail("A scheduled reminder needs a first event time.");
    if (r.enabled && r.mode === "interval" && r.repeatSeconds === null)
      fail("Repeating schedules need an interval.");
    if (
      r.enabled &&
      r.mode === "conditional" &&
      r.firstSpawn === null &&
      r.respawnSeconds === null
    )
      fail("A conditional rule needs a first spawn or respawn delay.");
  });
export type Rule = z.infer<typeof ruleSchema>;
export const settingsSchema = z
  .object({
    version: z.literal(1),
    volume: z.number().min(0).max(1),
    sound: z.enum(["chime", "pulse", "bell"]),
    speech: z.boolean(),
    compact: z.boolean(),
    warnings: z.array(z.number().int().min(1).max(300)).max(5),
    rules: z.array(ruleSchema).max(100),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.rules.map((r) => r.id)).size !== s.rules.length)
      ctx.addIssue({ code: "custom", message: "Rule IDs must be unique." });
  });
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = settingsSchema.parse({
  version: 1,
  volume: 0.65,
  sound: "chime",
  speech: false,
  compact: false,
  warnings: [15],
  rules: defaults.rules,
});
export type TimerStatus = "stopped" | "running" | "paused";
export interface Occurrence {
  key: string;
  ruleId: string;
  name: string;
  location: string;
  at: number;
  kind: "spawn" | "respawn";
}
export interface Alert {
  id: string;
  name: string;
  message: string;
  at: number;
  warning: number;
  late: boolean;
}
export interface TimerSnapshot {
  status: TimerStatus;
  seconds: number;
  upcoming: Occurrence[];
  cleared: Record<string, number>;
  log: Alert[];
}
export type TimerCommand =
  | { type: "start" | "pause" | "stop" | "reset" }
  | { type: "sync"; seconds: number }
  | { type: "clear" | "undo-clear"; ruleId: string };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["start", "pause", "stop", "reset"]) }),
  z.object({ type: z.literal("sync"), seconds }),
  z.object({
    type: z.enum(["clear", "undo-clear"]),
    ruleId: z.string().min(1).max(80),
  }),
]);
export interface Bridge {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getTimer(): Promise<TimerSnapshot>;
  command(command: TimerCommand): Promise<TimerSnapshot>;
  onTimer(callback: (snapshot: TimerSnapshot) => void): () => void;
  onAlert(callback: (alert: Alert) => void): () => void;
}

export function errorMessage(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues.map((issue) => issue.message).join(" ");
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
