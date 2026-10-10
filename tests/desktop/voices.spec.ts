import catalog from "../../config/voice-packs.json" with { type: "json" };
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("production offline voice files decode and finish, including an alert while minimized", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-voices-"));
  let app: ElectronApplication | undefined;
  try {
    const packaged = process.env.COMPANION_TEST_EXECUTABLE;
    app = await electron.launch({
      executablePath: packaged ? resolve(packaged) : undefined,
      args: [
        ...(packaged ? [] : ["."]),
        `--user-data-dir=${join(dir, "profile")}`,
        ...(process.env.COMPANION_TEST_NO_SANDBOX === "1"
          ? ["--no-sandbox"]
          : []),
      ],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: dir,
        XDG_CACHE_HOME: join(dir, "cache"),
      },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://**/*", (route) => route.abort());
    await page.evaluate(() => {
      (window as any).voiceStarts = [];
      (window as any).voiceEnds = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        (window as any).voiceStarts.push({
          url: this.src,
          rate: this.playbackRate,
          pitch: this.preservesPitch,
          volume: this.volume,
        });
        this.addEventListener(
          "ended",
          () =>
            (window as any).voiceEnds.push({
              duration: this.duration,
              seconds: this.currentTime,
            }),
          { capture: true, once: true },
        );
        return original.call(this);
      };
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Alert speed", { exact: true }).selectOption("1.5");
    for (const [index, voice] of catalog.voices
      .map((voice) => voice.id.slice(5))
      .entries()) {
      await page
        .getByLabel("Voice", { exact: true })
        .selectOption(`pack:${voice}`);
      await page
        .getByRole("button", { name: "Test voice", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText("Voice preview played");
      const starts = await page.evaluate(() => (window as any).voiceStarts);
      expect(starts).toHaveLength(index + 1);
      expect(starts.at(-1)).toMatchObject({
        rate: 1.5,
        pitch: true,
        volume: 0.65,
      });
      expect(
        starts.at(-1).url.endsWith(`/voices/${voice}/bridge-ready.ogg`),
      ).toBe(true);
    }
    expect(await page.evaluate(() => (window as any).voiceEnds)).toHaveLength(
      catalog.voices.length,
    );
    await expect
      .poll(() =>
        page
          .locator(".brand .deadlock-wordmark")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await page.getByLabel("Voice", { exact: true }).selectOption("pack:seven");
    await page.evaluate(() => window.companion!.stopAlertSpeech());
    await page.getByLabel("Speak event announcements").click();
    await expect(page.getByLabel("Speak event announcements")).toBeChecked();
    await expect(page.getByRole("status")).toHaveText("Settings saved");
    await page.evaluate(async () => {
      const settings = await window.companion!.loadSettings();
      await window.companion!.saveSettings({
        ...settings,
        warnings: [],
        rules: settings.rules
          .filter((rule) => rule.id === "bridge")
          .map((rule) => ({ ...rule, firstSpawn: 2 })),
      });
    });
    await page.getByRole("button", { name: "Live Match", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).voiceEnds.length))
      .toBe(catalog.voices.length + 1);
    expect(
      (await page.evaluate(() => (window as any).voiceStarts)).at(-1).url,
    ).toContain("/voices/seven/bridge-ready.ogg");
    for (const end of await page.evaluate(() => (window as any).voiceEnds)) {
      expect(end.duration).toBeGreaterThan(0.35);
      expect(end.duration).toBeLessThan(6);
      expect(end.seconds).toBeCloseTo(end.duration, 1);
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
