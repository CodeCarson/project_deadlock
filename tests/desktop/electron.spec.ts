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
    await expect(page.getByText("API RESPONSE", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Heroes", exact: true }).click();
    await page.getByLabel("Filter by hero").selectOption("1");
    await expect(
      page.getByRole("heading", { name: "Hero analytics", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Match History", exact: true })
      .click();
    await expect(page.locator(".history-match")).toHaveCount(1);
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
    expect(
      JSON.parse(await readFile(settingsFile, "utf8")).playerFilters.hero,
    ).toBe("1");
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
    await expect(reopened.getByLabel("Filter by hero")).toHaveValue("1");
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

test("local OCR calibration and sampled-clock reminders while minimised", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-capture-"));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
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
    const page = await app.firstWindow();
    const images = await page.evaluate(() => {
      const image = (text: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 72;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "black";
        context.fillRect(0, 0, 200, 72);
        context.fillStyle = "white";
        context.font = "bold 48px monospace";
        context.fillText(text, 16, 54);
        return canvas.toDataURL("image/png").split(",")[1];
      };
      return [image("00:00"), image("00:03"), image("00:10"), image("menu")];
    });
    const fixtures = await page.evaluate(() => {
      const specs = [
        {
          text: "09:08",
          font: "14px sans-serif",
          background: "#191e23",
          ink: "#e5dbba",
        },
        {
          text: "10:59",
          font: "18px sans-serif",
          background: "#353a40",
          ink: "#999c9f",
        },
        {
          text: "00:03",
          font: "bold 20px serif",
          background: "#202020",
          ink: "#dadada",
        },
        {
          text: "01:10",
          font: "18px monospace",
          background: "#e0e0e0",
          ink: "#303030",
        },
        {
          text: "02:05",
          font: "24px sans-serif",
          background: "#1a2935",
          ink: "#c5b58d",
        },
      ];
      return specs.map((spec) => {
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 40;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = spec.background;
        ctx.fillRect(0, 0, 120, 40);
        ctx.fillStyle = spec.ink;
        ctx.font = spec.font;
        ctx.fillText(spec.text, 16, 28);
        return {
          expected: spec.text,
          image: canvas.toDataURL("image/png").split(",")[1],
        };
      });
    });
    const recognised = await app.evaluate(async ({ app }, fixtures) => {
      const loader = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const { ClockCapture } = loader(
        app.getAppPath() + "/dist-electron/electron/clock-capture.js",
      );
      const capture = new ClockCapture(app.getAppPath());
      try {
        const results = [];
        for (const fixture of fixtures)
          results.push({
            expected: fixture.expected,
            ...(await capture.recognise(fixture.image)),
          });
        return results;
      } finally {
        await capture.close();
      }
    }, fixtures);
    for (const reading of recognised) {
      expect(reading.text, JSON.stringify(reading)).toBe(reading.expected);
      expect(
        reading.confidence,
        JSON.stringify(reading),
      ).toBeGreaterThanOrEqual(80);
    }
    // Only the OS crop source is simulated. Real bundled OCR reads these pixels.
    await app.evaluate(async ({ app }, image) => {
      const loader = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const module = loader(
        app.getAppPath() + "/dist-electron/electron/clock-capture.js",
      );
      module.ClockCapture.supported = () => true;
      (globalThis as any).clockImage = image;
      (globalThis as any).clockVisible = true;
      module.ClockCapture.prototype.frame = async function (
        _region: unknown,
        preview: boolean,
      ) {
        return {
          image:
            preview || (globalThis as any).clockVisible
              ? (globalThis as any).clockImage
              : null,
          observedAt: Date.now(),
        };
      };
    }, images[3]);
    await page
      .getByRole("button", { name: "Add reminder", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Event name").fill("Screen clock test");
    await dialog.getByLabel("First event (MM:SS)").fill("00:03");
    await dialog.getByLabel("I have verified these timings").check();
    await dialog.getByLabel("Enable audio reminders").check();
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Test clock crop", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save clock area", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText(/not reliable yet/)).toBeVisible({
      timeout: 20000,
    });
    await page
      .getByRole("button", { name: "Save clock area", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Settings saved");
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).toBeEnabled();
    await page.getByLabel("Enable automatic match tracking").click();
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).toBeChecked();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.companion!.getTimer())).detection
            ?.message,
      )
      .toContain("Clock unavailable");
    expect(
      (await page.evaluate(() => window.companion!.getTimer())).status,
    ).not.toBe("running");
    await page.getByLabel("Enable automatic match tracking").click();
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).not.toBeChecked();
    await app.evaluate((_electron, image) => {
      (globalThis as any).clockImage = image;
    }, images[0]);
    await page
      .getByRole("button", { name: "Test clock crop", exact: true })
      .click();
    await expect(page.getByText(/Read: 00:00/)).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("button", { name: "Save clock area", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Settings saved");
    await page.getByLabel("Enable automatic match tracking").click();
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).toBeChecked();
    await expect(
      page.getByText("Following the visible game clock", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Live Match", exact: true }).click();
    await page.evaluate(() => {
      (window as any).tones = 0;
      const original = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (
        ...args: Parameters<OscillatorNode["start"]>
      ) {
        (window as any).tones++;
        return original.apply(this, args);
      };
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await app.evaluate((_electron, image) => {
      (globalThis as any).clockImage = image;
    }, images[1]);
    await expect(
      page.getByText("Screen clock test event now", { exact: true }),
    ).toBeAttached({ timeout: 10000 });
    await expect
      .poll(() => page.evaluate(() => (window as any).tones))
      .toBeGreaterThanOrEqual(3);
    await app.evaluate(() => {
      (globalThis as any).clockVisible = false;
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.companion!.getTimer())).status,
      )
      .toBe("paused");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await page
      .getByRole("button", { name: "Resume match", exact: true })
      .click();
    await expect(
      page.getByText("Manual control — resume automatic tracking when ready", {
        exact: true,
      }),
    ).toBeVisible();
    await app.evaluate((_electron, image) => {
      (globalThis as any).clockVisible = true;
      (globalThis as any).clockImage = image;
    }, images[2]);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume automatic tracking", exact: true })
      .click();
    await expect(
      page.getByText("Following the visible game clock", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    expect(
      (await page.evaluate(() => window.companion!.getTimer())).log.filter(
        (a) => a.name === "Screen clock test",
      ),
    ).toHaveLength(1);
    await page.getByLabel("Enable automatic match tracking").click();
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).not.toBeChecked();
    const settingsFile = await app.evaluate(
      ({ app }) => app.getPath("userData") + "/settings.json",
    );
    const saved = JSON.parse(await readFile(settingsFile, "utf8"));
    expect(saved.captureRegion).toMatchObject({
      x: 0,
      y: 0,
      width: 200,
      height: 72,
    });
    expect(saved.automaticTracking).toBe(false);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
