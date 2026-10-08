import { app, BrowserWindow, ipcMain, powerSaveBlocker } from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  const power = () => {
    if (engine.snapshot().status === "running" && blocker === undefined)
      blocker = powerSaveBlocker.start("prevent-app-suspension");
    else if (engine.snapshot().status !== "running" && blocker !== undefined) {
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
        settings = settingsSchema.parse(
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
      engine = new TimerEngine(settings);
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
        return next;
      });
      ipcMain.handle("timer:get", (event) => {
        trusted(event);
        return engine.snapshot();
      });
      ipcMain.handle("timer:command", (event, raw) => {
        trusted(event);
        sendAlerts(engine.tick());
        const result = engine.command(raw);
        power();
        return result;
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
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
        sendAlerts(engine.tick());
        window?.webContents.send("timer:state", engine.snapshot());
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
