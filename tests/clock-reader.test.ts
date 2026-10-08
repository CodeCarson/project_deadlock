import { describe, it, expect } from "vitest";
import { ClockReader, recognisedClock } from "../src/core/clock-reader";
import { TimerEngine } from "../src/core/timer";
import { defaultSettings } from "../src/core/schema";
function setup() {
  let now = 1000000;
  const settings = structuredClone(defaultSettings);
  settings.warnings = [];
  settings.rules.push({
    id: "test",
    name: "Test",
    category: "custom",
    mode: "once",
    firstSpawn: 125,
    repeatSeconds: null,
    respawnSeconds: null,
    enabled: true,
    confirmed: true,
    source: "",
    location: "",
  });
  const engine = new TimerEngine(settings, () => now);
  const reader = new ClockReader(engine, () => now);
  reader.configure(true);
  const read = (text: string, confidence = 95, observedAt = now) =>
    reader.reading(text, confidence, observedAt);
  return {
    engine,
    reader,
    read,
    advance: (ms: number) => {
      now += ms;
    },
    time: () => now,
  };
}
describe("standalone sampled screen clock", () => {
  it("rejects low confidence, multiple clocks, missing colons and invalid seconds", () => {
    expect(recognisedClock(" 02:00\n", 95)).toBe(120);
    for (const text of ["0200", "2:99", "2:00 3:00", "menu", "-0:15"])
      expect(recognisedClock(text, 99)).toBeNull();
    expect(recognisedClock("02:00", 79)).toBeNull();
    expect(recognisedClock("02:00", NaN)).toBeNull();
  });
  it("requires consistent readings, joins mid-match and never extrapolates", () => {
    const { engine, read, advance } = setup();
    read("02:00");
    expect(engine.snapshot().status).toBe("stopped");
    advance(1000);
    read("02:01");
    expect(engine.seconds()).toBe(121);
    advance(2000);
    expect(engine.seconds()).toBe(121);
    expect(engine.tick()).toEqual([]);
    read("02:03");
    advance(2000);
    read("02:05");
    expect(engine.tick().filter((a) => a.name === "Test")).toHaveLength(1);
    read("02:05");
    expect(engine.tick()).toHaveLength(0);
  });
  it("a frozen clock and unreadable crop do not deliver future reminders", () => {
    const { engine, reader, read, advance } = setup();
    read("02:03");
    advance(1000);
    read("02:04");
    advance(3000);
    read("02:04");
    expect(engine.snapshot().status).toBe("paused");
    expect(engine.tick()).toEqual([]);
    reader.missing();
    advance(10000);
    expect(engine.seconds()).toBe(124);
    expect(engine.tick()).toEqual([]);
  });
  it("rejects implausible jumps and stale samples then requires confirmation to resume", () => {
    const { engine, reader, read, advance, time } = setup();
    read("02:00");
    advance(1000);
    read("02:01");
    read("22:01");
    expect(engine.seconds()).toBe(121);
    expect(engine.snapshot().status).toBe("paused");
    advance(4000);
    read("02:05", 95, time() - 4000);
    expect(engine.seconds()).toBe(121);
    read("02:05");
    advance(1000);
    read("02:06");
    expect(engine.seconds()).toBe(126);
    expect(engine.tick()).toEqual([]);
    advance(3001);
    reader.check();
    expect(engine.snapshot().status).toBe("paused");
  });
  it("manual override preserves marks and fired events when automatically resumed", () => {
    const { engine, reader, read, advance } = setup();
    read("02:04");
    advance(1000);
    read("02:05");
    engine.tick();
    engine.command({ type: "clear", ruleId: defaultSettings.rules[0].id });
    reader.manual({ type: "clear", ruleId: defaultSettings.rules[0].id });
    advance(1000);
    expect(engine.seconds()).toBe(125);
    engine.command({ type: "start" });
    reader.manual({ type: "start" });
    read("02:06");
    expect(engine.seconds()).toBe(125);
    reader.resume();
    advance(5000);
    expect(engine.seconds()).toBe(125);
    expect(engine.snapshot().status).toBe("paused");
    read("02:06");
    advance(1000);
    read("02:07");
    expect(engine.snapshot().cleared).toHaveProperty(
      defaultSettings.rules[0].id,
    );
    expect(engine.snapshot().log.filter((a) => a.name === "Test")).toHaveLength(
      1,
    );
  });
  it("resets a new near-zero clock only after a long gap and consistent readings", () => {
    const { engine, reader, read, advance } = setup();
    read("02:00");
    advance(1000);
    read("02:01");
    engine.command({ type: "clear", ruleId: defaultSettings.rules[0].id });
    read("00:00");
    expect(engine.seconds()).toBe(121);
    reader.missing();
    advance(15001);
    read("00:00");
    expect(engine.seconds()).toBe(121);
    advance(1000);
    read("00:01");
    expect(engine.seconds()).toBe(1);
    expect(engine.snapshot().cleared).toEqual({});
  });
});
