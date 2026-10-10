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
/** Local monotonic timer; sparse visible-clock checks correct drift and detect pauses. */
export class ClockReader {
  private enabled = false;
  private override = false;
  private following = false;
  private previous?: { seconds: number; at: number };
  private candidate?: { seconds: number; at: number };
  private lastValidAt?: number;
  private lostAt?: number;
  private stable = 0;
  private pair = false;
  private nextAt = 0;
  private expired = false;
  private syncSeconds = 15;
  private graceSeconds = 90;
  private message = "Automatic tracking is off";
  private match = 0;
  constructor(
    private engine: TimerEngine,
    private now = () => Date.now(),
  ) {}
  configure(enabled: boolean, syncSeconds = 15, graceSeconds = 90) {
    this.syncSeconds = syncSeconds;
    this.graceSeconds = graceSeconds;
    if (enabled === this.enabled) return;
    if (this.following) this.engine.command({ type: "pause" });
    this.enabled = enabled;
    this.following = false;
    this.override = false;
    this.previous = undefined;
    this.candidate = undefined;
    this.lastValidAt = undefined;
    this.lostAt = undefined;
    this.expired = false;
    this.stable = 0;
    this.nextAt = this.now();
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
    this.lastValidAt = undefined;
    this.expired = false;
    this.stable = 0;
    this.nextAt = this.now();
    if (this.enabled) this.message = "Waiting for a readable clock";
  }
  nextSampleDelay() {
    if (!this.enabled || this.override) return 5000;
    return Math.max(100, this.nextAt - this.now());
  }
  reading(text: string, confidence: number, observedAt: number) {
    if (!this.enabled || this.override) return;
    const seconds = recognisedClock(text, confidence);
    const age = this.now() - observedAt;
    if (
      seconds === null ||
      age > 3000 ||
      age < -1000 ||
      (this.previous && observedAt <= this.previous.at)
    ) {
      this.missing();
      return;
    }
    const old = this.previous;
    const newMatch = old && old.seconds > 60 && seconds <= 15;
    if (newMatch) {
      const c = this.candidate;
      this.engine.command({ type: "pause" });
      if (
        !c ||
        seconds < c.seconds ||
        seconds - c.seconds > (observedAt - c.at) / 1000 + 2 ||
        observedAt - c.at < 1500
      ) {
        this.candidate = { seconds, at: observedAt };
        this.nextAt = this.now() + 1500;
        this.message = "Confirming a new match clock";
        return;
      }
      this.engine.command({ type: "reset" });
      this.match++;
      this.stable = 0;
    } else if (old) {
      const elapsed = (observedAt - old.at) / 1000;
      if (seconds < old.seconds - 1 || seconds - old.seconds > elapsed + 3) {
        this.missing();
        this.message =
          "Clock changed unexpectedly — local timer retained; check crop or Sync";
        return;
      }
    }
    if (!this.following && !this.match) {
      // Joining a manually started match must preserve marks and delivered alerts.
      this.match++;
    }
    // Identical integer clocks closer than 1.5 seconds can just be rounding.
    const paused =
      !newMatch &&
      !!old &&
      seconds === old.seconds &&
      observedAt - old.at >= 1500;
    const drift = Math.abs(
      this.engine.seconds() - seconds - Math.max(0, age) / 1000,
    );
    this.engine.followClock(
      seconds + (paused ? 0 : Math.max(0, age) / 1000),
      paused,
      !this.following || newMatch || this.expired || paused || drift > 2,
      true,
    );
    this.following = true;
    this.expired = false;
    this.previous = { seconds, at: observedAt };
    this.lastValidAt = observedAt;
    this.lostAt = undefined;
    this.candidate = undefined;
    this.stable++;
    if (paused) {
      this.nextAt = this.now() + 2500;
      this.message = "Two unchanged readings — game paused";
    } else {
      // Three initial readings, then two-reading bursts separated by sparse intervals.
      const quick = this.stable < 3 || !this.pair;
      this.pair = quick;
      this.nextAt = this.now() + (quick ? 1500 : this.syncSeconds * 1000);
      this.message =
        this.stable < 3
          ? "Local timer running — confirming initial sync"
          : "Local timer running — sparse sync checks";
    }
  }
  missing() {
    if (!this.enabled || this.override) return;
    this.lostAt ??= this.now();
    this.candidate = undefined;
    this.nextAt = this.now() + (this.following ? 5000 : 2500);
    this.check();
    if (!this.following)
      this.message = "Clock unavailable — waiting for a readable clock";
    else if (!this.expired)
      this.message =
        this.engine.snapshot().status === "paused"
          ? "Clock hidden — keeping the detected pause"
          : "Clock hidden — local timer continues briefly";
  }
  check() {
    if (
      !this.enabled ||
      this.override ||
      !this.following ||
      this.lastValidAt === undefined
    )
      return;
    if (this.now() - this.lastValidAt > this.graceSeconds * 1000) {
      this.engine.command({ type: "pause" });
      this.expired = true;
      this.message = "Sync lost for too long — paused until clock returns";
    }
  }
  snapshot(): NonNullable<TimerSnapshot["detection"]> {
    return {
      connected: this.following && !this.expired,
      manualOverride: this.override,
      message: this.message,
      lastClockAt: this.lastValidAt,
      nextCheckAt: this.enabled && !this.override ? this.nextAt : undefined,
      holdoverSeconds: this.graceSeconds,
      matchId: this.match ? `screen-${this.match}` : undefined,
    };
  }
}
