import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import catalog from "../config/voice-packs.json";
import {
  bundledCue,
  bundledVoices,
  selectedVoiceId,
} from "../src/core/voice-packs";

it("ships non-silent, checksum-verified recordings for every built-in alert and voice", () => {
  const folder = join(process.cwd(), "public/voices");
  const manifest = JSON.parse(
    readFileSync(join(folder, "manifest.json"), "utf8"),
  );
  const messages = catalog.events.flatMap((event) => [
    `${event.match} ready`,
    ...[5, 15, 30, 17].map((seconds) => `${event.match} in ${seconds} seconds`),
    ...(event.respawn
      ? [
          `${event.match} can respawn`,
          `${event.match} earliest respawn in 15 seconds`,
        ]
      : []),
    ...(event.window
      ? [
          `${event.match} window open`,
          ...[5, 15, 30, 17].map(
            (seconds) => `${event.match} window in ${seconds} seconds`,
          ),
        ]
      : []),
  ]);
  for (const message of messages) {
    const cue = bundledCue(message);
    expect(cue, message).not.toBeNull();
    for (const voice of bundledVoices) {
      const name = `${voice.id.slice(5)}/${cue}.ogg`;
      expect(manifest.clips[name], name).toBeDefined();
    }
  }
  for (const [name, clip] of Object.entries(manifest.clips) as [
    string,
    { seconds: number; sha256: string },
  ][]) {
    const data = readFileSync(join(folder, name));
    expect(data.subarray(0, 4).toString()).toBe("OggS");
    expect(data.includes(Buffer.from("OpusHead"))).toBe(true);
    expect(data.length).toBeGreaterThan(1000);
    expect(clip.seconds).toBeGreaterThan(0.35);
    expect(clip.seconds).toBeLessThan(6);
    expect(createHash("sha256").update(data).digest("hex"), name).toBe(
      clip.sha256,
    );
  }
  expect(
    new Set(
      bundledVoices.map(
        (v) => manifest.clips[`${v.id.slice(5)}/bridge-ready.ogg`].sha256,
      ),
    ).size,
  ).toBe(6);
  expect(readFileSync(join(folder, "LICENSE-KOKORO.txt"), "utf8")).toContain(
    "Apache License",
  );
});

it("uses accurate respawn/window clips and leaves arbitrary custom text to system speech", () => {
  expect(
    bundledCue("Boxes & golden statues (Tunnel) earliest respawn now"),
  ).toBe("breakables-respawn");
  expect(
    bundledCue("Unstable Rift (Side lane) window begins in 15 seconds"),
  ).toBe("rift-window-in-15");
  expect(bundledCue("Small jungle camp (Left side) event now")).toBe(
    "small-ready",
  );
  for (const text of [
    "Drink water event now",
    "Bridge buffs ready tomorrow",
    "../bridge ready",
    "Bridge buffs in 0 seconds",
    "Bridge buffs in 301 seconds",
  ]) {
    expect(bundledCue(text)).toBeNull();
  }
});

it("maps automatic old voice preferences to real bundles and preserves explicit system choices", () => {
  expect(selectedVoiceId("", "operator")).toBe("pack:am_michael");
  expect(selectedVoiceId("", "lookout")).toBe("pack:af_heart");
  expect(selectedVoiceId("Microsoft Zira", "operator")).toBe("Microsoft Zira");
});
