import type { TimerEngine } from "./timer.js";
import type { TimerCommand, TimerSnapshot } from "./schema.js";
import { parseClock } from "./timer.js";
export function recognisedClock(
  text: string,
  confidence: number,
): number | null {
  const value = text.trim();
  if (
    !Number.isFinite(confidence) ||
    confidence < 80 ||
    !/^\d{1,3}:[0-5]\d$/.test(value)
  )
    return null;
  try {
    return parseClock(value);
  } catch {
    return null;
  }
}
/** Screen clocks are sampled, never extrapolated while unreadable or paused. */
export class ClockReader {
  private enabled = false;
  private override = false;
  private following = false;
  private lastValidAt?: number;
  private previous?: { seconds: number; at: number };
  private candidate?: { seconds: number; at: number; count: number };
  private lastChangeAt = 0;
  private lostAt?: number;
  private message = "Automatic tracking is off";
  private match = 0;
  constructor(
    private engine: TimerEngine,
    private now = () => Date.now(),
  ) {}
  configure(enabled: boolean) {
    if (enabled === this.enabled) return;
    if (
      this.following ||
      (enabled && this.engine.snapshot().status === "running")
    )
      this.engine.command({ type: "pause" });
    this.enabled = enabled;
    this.following = false;
    this.override = false;
    this.candidate = undefined;
    this.lostAt ??= this.now();
    this.message = enabled
      ? "Waiting for a readable clock"
      : "Automatic tracking is off";
  }
  error(message: string) {
    this.message = message;
  }
  manual(command: TimerCommand) {
    if (this.enabled && !["clear", "undo-clear"].includes(command.type)) {
      this.override = true;
      this.following = false;
      this.candidate = undefined;
      this.message = "Manual control — resume automatic tracking when ready";
    }
  }
  resume() {
    if (this.enabled) this.engine.command({ type: "pause" });
    this.override = false;
    this.following = false;
    this.candidate = undefined;
    this.previous = undefined;
    if (this.enabled)
      this.message = "Waiting for two consistent clock readings";
  }
  reading(text: string, confidence: number, observedAt: number) {
    if (!this.enabled || this.override) return;
    const seconds = recognisedClock(text, confidence);
    if (
      seconds === null ||
      this.now() - observedAt > 3000 ||
      observedAt > this.now() + 1000
    ) {
      this.missing();
      return;
    }
    const old = this.previous;
    // A new near-zero clock is accepted only after the previous clock disappeared.
    const newMatch =
      old &&
      old.seconds > 30 &&
      seconds <= 15 &&
      this.lostAt !== undefined &&
      this.now() - this.lostAt >= 15000;
    if (old && !newMatch) {
      const delta = seconds - old.seconds;
      const elapsed = Math.max(0, observedAt - old.at) / 1000;
      if (delta < -1 || delta > elapsed + 3) {
        this.missing();
        this.message =
          "Clock changed unexpectedly — check the crop or use manual Sync";
        return;
      }
    }
    if (newMatch) {
      this.following = false;
      if ((this.candidate?.seconds ?? 99) > 15) this.candidate = undefined;
    }
    if (!this.following) {
      const c = this.candidate;
      const consistent =
        c &&
        seconds >= c.seconds &&
        seconds - c.seconds <= (observedAt - c.at) / 1000 + 2;
      this.candidate = {
        seconds,
        at: observedAt,
        count: consistent ? c.count + 1 : 1,
      };
      this.message = "Confirming clock — keep the game visible";
      if (this.candidate.count < 2) return;
      if ((!old && !this.match) || newMatch) {
        this.engine.command({ type: "reset" });
        this.match++;
      }
      this.engine.followClock(seconds, false, true, false);
      this.following = true;
      this.lastChangeAt = observedAt;
    } else {
      if (!old || old.seconds !== seconds) this.lastChangeAt = observedAt;
      const paused = observedAt - this.lastChangeAt >= 2500;
      this.engine.followClock(seconds, paused, false, false);
    }
    this.previous = { seconds, at: observedAt };
    this.lastValidAt = observedAt;
    this.lostAt = undefined;
    this.message =
      observedAt - this.lastChangeAt >= 2500
        ? "Clock stopped — reminders paused"
        : "Following the visible game clock";
  }
  missing() {
    if (!this.enabled || this.override) return;
    this.lostAt ??= this.now();
    this.candidate = undefined;
    if (this.following) this.engine.command({ type: "pause" });
    this.following = false;
    this.message = "Clock unavailable — automatic reminders paused";
  }
  check() {
    if (
      this.following &&
      this.lastValidAt !== undefined &&
      this.now() - this.lastValidAt > 3000
    )
      this.missing();
  }
  snapshot(): NonNullable<TimerSnapshot["detection"]> {
    return {
      connected: this.following,
      manualOverride: this.override,
      message: this.message,
      lastClockAt: this.lastValidAt,
      matchId: this.match ? `screen-${this.match}` : undefined,
    };
  }
}
