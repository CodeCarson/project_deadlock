import { test, expect } from "@playwright/test";
test("new alert sounds, alternate installed voice and speed persist, and the voice preview is brief", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      preview?: { text: string; voice: string; rate: number };
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
          state.preview = {
            text: u.text,
            rate: u.rate,
            voice: u.voice?.voiceURI ?? "",
          };
        },
      },
    });
  });
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
  await page.getByLabel("Voice", { exact: true }).selectOption("lookout");
  await page
    .getByLabel("Installed voice", { exact: true })
    .selectOption("Zira");
  await page.getByLabel("Alert speed", { exact: true }).selectOption("1.75");
  await page.getByRole("button", { name: "Test voice", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Voice preview played");
  expect(await page.evaluate(() => (window as any).preview)).toEqual({
    text: "Bridge buffs ready",
    voice: "Zira",
    rate: 1.75,
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Notification sound")).toHaveValue("radio");
  await expect(page.getByLabel("Installed voice")).toHaveValue("Zira");
  await expect(page.getByLabel("Alert speed")).toHaveValue("1.75");
});
