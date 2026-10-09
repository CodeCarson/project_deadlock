import {
  app,
  BrowserWindow,
  ipcMain,
  powerSaveBlocker,
  shell,
  screen,
} from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { ClockReader } from "../src/core/clock-reader.js";
import { ClockCapture } from "./clock-capture.js";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ApiClient } from "../src/core/api.js";
import { migrateSettings } from "../src/core/settings.js";
import { TimerEngine } from "../src/core/timer.js";
import {
  defaultSettings,
  captureRegionSchema,
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
  let detection: ClockReader;
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
      detection = new ClockReader(engine);
      const capture = new ClockCapture(
        app.isPackaged ? process.resourcesPath : join(here, "../.."),
        app.isPackaged
          ? join(process.resourcesPath, "app.asar.unpacked/node_modules")
          : undefined,
      );
      let generation = 0;
      let captureTimer: ReturnType<typeof setTimeout> | undefined;
      let jobs = Promise.resolve();
      const serial = <T>(task: () => Promise<T>): Promise<T> => {
        const result = jobs.then(task);
        jobs = result.then(
          () => {},
          () => {},
        );
        return result;
      };
      const pixels = (display: Electron.Display) =>
        process.platform === "win32"
          ? screen.dipToScreenRect(null, display.bounds)
          : display.bounds;
      const validateRegion = (raw: unknown) => {
        const region = captureRegionSchema.parse(raw);
        const allowed = screen.getAllDisplays().some((display) => {
          const bounds = pixels(display);
          const start = { x: bounds.x, y: bounds.y };
          const end = {
            x: bounds.x + bounds.width,
            y: bounds.y + bounds.height,
          };
          return (
            region.x >= start.x &&
            region.y >= start.y &&
            region.x + region.width <= end.x &&
            region.y + region.height <= end.y
          );
        });
        if (!allowed)
          throw new Error("Choose a clock area entirely inside one display.");
        return region;
      };
      const reconcileCapture = async () => {
        const run = ++generation;
        clearTimeout(captureTimer);
        detection.configure(settings.automaticTracking);
        if (!settings.automaticTracking) {
          await serial(() => capture.close());
          return;
        }
        if (!settings.captureRegion) {
          detection.error("Choose and test the clock area first");
          return;
        }
        if (!ClockCapture.supported()) {
          detection.error(
            "Clock capture requires Windows — use manual controls here",
          );
          return;
        }
        const sample = async () => {
          const started = Date.now();
          await serial(async () => {
            if (run !== generation) return;
            if (detection.snapshot().manualOverride) return;
            try {
              const region = validateRegion(settings.captureRegion);
              await capture.initialise();
              if (run !== generation) return;
              const frame = await capture.frame(region, false);
              if (!frame.image) {
                if (run === generation) detection.missing();
                return;
              }
              const result = await capture.recognise(frame.image);
              if (run === generation)
                detection.reading(
                  result.text,
                  result.confidence,
                  frame.observedAt,
                );
            } catch {
              if (run === generation) {
                detection.missing();
                detection.error(
                  "Clock reader unavailable — check the crop and use manual controls",
                );
              }
            }
          });
          if (run === generation)
            captureTimer = setTimeout(
              () => void sample(),
              Math.max(100, 1000 - (Date.now() - started)),
            );
        };
        void sample();
      };
      await reconcileCapture();
      const snapshot = () => ({
        ...engine.snapshot(),
        detection: detection.snapshot(),
      });
      ipcMain.handle("capture:resume", (event) => {
        trusted(event);
        detection.resume();
      });
      ipcMain.handle("capture:displays", (event) => {
        trusted(event);
        return screen.getAllDisplays().map((display) => {
          const bounds = pixels(display);
          const start = { x: bounds.x, y: bounds.y };
          const end = {
            x: bounds.x + bounds.width,
            y: bounds.y + bounds.height,
          };
          return {
            id: String(display.id),
            name: display.label || `Display ${display.id}`,
            x: start.x,
            y: start.y,
            width: end.x - start.x,
            height: end.y - start.y,
          };
        });
      });
      ipcMain.handle("capture:preview", (event, raw) => {
        trusted(event);
        const region = validateRegion(raw);
        return serial(async () => {
          try {
            await capture.initialise();
            const frame = await capture.frame(region, true);
            if (!frame.image)
              throw new Error("Could not capture the selected clock area.");
            const result = await capture.recognise(frame.image, true);
            return { image: `data:image/png;base64,${frame.image}`, ...result };
          } finally {
            if (!settings.automaticTracking) await capture.close();
          }
        });
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
        await reconcileCapture();
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
