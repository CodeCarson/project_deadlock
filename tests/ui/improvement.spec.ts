import { test, expect, type Page } from "@playwright/test";
const now = Math.floor(Date.now() / 1000);
const history = Array.from({ length: 20 }, (_, i) => ({
  match_id: 100 + i,
  account_id: 1234,
  hero_id: 1,
  start_time: now - (20 - i) * 3600,
  game_mode: 1,
  player_match_outcome: i % 2 ? 1 : 2,
  player_kills: 8,
  player_deaths: i < 10 ? 6 : 3,
  player_assists: 4,
  net_worth: 30000,
  last_hits: 150,
  match_duration_s: 1800,
}));
async function fixtures(page: Page) {
  await page.route("https://api.deadlock-api.com/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname.endsWith("steam-search"))
      data = [
        { account_id: 5678, personaname: "Same name" },
        { account_id: 1234, personaname: "Same name" },
      ];
    else if (url.pathname.endsWith("match-history")) data = history;
    else if (url.pathname.endsWith("/metadata"))
      data = {
        match_info: {
          match_id: 119,
          start_time: history[19].start_time,
          duration_s: 1800,
          game_mode: 1,
          players: [
            {
              account_id: 1234,
              hero_id: 1,
              team: 0,
              kills: 8,
              deaths: 3,
              assists: 4,
              net_worth: 30000,
              stats: [
                { time_stamp_s: 120, net_worth: 1000, player_damage: 500 },
                { time_stamp_s: 600, net_worth: 7000, player_damage: 9000 },
                {
                  time_stamp_s: 1800,
                  net_worth: 30000,
                  player_damage: 30000,
                  boss_damage: 2000,
                  teammate_healing: 100,
                  gold_death_loss: 300,
                },
              ],
              death_details: [
                { game_time_s: 400, death_duration_s: 10 },
                { game_time_s: 1000, death_duration_s: 30 },
                { game_time_s: 1700, death_duration_s: 50 },
              ],
              items: [{ game_time_s: 60, item_id: 5, sold_time_s: 0 }],
            },
            {
              account_id: 5678,
              hero_id: 2,
              team: 0,
              kills: 7,
              deaths: 1,
              assists: 4,
              net_worth: 30000,
              stats: [{ time_stamp_s: 1800, player_damage: 70000 }],
            },
          ],
        },
      };
    else if (url.pathname.endsWith("/items"))
      data = [{ id: 5, name: "Test vitality item" }];
    else if (url.pathname.endsWith("/steam"))
      data = [{ account_id: 1234, personaname: "Selected player" }];
    else if (url.pathname.endsWith("/heroes"))
      data = [{ id: 1, name: "Abrams" }];
    else data = [];
    if (url.pathname.endsWith("/metadata")) {
      const metadata = data as any;
      metadata.match_info.game_mode = 1;
      for (let i = 0; i < 10; i++)
        metadata.match_info.players.push({
          account_id: 400 + i,
          hero_id: 1,
          team: i < 4 ? 0 : 1,
          kills: 0,
          deaths: 0,
          assists: 0,
          net_worth: 0,
          stats: [{ time_stamp_s: 1800, player_damage: 0 }],
        });
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
test("Steam-name suggestions require the chosen account and feed postgame review, goals and saved notes", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("Same name");
  const suggestions = page.getByRole("listbox", {
    name: "Suggested Steam profiles",
  });
  await expect(suggestions.getByRole("option")).toHaveCount(2);
  await page.getByLabel("Find your player profile").press("ArrowUp");
  await expect(
    suggestions.getByRole("option").filter({ hasText: "1234" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Find your player profile").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Selected player", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stats", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Improvement plan", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trend-card")).toHaveCount(4);
  await expect(page.locator(".trend-card").first()).toContainText("improving");
  await expect(
    page.getByRole("img", {
      name: "Deaths / 10 min rolling trend",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Improvement target rate").fill("0.8");
  await page
    .getByRole("button", { name: "Track next 10 games", exact: true })
    .click();
  await expect(page.getByText(/Active goal:.*at most/)).toBeVisible();
  await page
    .getByRole("button", { name: "Load detailed review", exact: true })
    .click();
  await expect(page.getByText("80%", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Recorded deaths along the match clock" }),
  ).toBeVisible();
  await expect(page.getByText("30%", { exact: true })).toBeVisible();
  await page
    .getByText("Item purchase timeline (1 recorded events)", { exact: true })
    .click();
  await expect(
    page.getByText("Test vitality item", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Match review note")
    .fill("Check the exit before chasing after 15 minutes.");
  await page
    .getByRole("button", { name: "Save review note", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Settings saved" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(page.getByLabel("Match review note")).toHaveValue(
    "Check the exit before chasing after 15 minutes.",
  );

  await expect(page.getByText(/Active goal:.*at most/)).toBeVisible();
  await page.setViewportSize({ width: 650, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
test("coverage archives reject another account and preserve imported older games on refresh", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("1234");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Selected player", exact: true }),
  ).toBeVisible();
  await page
    .getByText("History coverage & older games · 20 collected", { exact: true })
    .click();
  await page.getByLabel("Self-reported career matches").fill("500");
  await page
    .getByRole("button", { name: "Save career total", exact: true })
    .click();
  await expect(
    page.getByText("20 collected / 500 self-reported career games", {
      exact: true,
    }),
  ).toBeVisible();
  const archive = {
    format: "deadlock-companion-history",
    version: 1,
    accountId: 1234,
    matches: [{ ...history[0], match_id: 42, start_time: now - 365 * 86400 }],
  };
  await page
    .getByText("Recover known match IDs or move your archive", { exact: true })
    .evaluate((el) => {
      (el.parentElement as HTMLDetailsElement).open = true;
    });
  await page.getByLabel("Import history archive file").setInputFiles({
    name: "archive.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(
    page.getByText("History archive merged and saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("21 collected / 500 self-reported career games", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("21 collected / 500 self-reported career games", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByText("Recover known match IDs or move your archive", { exact: true })
    .evaluate((el) => {
      (el.parentElement as HTMLDetailsElement).open = true;
    });
  await page.getByLabel("Import history archive file").setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...archive, accountId: 5678, matches: [] }),
    ),
  });
  await expect(
    page.getByText("This archive belongs to another player.", { exact: true }),
  ).toBeVisible();
});
test("a late response from an earlier Steam-name query cannot replace current suggestions", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = false;
  await page.route(
    "https://api.deadlock-api.com/v1/players/steam-search*",
    async (route) => {
      const query = new URL(route.request().url()).searchParams.get(
        "search_query",
      );
      if (query === "Earlier") {
        first = true;
        await gate;
      }
      await route.fulfill({
        json: [
          {
            account_id: query === "Earlier" ? 1 : 2,
            personaname:
              query === "Earlier" ? "Earlier result" : "Current result",
          },
        ],
      });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.getByLabel("Find your player profile").fill("Earlier");
  await expect.poll(() => first).toBe(true);
  await page.getByLabel("Find your player profile").fill("Current");
  await expect(
    page.getByRole("option").filter({ hasText: "Current result" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("option").filter({ hasText: "Earlier result" }),
  ).toHaveCount(0);
});
