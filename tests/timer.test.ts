import { describe, expect, it } from "vitest";
import { TimerEngine, formatClock, parseClock } from "../src/core/timer";
import {
  defaultSettings,
  ruleSchema,
  settingsSchema,
  type Rule,
} from "../src/core/schema";
const rule: Rule = {
  id: "small-a",
  name: "Small camp",
  category: "camp",
  mode: "conditional",
  firstSpawn: 120,
  repeatSeconds: null,
  respawnSeconds: 240,
  enabled: true,
  confirmed: true,
  source: "Test fixture only",
  location: "Amber rooftop",
};
function setup(rules: Rule[] = [rule], warnings = [15]) {
  let ms = 0;
  const settings = { ...structuredClone(defaultSettings), rules, warnings };
  const engine = new TimerEngine(settings, () => ms);
  const advance = (seconds: number) => {
    ms += seconds * 1000;
    return engine.tick();
  };
  return { engine, advance, settings };
}
describe("match clock and event scheduler", () => {
  it("warns at 1:45 and sends the first-spawn alert at 2:00 once", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    expect(advance(104.9)).toEqual([]);
    expect(advance(0.2).map((a) => a.warning)).toEqual([15]);
    expect(advance(0)).toEqual([]);
    expect(advance(14.9).map((a) => a.warning)).toEqual([0]);
    expect(advance(0.2)).toEqual([]);
  });
  it("uses elapsed time instead of the number of UI ticks", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(100);
    expect(engine.seconds()).toBe(100);
    advance(13.25);
    expect(engine.seconds()).toBe(113.25);
  });
  it("freezes on pause and resumes without counting the paused duration", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(60);
    engine.command({ type: "pause" });
    expect(advance(300)).toEqual([]);
    expect(engine.seconds()).toBe(60);
    engine.command({ type: "start" });
    advance(45);
    expect(engine.seconds()).toBe(105);
    expect(engine.snapshot().log).toHaveLength(1);
  });
  it("stop freezes the current clock while reset creates a new match", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(105);
    engine.command({ type: "stop" });
    advance(100);
    expect(engine.seconds()).toBe(105);
    engine.command({ type: "reset" });
    expect(engine.snapshot()).toMatchObject({
      seconds: 0,
      status: "stopped",
      cleared: {},
      log: [],
    });
    engine.command({ type: "start" });
    expect(advance(105)).toHaveLength(1);
  });
  it("forward sync does not replay crossed notifications", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    engine.command({ type: "sync", seconds: 119 });
    expect(advance(0)).toEqual([]);
    expect(advance(1).map((a) => a.warning)).toEqual([0]);
  });
  it("backward sync does not duplicate already delivered warnings or spawns", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(105);
    advance(15);
    engine.command({ type: "sync", seconds: 90 });
    expect(advance(15)).toEqual([]);
    expect(advance(15)).toEqual([]);
  });
  it("keeps a paused timer paused after manual synchronisation", () => {
    const { engine, advance } = setup();
    engine.command({ type: "pause" });
    engine.command({ type: "sync", seconds: 600 });
    advance(10);
    expect(engine.snapshot()).toMatchObject({ status: "paused", seconds: 600 });
  });
  it("delivers short delays and consumes obsolete alerts after suspension", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    expect(advance(106)[0]).toMatchObject({ warning: 15, late: false });
    expect(advance(16)[0]).toMatchObject({ warning: 0, late: true });
    const second = setup();
    second.engine.command({ type: "start" });
    expect(second.advance(400)).toEqual([]);
    second.engine.command({ type: "sync", seconds: 100 });
    expect(second.advance(5)).toEqual([]);
  });
  it("never assumes fixed camp respawns; clearing starts an independent delay", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(120);
    advance(600);
    expect(engine.snapshot().upcoming).toEqual([]);
    engine.command({ type: "clear", ruleId: rule.id });
    expect(engine.snapshot().upcoming[0]).toMatchObject({
      at: 960,
      kind: "respawn",
    });
    expect(advance(225)[0].warning).toBe(15);
    expect(advance(15)[0].warning).toBe(0);
    advance(1000);
    expect(engine.snapshot().upcoming).toEqual([]);
  });
  it("tracks each camp location separately and allows another clear cycle", () => {
    const other = { ...rule, id: "small-b", location: "Sapphire rooftop" };
    const { engine, advance } = setup([rule, other]);
    engine.command({ type: "start" });
    advance(150);
    engine.command({ type: "clear", ruleId: rule.id });
    advance(20);
    engine.command({ type: "clear", ruleId: other.id });
    expect(engine.snapshot().upcoming.map((o) => o.at)).toEqual([390, 410]);
    advance(220);
    engine.command({ type: "clear", ruleId: rule.id });
    expect(engine.snapshot().upcoming.some((o) => o.at === 630)).toBe(true);
  });
  it("undo clear cancels that pending respawn", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(200);
    engine.command({ type: "clear", ruleId: rule.id });
    engine.command({ type: "undo-clear", ruleId: rule.id });
    expect(engine.snapshot().upcoming).toEqual([]);
  });
  it("honours disabled categories and applies warning preferences", () => {
    const { engine, advance } = setup(
      [{ ...rule, enabled: false }],
      [30, 15, 5],
    );
    engine.command({ type: "start" });
    expect(advance(90)).toEqual([]);
    const active = setup([rule], [30, 15, 5]);
    active.engine.command({ type: "start" });
    expect(active.advance(90)[0].warning).toBe(30);
    expect(active.advance(15)[0].warning).toBe(15);
    expect(active.advance(10)[0].warning).toBe(5);
  });
  it("does not retroactively fire alerts when rules change", () => {
    const { engine, advance, settings } = setup([{ ...rule, enabled: false }]);
    engine.command({ type: "start" });
    advance(106);
    engine.updateSettings({ ...settings, rules: [rule] });
    expect(advance(0)).toEqual([]);
    expect(advance(14)[0].warning).toBe(0);
  });
  it("runs explicitly configured fixed schedules without applying them to camps", () => {
    const repeating: Rule = {
      ...rule,
      category: "custom",
      mode: "interval",
      firstSpawn: 60,
      repeatSeconds: 60,
    };
    const { engine, advance } = setup([repeating], []);
    engine.command({ type: "start" });
    expect(advance(60)).toHaveLength(1);
    expect(advance(60)).toHaveLength(1);
    expect(engine.snapshot().upcoming[0].at).toBe(120);
    expect(
      ruleSchema.safeParse({ ...rule, mode: "interval", repeatSeconds: 60 })
        .success,
    ).toBe(false);
  });
  it("does not drift or rewind when a start command is repeated", () => {
    const { engine, advance } = setup();
    engine.command({ type: "start" });
    advance(60);
    engine.command({ type: "start" });
    advance(30);
    expect(engine.seconds()).toBe(90);
  });
  it("rejects invalid clock commands and unavailable conditional rules", () => {
    const { engine } = setup();
    expect(() => engine.command({ type: "sync", seconds: -1 })).toThrow();
    expect(() => engine.command({ type: "sync", seconds: NaN })).toThrow();
    expect(() =>
      engine.command({ type: "clear", ruleId: "unknown" }),
    ).toThrow();
  });
});
describe("imported rule identity", () => {
  it("treats arbitrary rule IDs as data rather than inherited dictionary properties", () => {
    const { engine, advance } = setup([
      { ...rule, id: "constructor" },
      { ...rule, id: "__proto__" },
    ]);
    engine.command({ type: "start" });
    expect(advance(105)).toHaveLength(2);
    engine.command({ type: "clear", ruleId: "__proto__" });
    expect(
      engine.snapshot().upcoming.find((event) => event.ruleId === "__proto__"),
    ).toMatchObject({ at: 345, kind: "respawn" });
  });
});

describe("configuration and clock input", () => {
  it("ships enabled sourced current-patch presets with conditional camp timers", () => {
    expect(defaultSettings.presetRevision).toBe(1);
    expect(
      defaultSettings.rules.every(
        (r) =>
          r.enabled &&
          r.confirmed &&
          r.source.startsWith("https://deadlock.wiki/"),
      ),
    ).toBe(true);
    expect(
      defaultSettings.rules
        .filter((r) => r.category === "camp")
        .map((r) => [r.firstSpawn, r.respawnSeconds, r.mode]),
    ).toEqual([
      [120, 85, "conditional"],
      [300, 290, "conditional"],
      [480, 335, "conditional"],
    ]);
  });
  it("requires timing confirmation and a source for enabled game rules", () => {
    expect(ruleSchema.safeParse({ ...rule, confirmed: false }).success).toBe(
      false,
    );
    expect(ruleSchema.safeParse({ ...rule, source: "" }).success).toBe(false);
  });
  it("rejects zero respawn delays, invalid repeat rules and duplicate IDs", () => {
    expect(ruleSchema.safeParse({ ...rule, respawnSeconds: 0 }).success).toBe(
      false,
    );
    expect(
      ruleSchema.safeParse({ ...rule, category: "custom", mode: "interval" })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, rules: [rule, rule] })
        .success,
    ).toBe(false);
  });
  it("round-trips settings without losing notification preferences", () => {
    const settings = {
      ...defaultSettings,
      sound: "bell",
      volume: 0.4,
      warnings: [30, 5],
      rules: [rule],
    };
    expect(settingsSchema.parse(JSON.parse(JSON.stringify(settings)))).toEqual(
      settings,
    );
  });
  it("validates MM:SS input precisely", () => {
    expect(parseClock("01:45")).toBe(105);
    expect(parseClock("120:00")).toBe(7200);
    expect(formatClock(105.9)).toBe("01:45");
    for (const value of ["1:99", "abc", "-1:00", "1:2", "1441:00"])
      expect(() => parseClock(value)).toThrow();
  });
});

describe("variable Rift windows", () => {
  const rift: Rule = {
    id: "rift",
    name: "Unstable Rift",
    category: "objective",
    mode: "conditional",
    firstSpawn: 600,
    repeatSeconds: null,
    respawnSeconds: 360,
    windowSeconds: 120,
    enabled: true,
    confirmed: true,
    source: "Window test fixture",
    location: "",
  };
  it("announces a window rather than an exact spawn and keeps it visible while open", () => {
    const { engine, advance } = setup([rift]);
    engine.command({ type: "start" });
    advance(585);
    expect(engine.snapshot().log[0].message).toBe(
      "Unstable Rift window begins in 15 seconds",
    );
    const alerts = advance(15);
    expect(alerts[0].message).toBe("Unstable Rift window begins now");
    advance(30);
    expect(engine.snapshot().upcoming[0]).toMatchObject({
      at: 600,
      windowEnd: 720,
    });
    expect(advance(0)).toEqual([]);
    advance(91);
    expect(engine.snapshot().upcoming).toEqual([]);
  });
  it("anchors the next 6–8 minute window to the manually observed visual effect", () => {
    const { engine, advance } = setup([rift]);
    engine.command({ type: "start" });
    advance(660);
    engine.command({ type: "clear", ruleId: "rift" });
    expect(engine.snapshot().upcoming[0]).toMatchObject({
      at: 1020,
      windowEnd: 1140,
    });
    engine.command({ type: "sync", seconds: 1010 });
    expect(advance(0)).toEqual([]);
    expect(advance(10)[0].message).toBe("Unstable Rift window begins now");
    advance(130);
    expect(engine.snapshot().upcoming).toEqual([]);
    engine.command({ type: "undo-clear", ruleId: "rift" });
    expect(engine.snapshot().upcoming).toEqual([]);
  });
});
