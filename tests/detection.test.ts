import { describe, it, expect } from "vitest";
import { MatchDetection, type HelperPacket } from "../src/core/detection";
import { TimerEngine } from "../src/core/timer";
import { defaultSettings } from "../src/core/schema";
function setup() {
  let time = 1000000;
  const settings = structuredClone(defaultSettings);
  settings.warnings = [];
  settings.rules = [
    {
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
    },
  ];
  const engine = new TimerEngine(settings, () => time);
  const detection = new MatchDetection(engine, () => time);
  detection.configure(true);
  detection.connection(true);
  const sample = (seconds: number, extra = {}) =>
    detection.receive({
      kind: "clock",
      matchId: "123",
      seconds,
      paused: false,
      sequence: 1,
      observedAt: time,
      ...extra,
    });
  return {
    engine,
    detection,
    sample,
    advance: (ms: number) => {
      time += ms;
    },
    time: () => time,
  };
}
describe("documented local match clock integration", () => {
  it("waits for a real clock and joins mid-match without replaying past events", () => {
    const { engine, detection, sample, time } = setup();
    detection.receive({
      kind: "status",
      message: "ready",
      sequence: 0,
      observedAt: time(),
    });
    expect(engine.snapshot().status).toBe("stopped");
    sample(120);
    expect(engine.seconds()).toBe(120);
    expect(engine.tick()).toEqual([]);
    sample(125);
    expect(engine.tick()).toHaveLength(1);
    sample(125);
    expect(engine.tick()).toHaveLength(0);
  });
  it("follows pause/unpause and preserves reminder boundaries during clock corrections", () => {
    const { engine, sample, advance } = setup();
    sample(124);
    sample(125);
    expect(engine.tick()).toHaveLength(1);
    sample(125, { paused: true });
    advance(3000);
    expect(engine.seconds()).toBe(125);
    sample(124);
    sample(125);
    expect(engine.tick()).toHaveLength(0);
    expect(engine.snapshot().status).toBe("running");
  });
  it("pauses after lost events and rebases on reconnect without a reminder burst", () => {
    const { engine, detection, sample, advance } = setup();
    sample(120);
    advance(5001);
    detection.check();
    expect(engine.snapshot().status).toBe("paused");
    detection.connection(false);
    advance(30000);
    detection.connection(true);
    sample(180);
    expect(engine.tick()).toEqual([]);
    expect(engine.seconds()).toBe(180);
  });
  it("manual control survives subsequent samples and reconnects until resumed or a new match", () => {
    const { engine, detection, sample } = setup();
    sample(120);
    engine.command({ type: "pause" });
    detection.manual({ type: "pause" });
    sample(125);
    detection.connection(false);
    detection.connection(true);
    sample(130);
    expect(engine.snapshot().status).toBe("paused");
    expect(engine.seconds()).toBe(120);
    detection.resume();
    sample(135);
    expect(engine.snapshot().status).toBe("running");
    engine.command({ type: "reset" });
    detection.manual({ type: "reset" });
    sample(140);
    expect(engine.seconds()).toBe(0);
    sample(2, { matchId: "456" });
    expect(engine.seconds()).toBe(2);
  });
  it("stops at match end and rejects late clock packets for the ended match", () => {
    const { engine, detection, sample, time } = setup();
    sample(120);
    detection.receive({
      kind: "end",
      matchId: "123",
      sequence: 2,
      observedAt: time(),
    });
    sample(121);
    expect(engine.snapshot().status).toBe("stopped");
    sample(0, { matchId: "456" });
    expect(engine.snapshot().status).toBe("running");
  });
  it("ignores stale/future samples and remains stopped while disabled", () => {
    const { engine, detection, sample, time } = setup();
    sample(120, { observedAt: time() - 4001 });
    sample(120, { observedAt: time() + 2001 });
    expect(engine.snapshot().status).toBe("stopped");
    detection.configure(false);
    sample(120);
    expect(engine.snapshot().status).toBe("stopped");
  });
  it("retains manual clear marks during the same match and resets them for a new match", () => {
    const settings = structuredClone(defaultSettings);
    const engine = new TimerEngine(settings);
    const detection = new MatchDetection(engine);
    detection.configure(true);
    detection.connection(true);
    const sample = (matchId: string) =>
      detection.receive({
        kind: "clock",
        matchId,
        seconds: 120,
        paused: false,
        observedAt: Date.now(),
        sequence: 1,
      } as HelperPacket);
    sample("123");
    engine.command({ type: "clear", ruleId: settings.rules[0].id });
    detection.manual({ type: "clear", ruleId: settings.rules[0].id });
    sample("123");
    expect(Object.keys(engine.snapshot().cleared)).toHaveLength(1);
    sample("456");
    expect(engine.snapshot().cleared).toEqual({});
  });
});
