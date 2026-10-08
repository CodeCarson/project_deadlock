import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const now = Math.floor(Date.now() / 1000);
const matches = [
  {
    match_id: 101,
    account_id: 1234,
    hero_id: 1,
    start_time: now - 3600,
    game_mode: 1,
    player_match_outcome: 1,
    ranked_display_badge: 72,
    player_kills: 8,
    player_deaths: 2,
    player_assists: 6,
    net_worth: 12000,
    match_duration_s: 1200,
    last_hits: 40,
    denies: 5,
  },
  {
    match_id: 102,
    account_id: 1234,
    hero_id: 2,
    start_time: now - 86400 * 10,
    game_mode: 4,
    player_match_outcome: 2,
    player_kills: 2,
    player_deaths: 4,
    player_assists: 4,
    net_worth: 10000,
    match_duration_s: 1200,
  },
  {
    match_id: 103,
    account_id: 1234,
    hero_id: 1,
    start_time: now - 7200,
    game_mode: 1,
    player_match_outcome: 5,
  },
];
async function mockApi(page: Page) {
  await page.route("https://api.deadlock-api.com/**", async (route) => {
    const url = new URL(route.request().url());
    const data = url.pathname.endsWith("match-history")
      ? matches
      : url.pathname.endsWith("steam")
        ? [
            { account_id: 999, personaname: "Wrong player" },
            { account_id: 1234, personaname: "Test player" },
          ]
        : url.pathname.endsWith("card")
          ? { account_id: 1234, ranked_badge_level: 72 }
          : url.pathname.endsWith("heroes")
            ? [
                { id: 1, name: "Abrams" },
                { id: 2, name: "Bebop" },
              ]
            : [{ tier: 7, name: "Archon" }];
    await route.fulfill({ json: data });
  });
}
async function lookup(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("76561197960266962");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Test player", exact: true }),
  ).toBeVisible();
}
test("player lookup shows exact profile, real outcome summaries, filters and match details", async ({
  page,
}) => {
  await mockApi(page);
  await lookup(page);
  await expect(page.getByText("Wrong player", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Archon 2", { exact: false })).toBeVisible();
  await expect(
    page.getByText("1 wins · 1 losses · 1 unscored", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("50.0%", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Filter by hero").selectOption("1");
  await expect(
    page.getByText("2 of 3 available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 wins · 0 losses · 1 unscored", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by hero").selectOption("all");
  await page.getByLabel("Filter by time period").selectOption("7");
  await expect(
    page.getByText("2 of 3 available", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by game mode").selectOption("4");
  await expect(
    page.getByRole("heading", { name: "No matches match these filters." }),
  ).toBeVisible();
  await page.getByLabel("Filter by time period").selectOption("all");
  await expect(
    page.getByText("1 of 3 available", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by game mode").selectOption("all");
  await page.locator(".recent-match").first().locator("summary").click();
  await expect(
    page.getByText("Match ID", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase2-dashboard.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 650, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("account selection persists and offline cache is labelled after a failed fetch", async ({
  page,
}) => {
  await mockApi(page);
  await lookup(page);
  await page.reload();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByLabel("Find your player profile")).toHaveValue("1234");
  await expect(page.getByText("CACHED DATA", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith("deadlock-api.v1.")) {
        const value = JSON.parse(localStorage.getItem(key)!);
        value.fetchedAt = Date.now() - 86400001;
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  });
  await page.unroute("https://api.deadlock-api.com/**");
  await page.route("https://api.deadlock-api.com/**", (route) => route.abort());
  await page.reload();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Test player", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OFFLINE CACHE", { exact: true })).toBeVisible();
});
test("invalid identifiers are explained and a failed new account never displays the previous player's statistics", async ({
  page,
}) => {
  await mockApi(page);
  await lookup(page);
  await page
    .getByLabel("Find your player profile")
    .fill("https://steamcommunity.com/id/vanity");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Vanity names");
  await page.unroute("https://api.deadlock-api.com/**");
  await page.route("https://api.deadlock-api.com/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.getByLabel("Find your player profile").fill("5678");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No public data");
  await expect(
    page.getByRole("heading", { name: "Test player", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".stats-grid")).toHaveCount(0);
});
