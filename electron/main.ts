import {
  app,
  BrowserWindow,
  ipcMain,
  powerSaveBlocker,
  shell,
  dialog,
} from "electron";
import { readFile, writeFile, mkdir, rename, cp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { MatchDetection } from "../src/core/detection.js";
import { startOverwolfServer, HELPER_PORT } from "./overwolf-server.js";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ApiClient } from "../src/core/api.js";
import { migrateSettings } from "../src/core/settings.js";
import { TimerEngine } from "../src/core/timer.js";
import {
  defaultSettings,
  settingsSchema,
  type Settings,
  type Alert,
} from "../src/core/schema.js";
const here = dirname(fileURLToPath(import.meta.url));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | null = null;
  let blocker: number | undefined;
  let settings: Settings = structuredClone(defaultSettings);
  let engine: TimerEngine;
  let detection: MatchDetection;
  let helperServer: Awaited<ReturnType<typeof startOverwolfServer>> | undefined;
  let saveQueue = Promise.resolve();
  const atomicWrite = (path: string, contents: string) => {
    const task = saveQueue.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.tmp`, contents, "utf8");
      await rename(`${path}.tmp`, path);
    });
    saveQueue = task.catch(() => {});
    return task;
  };
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted request.");
  };
  const sendAlerts = (alerts: Alert[]) =>
    alerts.forEach((a) => window?.webContents.send("timer:alert", a));
  const power = (status = engine.snapshot().status) => {
    if (status === "running" && blocker === undefined)
      blocker = powerSaveBlocker.start("prevent-app-suspension");
    else if (status !== "running" && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
    }
  };
  app.on("second-instance", () => {
    window?.restore();
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const dataRoot = app.getPath("userData");
      const settingsFile = join(dataRoot, "settings.json");
      try {
        settings = migrateSettings(
          JSON.parse(await readFile(settingsFile, "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Preserve invalid files for recovery rather than silently overwriting them.
          await rename(
            settingsFile,
            join(dataRoot, `settings.invalid-${Date.now()}.json`),
          ).catch(() => {});
          console.warn("Invalid settings were preserved; defaults loaded.");
        }
      }
      await atomicWrite(settingsFile, JSON.stringify(settings, null, 2)).catch(
        () => {
          console.warn(
            "Could not persist settings migration; existing settings were kept.",
          );
        },
      );
      const cacheRoot = join(dataRoot, "api-cache");
      const api = new ApiClient({
        async get(key) {
          try {
            return JSON.parse(
              await readFile(join(cacheRoot, `${key}.json`), "utf8"),
            );
          } catch {
            return undefined;
          }
        },
        async set(key, entry) {
          await atomicWrite(
            join(cacheRoot, `${key}.json`),
            JSON.stringify(entry),
          );
        },
      });
      ipcMain.handle("api:request", (event, raw) => {
        trusted(event);
        return api.request(raw);
      });
      engine = new TimerEngine(settings);
      detection = new MatchDetection(engine);
      let token: string;
      const pairingFile = join(dataRoot, "overwolf-pairing.json");
      try {
        const stored = JSON.parse(await readFile(pairingFile, "utf8"));
        if (!/^[a-f0-9]{64}$/.test(stored.token))
          throw new Error("Invalid pairing key");
        token = stored.token;
      } catch {
        token = randomBytes(32).toString("hex");
        await mkdir(dataRoot, { recursive: true });
        await writeFile(pairingFile, JSON.stringify({ token }), {
          mode: 0o600,
        });
      }
      let serverQueue = Promise.resolve();
      const reconcileHelper = () => {
        detection.configure(settings.automaticTracking);
        serverQueue = serverQueue.then(async () => {
          if (!settings.automaticTracking && helperServer) {
            await helperServer.close();
            helperServer = undefined;
          }
          if (settings.automaticTracking && !helperServer) {
            try {
              helperServer = await startOverwolfServer(token, detection);
            } catch {
              detection.error(
                "Local helper connection unavailable — use manual controls or restart the app",
              );
            }
          }
        });
        return serverQueue;
      };
      await reconcileHelper();
      const snapshot = () => ({
        ...engine.snapshot(),
        detection: detection.snapshot(),
      });
      ipcMain.handle("overwolf:resume", (event) => {
        trusted(event);
        detection.resume();
      });
      ipcMain.handle("overwolf:export", async (event) => {
        trusted(event);
        if (!window) return null;
        const selection = await dialog.showOpenDialog(window, {
          title: "Choose where to save the Overwolf helper",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selection.canceled) return null;
        const folder = join(
          selection.filePaths[0],
          `Deadlock Companion Helper ${Date.now()}`,
        );
        const source = app.isPackaged
          ? join(process.resourcesPath, "overwolf-helper")
          : join(here, "../../overwolf-helper");
        await cp(source, folder, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        await writeFile(
          join(folder, "config.js"),
          `window.HELPER_CONFIG = ${JSON.stringify({ endpoint: `ws://127.0.0.1:${HELPER_PORT}/timer`, token })};\n`,
          { mode: 0o600 },
        );
        return folder;
      });
      ipcMain.handle("settings:load", (event) => {
        trusted(event);
        return settings;
      });
      ipcMain.handle("settings:save", async (event, raw) => {
        trusted(event);
        const next = settingsSchema.parse(raw);
        await atomicWrite(settingsFile, JSON.stringify(next, null, 2));
        sendAlerts(engine.tick());
        engine.updateSettings(next);
        settings = next;
        await reconcileHelper();
        return next;
      });
      ipcMain.handle("timer:get", (event) => {
        trusted(event);
        return snapshot();
      });
      ipcMain.handle("timer:command", (event, raw) => {
        trusted(event);
        sendAlerts(engine.tick());
        engine.command(raw);
        detection.manual(raw);
        power();
        return snapshot();
      });
      const productionUrl = pathToFileURL(
        join(here, "../../dist/index.html"),
      ).href;
      const devUrl = "http://127.0.0.1:5173";
      const createWindow = () => {
        window = new BrowserWindow({
          width: 1440,
          height: 940,
          minWidth: 850,
          minHeight: 620,
          backgroundColor: "#101116",
          title: "Deadlock Companion",
          webPreferences: {
            preload: join(here, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        window.webContents.setWindowOpenHandler(({ url }) => {
          if (url === "https://api.deadlock-api.com/docs")
            void shell.openExternal(url);
          return { action: "deny" };
        });
        window.webContents.on("will-navigate", (event, url) => {
          if (url !== productionUrl && (app.isPackaged || url !== devUrl + "/"))
            event.preventDefault();
        });
        window.webContents.session.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        );
        window.on("closed", () => {
          window = null;
        });
        if (!app.isPackaged && process.argv.includes("--dev"))
          void window.loadURL(devUrl);
        else void window.loadFile(join(here, "../../dist/index.html"));
      };
      createWindow();
      setInterval(() => {
        detection.check();
        sendAlerts(engine.tick());
        const state = snapshot();
        power(state.status);
        window?.webContents.send("timer:state", state);
      }, 200);
      app.on("activate", () => {
        if (!window) createWindow();
      });
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
}
