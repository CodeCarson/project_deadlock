import { z } from "zod";
import type { ApiRequest, ApiResult } from "./api.js";
import defaults from "../../config/timing-rules.json" with { type: "json" };
const seconds = z.number().int().min(0).max(86400);
export const captureRegionSchema = z
  .object({
    x: z.number().int().min(-100000).max(100000),
    y: z.number().int().min(-100000).max(100000),
    width: z.number().int().min(40).max(640),
    height: z.number().int().min(20).max(160),
  })
  .strict();
export type CaptureRegion = z.infer<typeof captureRegionSchema>;
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
    windowSeconds: seconds.min(1).nullable().optional(),
    note: z.string().max(600).optional(),
  })
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (r.category === "camp" && r.mode !== "conditional")
      fail("Camps must use conditional respawns.");
    if (r.windowSeconds && r.mode !== "conditional")
      fail(
        "Variable spawn windows must be tracked from a manually observed event.",
      );
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
    presetRevision: z.number().int().nonnegative().default(0),
    accountId: z
      .string()
      .regex(/^$|^[1-9][0-9]{0,9}$/)
      .refine(
        (value) => !value || Number(value) <= 4294967295,
        "Invalid Steam account ID.",
      )
      .default(""),
    playerResearch: z
      .record(
        z.string().regex(/^[1-9][0-9]{0,9}$/),
        z.object({
          ratingHistory: z
            .array(
              z.object({
                score: z.number().finite().min(0).max(100),
                count: z.number().int().min(10).max(60),
                mode: z.union([z.literal(1), z.literal(4)]),
                at: z.number().finite().nonnegative(),
                anchor: z.number().int().positive().safe(),
                model: z.union([z.literal(1), z.literal(2)]),
              }),
            )
            .max(50)
            .default([]),
          expectedTotal: z
            .number()
            .int()
            .min(1)
            .max(100000)
            .nullable()
            .default(null),
          notes: z
            .array(
              z.object({
                matchId: z.number().int().positive().safe(),
                text: z.string().max(1500),
              }),
            )
            .max(500)
            .default([]),
          goal: z
            .object({
              metric: z.enum(["deaths", "combat", "farm"]),
              target: z.number().finite().nonnegative().max(10000),
              baseline: z.number().finite().nonnegative(),
              anchor: z.number().int().positive().safe(),
              hero: z.string(),
              mode: z.number().int(),
              createdAt: z.number().nonnegative(),
            })
            .nullable()
            .default(null),
        }),
      )
      .default({}),
    planner: z
      .object({
        mode: z.union([z.literal(1), z.literal(4)]).default(1),
        cohort: z.enum(["ranked", "elite"]).default("ranked"),
        accountIds: z
          .array(z.string().regex(/^$|^[1-9][0-9]{0,9}$/))
          .length(6)
          .default(["", "", "", "", "", ""]),
        locks: z
          .array(z.number().int().nonnegative().safe())
          .length(6)
          .default([0, 0, 0, 0, 0, 0]),
        preference: z
          .enum(["comfort", "balanced", "explore"])
          .default("balanced"),
        excluded: z
          .array(z.number().int().positive().safe())
          .max(100)
          .default([]),
        favorites: z
          .array(z.array(z.number().int().positive().safe()).max(12))
          .length(6)
          .default([[], [], [], [], [], []]),
      })
      .default({
        mode: 1,
        cohort: "ranked",
        accountIds: ["", "", "", "", "", ""],
        locks: [0, 0, 0, 0, 0, 0],
        preference: "balanced",
        excluded: [],
        favorites: [[], [], [], [], [], []],
      }),
    playerFilters: z
      .object({
        hero: z.string(),
        mode: z.string(),
        days: z.enum(["all", "7", "30", "90"]),
      })
      .default({ hero: "all", mode: "all", days: "all" }),
    volume: z.number().min(0).max(1),
    sound: z.enum([
      "chime",
      "pulse",
      "bell",
      "knock",
      "radio",
      "glass",
      "whistle",
    ]),
    speech: z.boolean(),
    voiceId: z.string().max(300).default(""),
    voiceStyle: z.enum(["operator", "lookout"]).default("operator"),
    alertSpeed: z.number().finite().min(0.75).max(2).default(1.35),
    autoRefreshStats: z.boolean().default(true),
    combinedBreakables: z.boolean().default(false),
    automaticTracking: z.boolean().default(false),
    clockSyncSeconds: z.number().int().min(5).max(60).default(15),
    clockGraceSeconds: z.number().int().min(5).max(300).default(90),
    captureRegion: captureRegionSchema.nullable().default(null),
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
  presetRevision: (defaults as { revision?: number }).revision ?? 0,
  volume: 0.65,
  sound: "chime",
  speech: false,
  combinedBreakables: true,
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
  windowEnd?: number;
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
  detection?: {
    connected: boolean;
    message: string;
    matchId?: string;
    lastClockAt?: number;
    nextCheckAt?: number;
    holdoverSeconds?: number;
    manualOverride: boolean;
  };
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
  captureDisplays(): Promise<
    {
      id: string;
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[]
  >;
  previewClock(region: CaptureRegion): Promise<{
    image: string;
    text: string;
    confidence: number;
    processedImage?: string;
  }>;
  resumeAutomaticTracking(): Promise<void>;
  request(request: ApiRequest): Promise<ApiResult>;
  importHistory(accountId: number, archive: unknown): Promise<ApiResult>;
  recoverHistory(
    accountId: number,
    matchIds: number[],
  ): Promise<{ recovered: number; errors: string[] }>;
  alertVoices(): Promise<{ id: string; name: string }[]>;
  stopAlertSpeech(): Promise<void>;
  speakAlert(
    text: string,
    voiceId: string,
    speed: number,
    volume: number,
  ): Promise<void>;
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

export const timingNote: string = defaults.note;
