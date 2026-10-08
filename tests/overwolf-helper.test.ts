import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync("overwolf-helper/background.js", "utf8");
it("relays official SDK clocks once and ignores roster updates, pregame and stale reconnect samples", () => {
  let time = 1000000;
  const listeners: Record<string, (value: any) => void> = {};
  const event = (name: string) => ({
    addListener: (fn: any) => {
      listeners[name] = fn;
    },
  });
  const sent: any[] = [];
  let socket: any;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onopen?: () => void;
    onmessage?: (event: any) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor() {
      socket = this;
    }
    send(value: string) {
      sent.push(JSON.parse(value));
    }
    close() {
      this.onclose?.();
    }
  }
  const features: string[][] = [];
  const info = {
    success: true,
    res: {
      game_info: { phase: "GameInProgress" },
      match_info: { match_id: "123" },
    },
  };
  const ow = {
    games: {
      getRunningGameInfo: (fn: any) => fn({ classId: 24482, isRunning: true }),
      onGameInfoUpdated: event("game"),
      events: {
        onInfoUpdates2: event("info"),
        onNewEvents: event("events"),
        onError: event("error"),
        setRequiredFeatures: (f: string[], fn: any) => {
          features.push(f);
          fn({ success: true });
        },
        getInfo: (fn: any) => fn(info),
      },
    },
  };
  runInNewContext(source, {
    window: {
      overwolf: ow,
      HELPER_CONFIG: {
        endpoint: "ws://127.0.0.1:32145/timer",
        token: "a".repeat(64),
      },
    },
    WebSocket: Socket,
    Date: { now: () => time },
    setInterval: () => 1,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  socket.onopen();
  socket.onmessage({ data: JSON.stringify({ kind: "paired" }) });
  expect(features).toEqual([["game_info", "match_info"]]);
  expect(sent.filter((p) => p.kind === "clock")).toHaveLength(0);
  listeners.events({ events: [{ name: "match_clock", data: "02:00" }] });
  expect(sent.at(-1)).toMatchObject({
    kind: "clock",
    matchId: "123",
    seconds: 120,
  });
  for (let i = 0; i < 100; i++)
    listeners.info({
      info: { match_info: { roster_1: "private data", items_1: "ignored" } },
    });
  expect(sent.filter((p) => p.kind === "clock")).toHaveLength(1);
  listeners.events({ events: [{ name: "game_paused", data: true }] });
  expect(sent.at(-1).paused).toBe(true);
  listeners.events({ events: [{ name: "game_paused", data: false }] });
  expect(sent.at(-1).paused).toBe(true);
  time += 1000;
  listeners.events({ events: [{ name: "match_clock", data: "02:01" }] });
  expect(sent.at(-1)).toMatchObject({ seconds: 121, paused: false });
  time += 6000;
  socket.onmessage({ data: JSON.stringify({ kind: "paired" }) });
  expect(sent.at(-1).kind).toBe("status");
  listeners.info({ info: { game_info: { phase: "PreGameWait" } } });
  listeners.events({ events: [{ name: "match_clock", data: "00:00" }] });
  expect(sent.at(-1).kind).toBe("status");
});
