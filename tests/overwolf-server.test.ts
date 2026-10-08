import { it, expect } from "vitest";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startOverwolfServer } from "../electron/overwolf-server";
import { MatchDetection } from "../src/core/detection";
import { TimerEngine } from "../src/core/timer";
import { defaultSettings } from "../src/core/schema";
it("authenticates the loopback helper, validates payloads and rejects replayed sequences", async () => {
  const engine = new TimerEngine(defaultSettings);
  const detection = new MatchDetection(engine);
  detection.configure(true);
  const token = "a".repeat(64);
  const server = await startOverwolfServer(token, detection, 0);
  const connect = async () => {
    const s = new WebSocket(`ws://127.0.0.1:${server.port}/timer`);
    await once(s, "open");
    return s;
  };
  const bad = await connect();
  const rejected = once(bad, "close");
  bad.send(JSON.stringify({ kind: "pair", token: "b".repeat(64) }));
  await rejected;
  expect(detection.snapshot().connected).toBe(false);
  const socket = await connect();
  try {
    const paired = once(socket, "message");
    socket.send(JSON.stringify({ kind: "pair", token }));
    await paired;
    const packet = {
      kind: "clock",
      matchId: "123",
      seconds: 120,
      paused: true,
      observedAt: Date.now(),
      sequence: 1,
    };
    socket.send(JSON.stringify(packet));
    await expect.poll(() => engine.seconds()).toBe(120);
    socket.send(JSON.stringify({ ...packet, seconds: 180 }));
    socket.send(
      JSON.stringify({
        kind: "status",
        message: "ready",
        observedAt: Date.now(),
        sequence: 2,
      }),
    );
    // Wait until an ordered barrier reaches the same receiver.
    socket.send(JSON.stringify({ ...packet, seconds: 121, sequence: 3 }));
    await expect.poll(() => engine.seconds()).toBe(121);
    expect(engine.snapshot().log).toEqual([]);
    const close = once(socket, "close");
    socket.send(JSON.stringify({ ...packet, sequence: 4, seconds: -1 }));
    await close;
    await expect.poll(() => detection.snapshot().connected).toBe(false);
  } finally {
    socket.terminate();
    await server.close();
  }
});
