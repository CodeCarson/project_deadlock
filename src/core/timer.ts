import {
  commandSchema,
  type Alert,
  type Occurrence,
  type Rule,
  type Settings,
  type TimerCommand,
  type TimerSnapshot,
  type TimerStatus,
} from "./schema.js";

/** The scheduler runs in Electron's main process; UI frame rate never advances the clock. */
export class TimerEngine {
  private status: TimerStatus = "stopped";
  private base = 0;
  private anchor = 0;
  private previous = 0;
  private cleared: Record<string, number> = Object.create(null);
  private generations: Record<string, number> = Object.create(null);
  private fired = new Set<string>();
  private log: Alert[] = [];
  private settings: Settings;
  constructor(
    settings: Settings,
    private now: () => number = () => performance.now(),
  ) {
    this.settings = settings;
  }
  seconds() {
    return (
      this.base +
      (this.status === "running"
        ? Math.max(0, this.now() - this.anchor) / 1000
        : 0)
    );
  }
  private occurrences(rule: Rule, from: number, to: number): Occurrence[] {
    if (!rule.enabled || !rule.confirmed) return [];
    const result: Occurrence[] = [];
    const add = (at: number, key: string, kind: Occurrence["kind"]) => {
      if (at >= from && at <= to)
        result.push({
          key: `${rule.id}:${key}`,
          ruleId: rule.id,
          name: rule.name,
          location: rule.location,
          at,
          kind,
          ...(rule.windowSeconds ? { windowEnd: at + rule.windowSeconds } : {}),
        });
    };
    if (rule.mode === "conditional" && this.cleared[rule.id] !== undefined) {
      if (rule.respawnSeconds !== null)
        add(
          this.cleared[rule.id] + rule.respawnSeconds,
          `clear-${this.generations[rule.id]}`,
          "respawn",
        );
    } else if (rule.firstSpawn !== null) {
      if (rule.mode === "interval" && rule.repeatSeconds !== null) {
        const start = Math.max(
          0,
          Math.ceil((from - rule.firstSpawn) / rule.repeatSeconds),
        );
        const end = Math.min(
          start + 10000,
          Math.floor((to - rule.firstSpawn) / rule.repeatSeconds),
        );
        for (let i = start; i <= end; i++)
          add(
            rule.firstSpawn + i * rule.repeatSeconds,
            `scheduled-${i}`,
            "spawn",
          );
      } else add(rule.firstSpawn, "first", "spawn");
    }
    return result;
  }
  updateSettings(settings: Settings) {
    // Editing rules/warnings must not generate a catch-up burst at the current clock.
    this.settings = settings;
    this.previous = this.seconds();
  }
  snapshot(): TimerSnapshot {
    const seconds = this.seconds();
    return {
      status: this.status,
      seconds,
      cleared: { ...this.cleared },
      log: [...this.log],
      upcoming: this.settings.rules
        .flatMap((r) =>
          this.occurrences(
            r,
            seconds - (r.windowSeconds ?? 0),
            seconds + 86400,
          ),
        )
        .sort((a, b) => a.at - b.at)
        .slice(0, 24),
    };
  }
  tick(): Alert[] {
    if (this.status !== "running") return [];
    const seconds = this.seconds();
    const alerts: Alert[] = [];
    const warnings = [...new Set([0, ...this.settings.warnings])];
    const maxWarning = Math.max(...warnings);
    for (const rule of this.settings.rules) {
      for (const event of this.occurrences(
        rule,
        this.previous,
        seconds + maxWarning,
      )) {
        for (const warning of warnings) {
          const at = event.at - warning;
          const key = `${event.key}:warning-${warning}`;
          if (
            at < 0 ||
            at < this.previous ||
            at > seconds ||
            this.fired.has(key)
          )
            continue;
          this.fired.add(key);
          // Short scheduling delays are delivered; obsolete alerts after suspend are consumed silently.
          if (seconds - at > 5 || (warning > 0 && seconds >= event.at))
            continue;
          const name = event.location
            ? `${event.name} (${event.location})`
            : event.name;
          const eventLabel =
            event.kind === "respawn" && rule.category === "breakable"
              ? "earliest respawn"
              : event.kind === "respawn"
                ? "respawn"
                : "event";
          alerts.push({
            id: key,
            name,
            at,
            warning,
            late: seconds - at > 1,
            message: event.windowEnd
              ? warning
                ? `${name} window begins in ${warning} seconds`
                : `${name} window begins now`
              : warning
                ? `${name}${eventLabel === "earliest respawn" ? " earliest respawn" : ""} in ${warning} seconds`
                : `${name} ${eventLabel} now`,
          });
        }
      }
    }
    alerts.sort((a, b) => a.at - b.at);
    this.previous = seconds;
    this.log = [...alerts, ...this.log].slice(0, 30);
    return alerts;
  }
  command(raw: TimerCommand) {
    const command = commandSchema.parse(raw);
    const current = this.seconds();
    switch (command.type) {
      case "start":
        if (this.status !== "running") {
          this.base = current;
          this.anchor = this.now();
          this.previous = current;
          this.status = "running";
        }
        break;
      case "pause":
      case "stop":
        this.base = current;
        this.status = command.type === "pause" ? "paused" : "stopped";
        this.previous = current;
        break;
      case "reset":
        this.base = 0;
        this.previous = 0;
        this.status = "stopped";
        this.cleared = Object.create(null);
        this.generations = Object.create(null);
        this.fired.clear();
        this.log = [];
        break;
      case "sync":
        // Rebase without replaying crossed events. Fired occurrences survive a backward correction.
        this.base = command.seconds;
        this.anchor = this.now();
        this.previous = command.seconds;
        break;
      case "clear": {
        const rule = this.settings.rules.find((r) => r.id === command.ruleId);
        if (
          !rule ||
          !rule.enabled ||
          !rule.confirmed ||
          rule.mode !== "conditional" ||
          rule.respawnSeconds === null
        )
          throw new Error(
            "Configure and enable a conditional respawn rule first.",
          );
        this.cleared[rule.id] = current;
        this.generations[rule.id] = (this.generations[rule.id] ?? 0) + 1;
        break;
      }
      case "undo-clear":
        delete this.cleared[command.ruleId];
        break;
    }
    return this.snapshot();
  }
}
export function formatClock(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}
export function parseClock(value: string): number {
  if (!/^\d{1,4}:[0-5]\d$/.test(value.trim()))
    throw new Error("Use minutes:seconds, for example 01:45.");
  const [m, s] = value.trim().split(":").map(Number);
  const seconds = m * 60 + s;
  if (seconds > 86400) throw new Error("Clock must be less than 24 hours.");
  return seconds;
}
