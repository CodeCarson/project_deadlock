import {
  defaultSettings,
  settingsSchema,
  type Bridge,
  type Settings,
  type TimerSnapshot,
  type Alert,
} from "./schema.js";
import { ApiClient } from "./api.js";
import { migrateSettings } from "./settings.js";
import { TimerEngine } from "./timer.js";
declare global {
  interface Window {
    companion?: Bridge;
  }
}
const settingsKey = "deadlock-companion.settings.v1";
/** Browser mode is for UI development. Desktop mode owns scheduling in the main process. */
function browserBridge(): Bridge {
  let settings: Settings = structuredClone(defaultSettings);
  try {
    const saved = localStorage.getItem(settingsKey);
    if (saved) {
      settings = migrateSettings(JSON.parse(saved));
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    }
  } catch {
    /* Keep invalid storage intact until a deliberate save. */
  }
  const api = new ApiClient({
    async get(key) {
      const value = localStorage.getItem(`deadlock-api.v1.${key}`);
      return value ? JSON.parse(value) : undefined;
    },
    async set(key, entry) {
      localStorage.setItem(`deadlock-api.v1.${key}`, JSON.stringify(entry));
    },
  });
  const engine = new TimerEngine(settings);
  const listeners = new Set<(state: TimerSnapshot) => void>();
  const alertListeners = new Set<(alert: Alert) => void>();
  const tick = () => {
    engine.tick().forEach((a) => alertListeners.forEach((fn) => fn(a)));
    listeners.forEach((fn) => fn(engine.snapshot()));
  };
  setInterval(tick, 200);
  return {
    async captureDisplays() {
      return [];
    },
    async previewClock() {
      throw new Error("Clock capture requires the Windows desktop app.");
    },
    async resumeAutomaticTracking() {},
    request: (request) => api.request(request),
    importHistory: (accountId, archive) =>
      api.importHistory(accountId, archive),
    recoverHistory: (accountId, ids) => api.recoverHistory(accountId, ids),
    async alertVoices() {
      return [];
    },
    async speakAlert() {},
    async loadSettings() {
      return settings;
    },
    async saveSettings(raw) {
      const next = settingsSchema.parse(raw);
      localStorage.setItem(settingsKey, JSON.stringify(next));
      tick();
      engine.updateSettings(next);
      settings = next;
      return settings;
    },
    async getTimer() {
      return engine.snapshot();
    },
    async command(command) {
      tick();
      const state = engine.command(command);
      listeners.forEach((fn) => fn(state));
      return state;
    },
    onTimer(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onAlert(fn) {
      alertListeners.add(fn);
      return () => alertListeners.delete(fn);
    },
  };
}
export const isDesktop = !!window.companion;
export const bridge: Bridge = window.companion ?? browserBridge();
