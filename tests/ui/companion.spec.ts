import { test, expect } from "@playwright/test";
async function createReminder(
  page: import("@playwright/test").Page,
  name = "Test reminder",
) {
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Event name").fill(name);
  await dialog.getByLabel("First event (MM:SS)").fill("00:02");
  await dialog.getByLabel("I have verified these timings").check();
  await dialog.getByLabel("Enable audio reminders").check();
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expect(dialog).toBeHidden();
}
test("navigation, timer sync, audio, reminder delivery and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Live match", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test sound", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Test sound played");
  await createReminder(page);
  await page.getByRole("button", { name: "Start match", exact: true }).click();
  await expect(
    page.getByText("Test reminder event now", { exact: true }),
  ).toBeVisible({ timeout: 7000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByLabel("Sync to game clock").fill("01:45");
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("01:45");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Notification sound").selectOption("bell");
  await expect(page.getByRole("status")).toHaveText("Settings saved");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Notification sound")).toHaveValue("bell");
  await expect(
    page.getByRole("heading", { name: "Test reminder", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Match History", exact: true })
    .click();
  await expect(page.getByText("PLANNED FOR A LATER PHASE")).toBeVisible();
  await page.getByRole("button", { name: "Heroes", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Know your heroes. Master your matches.",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("invalid clock is explained and game timing categories open their editor", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Sync to game clock").fill("01:99");
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Use minutes:seconds");
  await page
    .getByRole("switch", { name: "Enable Small jungle camp", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Timing type")).toBeDisabled();
});
test("responsive layouts fit the viewport and render all controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("timer")).toBeVisible();
  await page.screenshot({
    path: "test-results/live-match-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 650, height: 900 });
  await expect(
    page.getByRole("button", { name: "Start match", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
