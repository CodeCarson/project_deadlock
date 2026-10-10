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
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stats", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button"),
  ).toHaveCount(3);
  await page.route("https://api.deadlock-api.com/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.getByRole("button", { name: "Team Planner", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team Planner", exact: true }),
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
    .locator(".rule-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Small jungle camp",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Edit rule", exact: true })
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

test("current defaults are enabled and editable; Rift shows a window and a manual appearance action", async ({
  page,
}) => {
  await page.goto("/");
  const switches = page.getByRole("switch", { name: /Enable / });
  expect(await switches.count()).toBe(7);
  for (const toggle of await switches.all())
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  const small = page.locator(".rule-card").filter({
    has: page.getByRole("heading", {
      name: "Small jungle camp",
      exact: true,
    }),
  });
  await small.getByRole("button", { name: "Edit rule", exact: true }).click();
  await expect(page.getByLabel("First event (MM:SS)")).toHaveValue("02:00");
  await expect(page.getByLabel("Respawn delay (MM:SS)")).toHaveValue("01:25");
  await page.getByLabel("Respawn delay (MM:SS)").fill("01:30");
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await page.getByRole("button", { name: "Start match", exact: true }).click();
  await page.getByLabel("Sync to game clock").fill("10:30");
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  const rift = page.locator(".rule-card").filter({
    has: page.getByRole("heading", { name: "Unstable Rift", exact: true }),
  });
  await expect(rift.getByText("Open", { exact: true })).toBeVisible();
  await expect(rift.getByText("10:00–12:00", { exact: true })).toBeVisible();
  await rift
    .getByRole("button", { name: "Mark appeared", exact: true })
    .click();
  // The running clock may advance between Sync and the user clicking Mark appeared.
  const appeared = await rift.getByText(/^Appeared at /).innerText();
  const match = /Appeared at\s+(\d+):(\d{2})/.exec(appeared);
  expect(match).not.toBeNull();
  const minutes = Number(match![1]),
    seconds = Number(match![2]);
  const at = minutes * 60 + seconds;
  const clock = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  await expect(
    rift.getByText(`${clock(at + 360)}–${clock(at + 480)}`, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await small.getByRole("button", { name: "Edit rule", exact: true }).click();
  await expect(page.getByLabel("Respawn delay (MM:SS)")).toHaveValue("01:30");
});
