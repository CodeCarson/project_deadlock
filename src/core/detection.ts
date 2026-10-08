import { z } from "zod";
import type { TimerEngine } from "./timer.js";
import type { TimerCommand, TimerSnapshot } from "./schema.js";

const matchId = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const helperPacketSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clock"),
      matchId,
      seconds: z.number().int().min(0).max(86400),
      paused: z.boolean(),
      observedAt: z.number().int().positive(),
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("end"),
      matchId,
      observedAt: z.number().int().positive(),
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      message: z.enum(["ready", "waiting", "error"]),
      observedAt: z.number().int().positive(),
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type HelperPacket = z.infer<typeof helperPacketSchema>;

/** Only fresh, authenticated local game-clock events can take ownership of reminders. */
export class MatchDetection {
  private enabled = false;
  private connected = false;
  private matchId?: string;
  private lastClockAt?: number;
  private manualOverride = false;
  private following = false;
  private ended = new Set<string>();
  private message = "Automatic tracking is off";
  constructor(
    private engine: TimerEngine,
    private now = () => Date.now(),
  ) {}
  configure(enabled: boolean) {
    if (enabled === this.enabled) return;
    if (this.following) this.engine.command({ type: "pause" });
    this.enabled = enabled;
    this.following = false;
    this.manualOverride = false;
    this.message = enabled
      ? "Waiting for the Overwolf helper"
      : "Automatic tracking is off";
  }
  connection(connected: boolean) {
    this.connected = connected;
    if (!connected && this.following) {
      this.engine.command({ type: "pause" });
      this.following = false;
    }
    if (this.enabled && !this.manualOverride)
      this.message = connected
        ? "Waiting for a live game clock"
        : "Helper disconnected — automatic reminders paused";
  }
  error(message: string) {
    this.message = message;
  }
  manual(command: TimerCommand) {
    if (this.enabled && !["clear", "undo-clear"].includes(command.type)) {
      this.manualOverride = true;
      this.following = false;
      this.message = "Manual control for this match";
    }
  }
  resume() {
    this.manualOverride = false;
    this.following = false;
    if (this.enabled) this.message = "Waiting for a fresh game-clock event";
  }
  receive(packet: HelperPacket) {
    if (
      !this.enabled ||
      !this.connected ||
      this.now() - packet.observedAt > 4000 ||
      packet.observedAt - this.now() > 2000
    )
      return;
    if (packet.kind === "status") {
      if (!this.following && !this.manualOverride)
        this.message =
          packet.message === "error"
            ? "Overwolf events unavailable — use manual controls"
            : "Waiting for a live game clock";
      return;
    }
    if (packet.kind === "end") {
      this.ended.add(packet.matchId);
      if (this.ended.size > 100)
        this.ended.delete(this.ended.values().next().value!);
      if (packet.matchId === this.matchId && this.following)
        this.engine.command({ type: "stop" });
      if (packet.matchId === this.matchId) {
        this.following = false;
        this.message = "Match ended";
      }
      return;
    }
    if (this.ended.has(packet.matchId)) return;
    const newMatch = packet.matchId !== this.matchId;
    if (newMatch) {
      this.matchId = packet.matchId;
      this.manualOverride = false;
      this.following = false;
      this.engine.command({ type: "reset" });
    }
    this.lastClockAt = packet.observedAt;
    if (this.manualOverride) return;
    // A reconnect or large correction rebases without replaying reminders from the past.
    const rebase =
      !this.following || Math.abs(this.engine.seconds() - packet.seconds) > 5;
    this.engine.followClock(packet.seconds, packet.paused, rebase);
    this.following = true;
    this.message = packet.paused
      ? "Following Deadlock — game paused"
      : "Following Deadlock’s game clock";
  }
  check() {
    if (
      this.following &&
      this.lastClockAt !== undefined &&
      this.now() - this.lastClockAt > 5000
    ) {
      this.engine.command({ type: "pause" });
      this.following = false;
      this.message = "Game-clock events missing — automatic reminders paused";
    }
  }
  snapshot(): NonNullable<TimerSnapshot["detection"]> {
    return {
      connected: this.connected,
      message: this.message,
      matchId: this.matchId,
      lastClockAt: this.lastClockAt,
      manualOverride: this.manualOverride,
    };
  }
}
