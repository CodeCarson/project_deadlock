import { test, expect, type Page } from "@playwright/test";
const now = Math.floor(Date.now() / 1000);
const heroes = [
  {
    id: 1,
    name: "Infernus",
    hero_type: "marksman",
    description: {
      role: "Damage over time",
      playstyle: "Burn enemies and sustain through fights.",
    },
  },
  {
    id: 6,
    name: "Abrams",
    hero_type: "brawler",
    description: { role: "Close combat", playstyle: "Commit with your team." },
  },
  {
    id: 11,
    name: "Dynamo",
    hero_type: "mystic",
    description: {
      role: "Team control",
      playstyle: "Coordinate your important cooldowns.",
    },
  },
  { id: 12, name: "Kelvin", hero_type: "brawler" },
  { id: 13, name: "Haze", hero_type: "assassin" },
  { id: 18, name: "Mo & Krill", hero_type: "brawler" },
  { id: 27, name: "Yamato", hero_type: "assassin" },
  { id: 35, name: "Viscous", hero_type: "mystic" },
];
const distribution = (values: number[]) => ({
  avg: values[4],
  std: 3,
  ...Object.fromEntries(
    [1, 5, 10, 25, 50, 75, 90, 95, 99].map((p, i) => [
      `percentile${p}`,
      values[i],
    ]),
  ),
});
const metrics = {
  deaths: distribution([0, 1, 2, 3, 5, 7, 9, 10, 14]),
  kills_plus_assists: distribution([1, 3, 5, 12, 20, 28, 35, 40, 50]),
  last_hits: distribution([20, 50, 80, 110, 150, 200, 240, 270, 320]),
  net_worth_per_min: distribution([
    100, 200, 400, 750, 1000, 1300, 1600, 1800, 2200,
  ]),
};
async function fixtures(page: Page) {
  await page.route("https://api.deadlock-api.com/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname;
    let data: unknown = [];
    if (p.endsWith("steam-search"))
      data = [{ account_id: 5678, personaname: "Teammate" }];
    else if (p.endsWith("match-history")) {
      const account = Number(p.split("/")[3]);
      data = Array.from({ length: 36 }, (_, i) => {
        const hero = heroes[i % 3].id;
        return {
          match_id: 5000 + i,
          account_id: account,
          hero_id: hero,
          start_time: now - i * 3600,
          game_mode: 1,
          match_mode: 1,
          match_duration_s: 1800,
          player_match_outcome: i % 4 ? 1 : 2,
          player_kills: hero === 1 ? 8 : hero === 6 ? 4 : 9,
          player_assists: hero === 1 ? 12 : hero === 6 ? 5 : 10,
          player_deaths: hero === 1 ? 1 : hero === 6 ? 10 : 6,
          last_hits: hero === 1 ? 220 : hero === 6 ? 140 : 180,
          net_worth: hero === 1 ? 40000 : hero === 6 ? 30000 : 32000,
        };
      });
    } else if (p.endsWith("/steam"))
      data = [
        {
          account_id: Number(url.searchParams.get("account_ids")),
          personaname: `Tester ${url.searchParams.get("account_ids")}`,
        },
      ];
    else if (p.endsWith("/heroes")) data = heroes;
    else if (p.endsWith("/metrics")) data = metrics;
    else if (p.endsWith("/hero-stats"))
      data = heroes.map((h) => ({
        hero_id: h.id,
        matches: 2000,
        wins: 1000,
        losses: 1000,
      }));
    else if (p.endsWith("/hero-synergy-stats"))
      data = heroes.flatMap((h, i) =>
        heroes.slice(i + 1).map((g) => ({
          hero_id1: h.id,
          hero_id2: g.id,
          wins: 60,
          matches_played: 100,
        })),
      );
    else if (p.endsWith("/hero-comb-stats"))
      data = [
        {
          hero_ids: heroes.slice(0, 6).map((h) => h.id),
          wins: 65,
          losses: 35,
          matches: 100,
        },
      ];
    else if (p.endsWith("/metadata")) {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    await route.fulfill({
      json: data,
      headers: {
        "Called-Steam": "false",
        "Access-Control-Expose-Headers": "Called-Steam",
      },
    });
  });
}
async function profile(page: Page) {
  await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("1234");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tester 1234", exact: true }),
  ).toBeVisible();
}
test("one Stats workspace gives hero-aware game coaching, a saved Companion estimate and three performance-ranked heroes", async ({
  page,
}) => {
  await profile(page);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Calculate Companion rank", exact: true })
    .click();
  await expect(
    page.getByText("Performance estimate updated.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".top-hero-card")).toHaveCount(3);
  await expect(page.locator(".top-hero-card").first()).toContainText(
    "Infernus",
  );
  await expect(page.locator(".top-hero-card").last()).toContainText("Abrams");
  await page.getByLabel("Match to review").selectOption("5001");
  await expect(page.locator(".match-coaching")).toContainText("Review this");
  await expect(page.locator(".match-coaching")).toContainText("Deaths");
  await expect(page.locator(".match-coaching")).toContainText("brawler");
  await page
    .getByRole("button", { name: "Add this focus to my note", exact: true })
    .click();
  await expect(page.getByLabel("Match review note")).toHaveValue(
    /Abrams.*route back to cover/,
  );
  await page
    .getByRole("button", { name: "Save review note", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(page.getByText(/Saved estimate:/)).toBeVisible();
  await page.getByLabel("Match to review").selectOption("5001");
  await expect(page.getByLabel("Match review note")).toHaveValue(
    /Abrams.*route back to cover/,
  );
  await page.setViewportSize({ width: 650, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
test("team planner resolves Steam suggestions, honors a preferred hero and shows recorded composition evidence", async ({
  page,
}) => {
  await profile(page);
  await page.getByRole("button", { name: "Team Planner", exact: true }).click();
  await expect(page.locator(".planner-slot").first()).toContainText(
    "Tester 1234",
  );
  await page.getByLabel("Position 2 Steam name or ID").fill("Team");
  const slot = page.locator(".planner-slot").nth(1);
  await slot.getByRole("option").getByRole("button").click();
  await expect(slot).toContainText("Tester 5678");
  await page.getByLabel("Position 2 hero lock").selectOption("6");
  await page
    .getByRole("button", { name: "Recommend team composition", exact: true })
    .click();
  await expect(page.locator(".recommended-comp").first()).toBeVisible();
  await expect(page.locator(".recommended-comp").first()).toContainText(
    "Recorded complete lineup: 100 matches",
  );
  await expect(
    page.locator(".recommended-comp").first().locator(".comp-picks article"),
  ).toHaveCount(6);
  await expect(
    page
      .locator(".recommended-comp")
      .first()
      .locator(".comp-picks article")
      .nth(1),
  ).toContainText("Abrams");
  await page
    .locator(".recommended-comp")
    .first()
    .getByText("Why this lineup & pair evidence", { exact: true })
    .click();
  await expect(page.locator(".recommended-comp").first()).toContainText(
    "15/15 hero pairs",
  );
  await page.setViewportSize({ width: 650, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByLabel("Position 2 Steam name or ID").fill("1234");
  await slot.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(slot).toContainText("Tester 1234");
  await page
    .getByRole("button", { name: "Recommend team composition", exact: true })
    .click();
  await expect(
    page.getByText("Each team position must use a different Steam account.", {
      exact: true,
    }),
  ).toBeVisible();
});
test("planner comfort choices and exclusions produce different personal alternatives from collected history", async ({
  page,
}) => {
  await profile(page);
  await page.getByRole("button", { name: "Team Planner", exact: true }).click();
  await expect(page.locator(".planner-slot").first()).toContainText(
    "Tester 1234",
  );
  await page.getByLabel("Position 1 comfort hero").selectOption("11");
  await page.getByLabel("Exclude a hero", { exact: true }).selectOption("6");
  await page.getByLabel("Selection style").selectOption("explore");
  await page
    .getByRole("button", { name: "Recommend team composition", exact: true })
    .click();
  await expect(page.locator(".recommended-comp")).toHaveCount(3);
  const picks = await page
    .locator(".recommended-comp .comp-picks article:first-child h3")
    .allTextContents();
  expect(new Set(picks).size).toBeGreaterThan(1);
  const all = await page
    .locator(".recommended-comp .comp-picks h3")
    .allTextContents();
  expect(all).not.toContain("Abrams");
  await page.reload();
  await page.getByRole("button", { name: "Team Planner", exact: true }).click();
  await expect(page.getByLabel("Selection style")).toHaveValue("explore");
  await expect(
    page.getByRole("button", { name: "Abrams excluded ×", exact: true }),
  ).toBeVisible();
});
