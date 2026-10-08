import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import type { CaptureRegion } from "../src/core/schema.js";
const require = createRequire(import.meta.url);
export class ClockCapture {
  static supported() {
    return process.platform === "win32";
  }
  private child?: ChildProcessWithoutNullStreams;
  private worker?: Worker;
  private pending?: {
    resolve: (frame: { image: string | null; observedAt: number }) => void;
    reject: (error: Error) => void;
  };
  constructor(
    private root: string,
    private unpackedModules?: string,
  ) {}
  async frame(
    region: CaptureRegion,
    preview: boolean,
  ): Promise<{ image: string | null; observedAt: number }> {
    if (!ClockCapture.supported())
      throw new Error("Cropped screen capture is supported on Windows only.");
    if (!this.child) {
      const script = await readFile(
        join(this.root, "scripts/capture-clock.ps1"),
        "utf8",
      );
      const executable = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      this.child = spawn(
        executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true },
      );
      const child = this.child;
      createInterface({ input: child.stdout }).on("line", (line) => {
        const pending = this.pending;
        if (!pending) return;
        this.pending = undefined;
        try {
          const frame = JSON.parse(line);
          if (!Number.isSafeInteger(frame.observedAt) || frame.observedAt <= 0)
            throw new Error();
          if (
            frame.error ||
            (frame.image !== null &&
              (typeof frame.image !== "string" || frame.image.length > 600000))
          )
            throw new Error();
          pending.resolve(frame);
        } catch {
          pending.reject(
            new Error(
              "Clock capture failed. Check Windows capture permissions and use manual controls.",
            ),
          );
        }
      });
      child.stderr.resume();
      const closed = () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.pending?.reject(
          new Error("Windows clock capture is unavailable."),
        );
        this.pending = undefined;
      };
      child.on("error", closed);
      child.on("exit", closed);
    }
    if (this.pending)
      throw new Error("A clock capture is already in progress.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = undefined;
        this.child?.kill();
        this.child = undefined;
        reject(new Error("Clock capture timed out."));
      }, 10000);
      this.pending = {
        resolve: (frame) => {
          clearTimeout(timeout);
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      this.child!.stdin.write(JSON.stringify({ ...region, preview }) + "\n");
    });
  }
  async initialise() {
    if (this.worker) return;
    const modules = this.unpackedModules;
    const lang = modules
      ? join(modules, "@tesseract.js-data/eng/4.0.0")
      : join(
          require.resolve("@tesseract.js-data/eng/package.json"),
          "../4.0.0",
        );
    let expired = false;
    const loading = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: lang,
      cacheMethod: "none",
      gzip: true,
      ...(modules
        ? {
            workerPath: join(
              modules,
              "tesseract.js/src/worker-script/node/index.js",
            ),
            corePath: join(modules, "tesseract.js-core"),
          }
        : {}),
      errorHandler: () => {},
    });
    const cleanup = loading.then(async (worker) => {
      if (expired) await worker.terminate();
      return worker;
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      this.worker = await Promise.race([
        cleanup,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            expired = true;
            reject(new Error("Local OCR initialization timed out."));
          }, 20000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    await this.worker.setParameters({
      tessedit_char_whitelist: "0123456789:",
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      user_defined_dpi: "150",
    });
  }
  async recognise(image: string) {
    await this.initialise();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let result;
    try {
      result = await Promise.race([
        this.worker!.recognize(Buffer.from(image, "base64")),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Local clock recognition timed out.")),
            10000,
          );
        }),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence,
    };
  }
  async close() {
    this.child?.kill();
    this.child = undefined;
    this.pending?.reject(new Error("Clock capture stopped."));
    this.pending = undefined;
    if (this.worker) {
      const worker = this.worker;
      this.worker = undefined;
      await worker.terminate();
    }
  }
}
