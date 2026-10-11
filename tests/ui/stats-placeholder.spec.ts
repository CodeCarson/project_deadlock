import { test, expect } from "@playwright/test";

test("Stats only shows Coming soon and performs no player requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://**/*", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coming soon", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stats-coming-soon")).toHaveText("Coming soon");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Match archive updates", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Live Match", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
});
