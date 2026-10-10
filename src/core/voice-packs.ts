import catalog from "../../config/voice-packs.json" with { type: "json" };
import { shortAnnouncement } from "./alert-cues.js";

export const bundledVoices = catalog.voices;
export const systemVoiceId = "system:auto";
export function selectedVoiceId(
  voiceId: string,
  style: "operator" | "lookout",
) {
  return voiceId || (style === "lookout" ? "pack:af_heart" : "pack:am_michael");
}
export function bundledVoice(voiceId: string) {
  return bundledVoices.find((voice) => voice.id === voiceId);
}

/** Only known event names and timer suffixes can select a bundled recording. */
export function bundledCue(message: string): string | null {
  const text = shortAnnouncement(message).toLowerCase();
  const event = catalog.events.find((event) =>
    text.startsWith(`${event.match.toLowerCase()} `),
  );
  if (!event) return null;
  const suffix = text.slice(event.match.length + 1);
  if (suffix === "ready") return `${event.id}-ready`;
  if (suffix === "can respawn" && event.respawn) return `${event.id}-respawn`;
  if (suffix === "window open" && event.window) return `${event.id}-window`;
  const warning = /^(?:(window|earliest respawn) )?in (\d+) seconds$/.exec(
    suffix,
  );
  if (!warning) return null;
  const seconds = Number(warning[2]);
  if (seconds < 1 || seconds > 300) return null;
  const window = warning[1] === "window";
  if (window && !event.window) return null;
  const ending = catalog.warnings.includes(seconds) ? `in-${seconds}` : "soon";
  return `${event.id}-${window ? "window-" : ""}${ending}`;
}
