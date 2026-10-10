import { test, expect, type Page } from "@playwright/test";

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.recordings = [];
    state.spoken = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      state.recordings.push({
        url: this.src,
        rate: this.playbackRate,
        volume: this.volume,
        preservesPitch: this.preservesPitch,
      });
      return original.call(this);
    };
    const voices = [
      { voiceURI: "David", name: "Microsoft David" },
      { voiceURI: "Zira", name: "Microsoft Zira" },
    ];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        constructor(public text: string) {}
        volume = 1;
        rate = 1;
        pitch = 1;
        voice?: { voiceURI: string };
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => voices,
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        speak(u: { text: string; rate: number; voice?: { voiceURI: string } }) {
          state.spoken.push({
            text: u.text,
            rate: u.rate,
            voice: u.voice?.voiceURI ?? "",
          });
        },
      },
    });
  });
}

test("three bundled voices actually play, preserve pitch at speed, and persist alongside sound choices", async ({
  page,
}) => {
  await observeAudio(page);
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Boxes & golden statues", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Golden statues", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Notification sound").locator("option"),
  ).toHaveCount(7);
  await page.getByLabel("Notification sound").selectOption("radio");
  await page.getByLabel("Alert speed", { exact: true }).selectOption("1.75");
  for (const voice of ["am_michael", "af_heart", "bf_emma"]) {
    await page
      .getByLabel("Voice", { exact: true })
      .selectOption(`pack:${voice}`);
    await page.getByRole("button", { name: "Test voice", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Voice preview played");
    expect(
      await page.evaluate(() => (window as any).recordings.at(-1)),
    ).toEqual({
      url: `http://127.0.0.1:5173/voices/${voice}/bridge-ready.ogg`,
      rate: 1.75,
      volume: 0.65,
      preservesPitch: true,
    });
  }
  expect(await page.evaluate(() => (window as any).spoken)).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Notification sound")).toHaveValue("radio");
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue(
    "pack:bf_emma",
  );
  await expect(page.getByLabel("Alert speed")).toHaveValue("1.75");
});

test("system voices still preview and custom text falls back from a bundled voice", async ({
  page,
}) => {
  await observeAudio(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Voice", { exact: true }).selectOption("Zira");
  await page.getByRole("button", { name: "Test voice", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).spoken.at(-1)))
    .toEqual({
      text: "Bridge buffs ready",
      rate: 1.35,
      voice: "Zira",
    });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("Zira");
  await page.getByLabel("Voice", { exact: true }).selectOption("pack:af_heart");
  await page.getByLabel("Speak event announcements").check();
  await page.getByRole("button", { name: "Live Match", exact: true }).click();
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Event name").fill("Drink water");
  await dialog.getByLabel("First event (MM:SS)").fill("00:01");
  await dialog.getByLabel("I have verified these timings").check();
  await dialog.getByLabel("Enable audio reminders").check();
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Start match", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).spoken.at(-1)?.text))
    .toBe("Drink water ready");
  expect(await page.evaluate(() => (window as any).recordings)).toEqual([]);
});
