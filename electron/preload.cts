import { contextBridge, ipcRenderer } from "electron";
import type {
  Bridge,
  TimerSnapshot,
  Alert,
  Settings,
  TimerCommand,
} from "../src/core/schema.js";
const bridge: Bridge = {
  captureDisplays: () => ipcRenderer.invoke("capture:displays"),
  previewClock: (region) => ipcRenderer.invoke("capture:preview", region),
  resumeAutomaticTracking: () => ipcRenderer.invoke("capture:resume"),
  importHistory: (accountId, archive) =>
    ipcRenderer.invoke("api:importHistory", accountId, archive),
  request: (request) => ipcRenderer.invoke("api:request", request),
  recoverHistory: (accountId, ids) =>
    ipcRenderer.invoke("api:recoverHistory", accountId, ids),
  alertVoices: () => ipcRenderer.invoke("audio:voices"),
  speakAlert: (text, voiceId, speed, volume) =>
    ipcRenderer.invoke("audio:speak", text, voiceId, speed, volume),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke("settings:save", settings),
  getTimer: () => ipcRenderer.invoke("timer:get"),
  command: (command: TimerCommand) =>
    ipcRenderer.invoke("timer:command", command),
  onTimer: (callback: (state: TimerSnapshot) => void) => {
    const handler = (_event: unknown, state: TimerSnapshot) => callback(state);
    ipcRenderer.on("timer:state", handler);
    return () => ipcRenderer.removeListener("timer:state", handler);
  },
  onAlert: (callback: (alert: Alert) => void) => {
    const handler = (_event: unknown, alert: Alert) => callback(alert);
    ipcRenderer.on("timer:alert", handler);
    return () => ipcRenderer.removeListener("timer:alert", handler);
  },
};
contextBridge.exposeInMainWorld("companion", bridge);
