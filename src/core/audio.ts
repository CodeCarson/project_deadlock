import type { Settings } from "./schema.js";
import { shortAnnouncement } from "./alert-cues.js";
export { shortAnnouncement } from "./alert-cues.js";
import { bridge, isDesktop } from "./bridge.js";
import { bundledCue, bundledVoice, selectedVoiceId } from "./voice-packs.js";
let context: AudioContext | undefined;
let nativeVoices: { id: string; name: string }[] = [];
let nativeSpeechActive = false;
let cancelRecording: (() => void) | undefined;
let queue = Promise.resolve();
export async function availableVoices() {
  if (isDesktop) nativeVoices = await bridge.alertVoices().catch(() => []);
  return nativeVoices.length
    ? nativeVoices
    : (window.speechSynthesis?.getVoices() ?? []).map((v) => ({
        id: v.voiceURI,
        name: v.name,
      }));
}
export async function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
}
const soundNotes: Record<Settings["sound"], number[]> = {
  chime: [660, 880, 1100],
  pulse: [440, 440],
  bell: [1046, 784],
  knock: [150, 110],
  radio: [780, 520, 780],
  glass: [1320, 1760],
  whistle: [880, 1320],
};
export async function playSound(
  settings: Pick<Settings, "sound" | "volume"> &
    Partial<Pick<Settings, "alertSpeed">>,
) {
  if (settings.volume === 0) return;
  await unlockAudio();
  const ctx = context!;
  if (ctx.state !== "running")
    throw new Error("Click Test sound to enable audio.");
  const speed = settings.alertSpeed ?? 1.35;
  soundNotes[settings.sound].forEach((frequency, index) => {
    const start = ctx.currentTime + (index * 0.12) / speed;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = ["bell", "glass", "whistle"].includes(settings.sound)
      ? "sine"
      : settings.sound === "radio"
        ? "square"
        : "triangle";
    oscillator.frequency.value = frequency;
    if (settings.sound === "whistle")
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * 1.2,
        start + 0.16 / speed,
      );
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(
      settings.volume * (settings.sound === "radio" ? 0.09 : 0.23),
      start + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22 / speed);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.25 / speed);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}
export async function speak(settings: Settings, message: string) {
  if (settings.volume === 0) return;
  const text = shortAnnouncement(message);
  const voiceId = selectedVoiceId(settings.voiceId, settings.voiceStyle);
  const pack = bundledVoice(voiceId);
  const cue = pack ? bundledCue(message) : null;
  cancelRecording?.();
  window.speechSynthesis?.cancel();
  if (pack && cue) {
    if (nativeSpeechActive) {
      await bridge.stopAlertSpeech();
      nativeSpeechActive = false;
    }
    const url = new URL(
      `voices/${pack.id.slice(5)}/${cue}.ogg`,
      document.baseURI,
    );
    const recording = new Audio(url.href);
    recording.volume = settings.volume;
    recording.playbackRate = settings.alertSpeed;
    recording.preservesPitch = true;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        recording.onended = recording.onerror = null;
        recording.pause();
        recording.removeAttribute("src");
        recording.load();
        if (cancelRecording === cancel) cancelRecording = undefined;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish();
      cancelRecording = cancel;
      const timeout = setTimeout(
        () =>
          finish(new Error("Voice playback timed out. Try Test voice again.")),
        15000,
      );
      recording.onended = () => finish();
      recording.onerror = () =>
        finish(
          new Error(
            "Bundled voice could not play. Extract the whole app ZIP and try again.",
          ),
        );
      void recording
        .play()
        .catch(() =>
          finish(
            new Error(
              "Voice playback could not start. Click Test voice to enable audio.",
            ),
          ),
        );
    });
    return;
  }
  const choices = await availableVoices();
  const preferred =
    choices.find((v) => v.id === voiceId) ??
    choices.find((v) =>
      settings.voiceStyle === "operator"
        ? /david|mark|george|male/i.test(v.name) && !/female/i.test(v.name)
        : /zira|hazel|susan|female/i.test(v.name),
    ) ??
    choices[settings.voiceStyle === "lookout" && choices.length > 1 ? 1 : 0];
  if (isDesktop && nativeVoices.length) {
    await bridge.speakAlert(
      text,
      preferred?.id ?? "",
      settings.alertSpeed,
      settings.volume,
    );
    nativeSpeechActive = true;
    return;
  }
  if (!("speechSynthesis" in window))
    throw new Error("No speech engine is available.");
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = settings.volume;
  utterance.rate = settings.alertSpeed;
  utterance.pitch = 1;
  utterance.voice =
    window.speechSynthesis
      .getVoices()
      .find((v) => v.voiceURI === preferred?.id) ?? null;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
export function notify(settings: Settings, message: string) {
  const requestedAt = Date.now();
  const task = queue.then(async () => {
    if (Date.now() - requestedAt > 4000) return;
    await playSound(settings);
    if (settings.speech) await speak(settings, message);
    await new Promise((resolve) =>
      setTimeout(resolve, 250 / settings.alertSpeed),
    );
  });
  queue = task.catch(() => {});
  return task;
}
