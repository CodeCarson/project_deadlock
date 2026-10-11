import { test, expect } from "@playwright/test";
const match = (id: number, patch = {}) => ({
  match_id: id,
  hero_id: 1,
  start_time: Math.floor(Date.now() / 1000) - id * 3600,
  game_mode: 1,
  player_kills: 5,
  ...patch,
});
test("a Steam name loads one merged archive and retained games survive secondary access failure", async ({
  page,
}) => {
  await page.route("https://api.deadlock-api.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path.endsWith("steam-search") || path.endsWith("/steam")
        ? [{ account_id: 1234, personaname: "Carson" }]
        : path.endsWith("match-history")
          ? [match(1)]
          : path.endsWith("/heroes")
            ? [{ id: 1, name: "Infernus" }]
            : [];
    await route.fulfill({ json: data, headers: { "Called-Steam": "false" } });
  });
  await page.route("https://statlocker.gg/**", async (route) => {
    await route.fulfill({
      json: {
        accountId: "1234",
        matchHistory: route.request().url().endsWith("=1")
          ? [match(1), match(2)]
          : [],
        profileAggregateStats: { accountId: "1234", totalMatches: 506 },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("Carson");
  await expect(page.getByRole("option", { name: /Carson/ })).toBeVisible();
  // A single exact name can also be submitted; duplicate names still require selection.
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(page.locator(".archive-count strong")).toHaveText("2");
  const sources = page.getByLabel("Match history sources");
  await expect(sources).toContainText("Statlocker");
  await expect(sources).toContainText("2 games returned");
  await expect(sources).toContainText("Provider aggregate: 506");
  await expect(page.locator(".archive-count")).not.toContainText("506");
  await page.unroute("https://statlocker.gg/**");
  await page.route("https://statlocker.gg/**", (route) =>
    route.fulfill({ status: 403, body: "" }),
  );
  // Expire caches without waiting on the clock, then recreate the bridge.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter((k) =>
      k.startsWith("deadlock-api.v1."),
    )) {
      const entry = JSON.parse(localStorage.getItem(key)!);
      entry.fetchedAt = 0;
      localStorage.setItem(key, JSON.stringify(entry));
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(page.locator(".archive-count strong")).toHaveText("2");
  await expect(page.getByLabel("Match history sources")).toContainText(
    "access denied",
  );
});
