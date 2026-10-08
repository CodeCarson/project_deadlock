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
    if (process.env.COMPANION_TEST_LIVE_API === "1") {
      for (const resource of [
        "history",
        "profile",
        "heroes",
        "ranks",
      ] as const) {
        const result = await page.evaluate(
          ({ resource }) =>
            window.companion!.request({
              resource,
              accountId:
                resource === "heroes" || resource === "ranks"
                  ? undefined
                  : 1896902807,
            }),
          { resource },
        );
        expect(Array.isArray(result.data)).toBe(true);
        expect((result.data as unknown[]).length).toBeGreaterThan(0);
        expect(result.cached).toBe(false);
      }
    }
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
    // Published-contract fixtures exercise main-process transport, validated IPC and disk cache.
    await app.evaluate(() => {
      globalThis.fetch = async (input) => {
        const url = String(input);
        const data = url.includes("match-history")
          ? [
              {
                match_id: 123,
                hero_id: 1,
                account_id: 1234,
                start_time: 100,
                player_match_outcome: 1,
                player_kills: 5,
                player_deaths: 1,
                player_assists: 4,
              },
            ]
          : url.includes("/players/steam?")
            ? [{ account_id: 1234, personaname: "Native API test" }]
            : url.includes("/card")
              ? { account_id: 1234 }
              : url.includes("/heroes")
                ? [{ id: 1, name: "Abrams" }]
                : [];
        return Response.json(data);
      };
    });
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByLabel("Find your player profile").fill("1234");
    await page
      .getByRole("button", { name: "Load player", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Native API test", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("LIVE API DATA", { exact: true }),
    ).toBeVisible();
    const rejected = await page.evaluate(async () => {
      try {
        await window.companion!.request({ resource: "filesystem" } as never);
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Notification sound").selectOption("bell");
    await expect(page.getByRole("status")).toHaveText("Settings saved");
    const settingsFile = await app.evaluate(
      ({ app }) => app.getPath("userData") + "/settings.json",
    );
    expect(settingsFile.startsWith(dir)).toBe(true);
    expect(JSON.parse(await readFile(settingsFile, "utf8")).sound).toBe("bell");
    expect(JSON.parse(await readFile(settingsFile, "utf8")).accountId).toBe(
      "1234",
    );
    const cached = JSON.parse(
      await readFile(
        join(settingsFile, "../api-cache/history-1234.json"),
        "utf8",
      ),
    );
    expect(cached.data[0].match_id).toBe(123);
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByRole("timer")).toHaveText("00:00");
    await reopened
      .getByRole("button", { name: "Dashboard", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Native API test", exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByText("CACHED DATA", { exact: true }),
    ).toBeVisible();
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
