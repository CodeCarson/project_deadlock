import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("production app, native persistence, minimized scheduling and audio generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-desktop-"));
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      args: [
        ".",
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
  try {
    app = await launch();
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("heading", { name: "Live match", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => !!window.companion)).toBe(true);
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { require?: unknown }).require,
      ),
    ).toBe("undefined");
    await page.getByRole("button", { name: "Test sound", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Test sound played");
    await page.evaluate(() => {
      (window as unknown as { tones: number }).tones = 0;
      const original = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (
        ...args: Parameters<OscillatorNode["start"]>
      ) {
        (window as unknown as { tones: number }).tones++;
        return original.apply(this, args);
      };
    });
    await page
      .getByRole("button", { name: "Add reminder", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Event name").fill("Minimised test");
    await dialog.getByLabel("First event (MM:SS)").fill("00:03");
    await dialog.getByLabel("I have verified these timings").check();
    await dialog.getByLabel("Enable audio reminders").check();
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { tones: number }).tones),
      )
      .toBeGreaterThanOrEqual(3);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
    ).toBe(true);
    await expect(
      page.getByText("Minimised test event now", { exact: true }),
    ).toBeAttached();
    const state = await page.evaluate(() => window.companion!.getTimer());
    expect(state.log.filter((a) => a.warning === 0)).toHaveLength(1);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Notification sound").selectOption("bell");
    await expect(page.getByRole("status")).toHaveText("Settings saved");
    const settingsFile = await app.evaluate(
      ({ app }) => app.getPath("userData") + "/settings.json",
    );
    expect(settingsFile.startsWith(dir)).toBe(true);
    expect(JSON.parse(await readFile(settingsFile, "utf8")).sound).toBe("bell");
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByRole("timer")).toHaveText("00:00");
    await reopened
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(reopened.getByLabel("Notification sound")).toHaveValue("bell");
    await expect(
      reopened.getByRole("heading", { name: "Minimised test", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
