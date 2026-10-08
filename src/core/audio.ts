import type { Settings } from "./schema.js";
let context: AudioContext | undefined;
let queue = Promise.resolve();
export async function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
}
export async function playSound(settings: Pick<Settings, "sound" | "volume">) {
  if (settings.volume === 0) return;
  await unlockAudio();
  const ctx = context!;
  if (ctx.state !== "running")
    throw new Error("Audio is blocked. Click Test sound to enable it.");
  const notes =
    settings.sound === "chime"
      ? [660, 880, 1100]
      : settings.sound === "pulse"
        ? [440, 440]
        : [1046, 784];
  notes.forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.14;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = settings.sound === "bell" ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(settings.volume * 0.23, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.32);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}
export function notify(settings: Settings, message: string) {
  const task = queue.then(async () => {
    await playSound(settings);
    if (settings.speech && settings.volume > 0 && "speechSynthesis" in window) {
      const speech = new SpeechSynthesisUtterance(message);
      speech.volume = settings.volume;
      speech.rate = 1.05;
      window.speechSynthesis.speak(speech);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  queue = task.catch(() => {});
  return task;
}
