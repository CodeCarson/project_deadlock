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
  const engine = new TimerEngine(settings, () => now),
    reader = new ClockReader(engine, () => now);
  reader.configure(true);
  return {
    engine,
    reader,
    read: (text: string, confidence = 95, at = now) =>
      reader.reading(text, confidence, at),
    advance: (ms: number) => {
      now += ms;
    },
    time: () => now,
  };
}
describe("independent clock with sparse synchronization", () => {
  it("rejects invalid and low-confidence OCR", () => {
    expect(recognisedClock(" 02:00\n", 95)).toBe(120);
    for (const t of ["0200", "2:99", "2:00 3:00", "menu", "-0:15"])
      expect(recognisedClock(t, 99)).toBeNull();
    expect(recognisedClock("02:00", 79)).toBeNull();
    expect(recognisedClock("02:00", NaN)).toBeNull();
  });
  it("seeds immediately and delivers a deduplicated reminder between photos", () => {
    const { engine, read, advance } = setup();
    read("02:00");
    expect(engine.snapshot().status).toBe("running");
    advance(5000);
    expect(engine.seconds()).toBe(125);
    expect(engine.tick().filter((a) => a.name === "Test")).toHaveLength(1);
    read("02:05");
    expect(engine.tick()).toEqual([]);
    advance(1000);
    expect(engine.seconds()).toBe(126);
  });
  it("uses three initial checks then sparse two-reading bursts", () => {
    const { reader, read, advance } = setup();
    read("02:00");
    expect(reader.nextSampleDelay()).toBe(1500);
    advance(1500);
    read("02:01");
    expect(reader.nextSampleDelay()).toBe(1500);
    advance(1500);
    read("02:03");
    expect(reader.nextSampleDelay()).toBe(15000);
    advance(15000);
    read("02:18");
    expect(reader.nextSampleDelay()).toBe(1500);
    advance(1500);
    read("02:19");
    expect(reader.nextSampleDelay()).toBe(15000);
  });
  it("two separated identical readings pause, then advancing time resumes", () => {
    const { engine, reader, read, advance } = setup();
    read("02:04");
    advance(500);
    read("02:04");
    expect(engine.snapshot().status).toBe("running");
    advance(1500);
    read("02:04");
    expect(engine.snapshot().status).toBe("paused");
    advance(20000);
    expect(engine.seconds()).toBe(124);
    expect(engine.tick()).toEqual([]);
    read("02:05");
    expect(engine.snapshot().status).toBe("running");
    expect(reader.snapshot().connected).toBe(true);
  });
  it("continues through a brief hidden clock but stops after the grace period", () => {
    const { engine, reader, read, advance } = setup();
    read("02:00");
    advance(3000);
    reader.missing();
    advance(10000);
    reader.check();
    expect(engine.seconds()).toBe(133);
    expect(engine.snapshot().status).toBe("running");
    read("02:13");
    advance(90001);
    reader.check();
    expect(engine.snapshot().status).toBe("paused");
    const stopped = engine.seconds();
    advance(60000);
    expect(engine.seconds()).toBe(stopped);
    read("03:00");
    expect(engine.seconds()).toBe(180);
    expect(engine.tick().filter((a) => a.name === "Test")).toEqual([]);
  });
  it("never advances an already detected pause while hidden", () => {
    const { engine, reader, read, advance } = setup();
    read("02:04");
    advance(1500);
    read("02:04");
    reader.missing();
    advance(20000);
    expect(engine.seconds()).toBe(124);
    expect(engine.snapshot().status).toBe("paused");
  });
  it("rejects stale readings and implausible OCR without corrupting the local clock", () => {
    const { engine, reader, read, advance, time } = setup();
    read("02:00");
    advance(1000);
    read("22:01");
    expect(engine.seconds()).toBe(121);
    expect(engine.snapshot().status).toBe("running");
    advance(4000);
    read("02:05", 95, time() - 4000);
    expect(engine.seconds()).toBe(125);
    expect(reader.snapshot().message).toContain("hidden");
    read("02:05");
    advance(1500);
    read("02:06");
    expect(engine.seconds()).toBe(126);
  });
  it("manual override and automatic resumption preserve marks and fired events", () => {
    const { engine, reader, read, advance } = setup();
    engine.command({ type: "sync", seconds: 124 });
    engine.command({ type: "clear", ruleId: defaultSettings.rules[0].id });
    read("02:04");
    expect(engine.snapshot().cleared).toHaveProperty(
      defaultSettings.rules[0].id,
    );
    advance(1000);
    engine.tick();
    engine.command({ type: "clear", ruleId: defaultSettings.rules[0].id });
    reader.manual({ type: "clear", ruleId: defaultSettings.rules[0].id });
    expect(reader.snapshot().manualOverride).toBe(false);
    reader.manual({ type: "pause" });
    engine.command({ type: "pause" });
    advance(1000);
    read("02:06");
    expect(engine.seconds()).toBe(125);
    reader.resume();
    advance(5000);
    expect(engine.seconds()).toBe(125);
    read("02:07");
    expect(engine.snapshot().cleared).toHaveProperty(
      defaultSettings.rules[0].id,
    );
    expect(engine.snapshot().log.filter((a) => a.name === "Test")).toHaveLength(
      1,
    );
  });
  it("confirms a new near-zero clock after a gap before resetting the old session", () => {
    const { engine, reader, read, advance } = setup();
    read("02:00");
    engine.command({ type: "clear", ruleId: defaultSettings.rules[0].id });
    read("00:00");
    expect(engine.seconds()).toBe(120);
    reader.missing();
    advance(15001);
    read("00:00");
    expect(engine.snapshot().cleared).toHaveProperty(
      defaultSettings.rules[0].id,
    );
    advance(1500);
    read("00:01");
    expect(engine.seconds()).toBe(1);
    expect(engine.snapshot().cleared).toEqual({});
  });
});
