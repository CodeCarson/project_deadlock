import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { z } from "zod";
export class AlertVoice {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private root: string) {}
  private async start() {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (process.platform !== "win32") return;
      const script = await readFile(
        join(this.root, "scripts/alert-voice.ps1"),
        "utf8",
      );
      const child = spawn(
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, stdio: "pipe" },
      );
      this.child = child;
      child.stderr.on("data", () => {});
      const fail = () => {
        if (this.child !== child) return;
        this.child = undefined;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(
            new Error(
              "Windows speech is unavailable. Try another installed voice.",
            ),
          );
        }
        this.pending.clear();
      };
      child.on("error", fail);
      child.on("exit", fail);
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const value = JSON.parse(line);
          const p = this.pending.get(value.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(value.id);
          if (value.error) p.reject(new Error(value.error));
          else p.resolve(value);
        } catch {
          /* Ignore non-protocol output. */
        }
      });
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async request(value: object): Promise<any> {
    await this.start();
    if (!this.child) throw new Error("Native voices require Windows.");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Windows speech timed out."));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ ...value, id }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  async voices() {
    if (process.platform !== "win32") return [];
    const result = await this.request({ action: "voices" });
    return z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(result.voices);
  }
  async speak(raw: unknown) {
    const input = z
      .object({
        text: z.string().min(1).max(240),
        voice: z.string().max(300),
        speed: z.number().finite().min(0.75).max(2),
        volume: z.number().finite().min(0).max(1),
      })
      .parse(raw);
    await this.request({ action: "speak", ...input });
  }
  close() {
    this.child?.stdin.end();
  }
  async stop() {
    if (this.child) await this.request({ action: "stop" });
  }
}
