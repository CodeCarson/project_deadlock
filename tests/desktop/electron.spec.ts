import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { once } from "node:events";

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

test("paired helper export, automatic live-clock reminders and manual override", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-overwolf-"));
  let app: ElectronApplication | undefined;
  let socket: WebSocket | undefined;
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
    await page
      .getByRole("button", { name: "Add reminder", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Event name").fill("Automatic test");
    await dialog.getByLabel("First event (MM:SS)").fill("00:02");
    await dialog.getByLabel("I have verified these timings").check();
    await dialog.getByLabel("Enable audio reminders").check();
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, dir);
    await page
      .getByRole("button", { name: "Export paired helper", exact: true })
      .click();
    await expect(page.getByText(/Helper folder:/)).toBeVisible();
    const folder = await page.evaluate(
      async () => await window.companion!.exportOverwolfHelper(),
    );
    expect(folder).toBeTruthy();
    const config = await readFile(join(folder!, "config.js"), "utf8");
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    const token = JSON.parse(
      await readFile(join(userData, "overwolf-pairing.json"), "utf8"),
    ).token;
    expect(config.includes(token)).toBe(true);
    const manifest = JSON.parse(
      await readFile(join(folder!, "manifest.json"), "utf8"),
    );
    expect(Object.keys(manifest.data.windows)).toEqual(["background"]);
    socket = new WebSocket("ws://127.0.0.1:32145/timer");
    await once(socket, "open");
    const paired = once(socket, "message");
    socket.send(JSON.stringify({ kind: "pair", token }));
    await paired;
    let sequence = 0;
    const clock = (seconds: number, paused = false) =>
      socket!.send(
        JSON.stringify({
          kind: "clock",
          matchId: "123",
          seconds,
          paused,
          observedAt: Date.now(),
          sequence: sequence++,
        }),
      );
    clock(0);
    await expect(
      page.getByText("Following Deadlock’s game clock", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Live Match", exact: true }).click();
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    clock(2);
    await expect(
      page.getByText("Automatic test event now", { exact: true }),
    ).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { tones: number }).tones),
      )
      .toBeGreaterThanOrEqual(3);
    clock(2, true);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.companion!.getTimer())).status,
      )
      .toBe("paused");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    clock(3);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.companion!.getTimer())).status,
      )
      .toBe("running");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    clock(10);
    await expect(
      page.getByText("Manual control for this match", { exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.companion!.getTimer())).status,
    ).toBe("paused");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume automatic tracking", exact: true })
      .click();
    clock(11);
    await expect(
      page.getByText("Following Deadlock’s game clock", { exact: true }),
    ).toBeVisible();
    socket.send(
      JSON.stringify({
        kind: "end",
        matchId: "123",
        observedAt: Date.now(),
        sequence: sequence++,
      }),
    );
    await expect(page.getByText("Match ended", { exact: true })).toBeVisible();
    expect(
      (await page.evaluate(() => window.companion!.getTimer())).log.filter(
        (a) => a.name === "Automatic test",
      ),
    ).toHaveLength(1);
    await page.getByLabel("Enable automatic match tracking").click();
    await expect(
      page.getByLabel("Enable automatic match tracking"),
    ).not.toBeChecked();
    await expect(
      page.getByText("Automatic tracking is off", { exact: true }),
    ).toBeVisible();
  } finally {
    socket?.terminate();
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
