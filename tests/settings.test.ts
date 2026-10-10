import { describe, expect, it, vi } from "vitest";
// Simulate a future verified preset revision. These arbitrary values are test fixtures only.
vi.mock("../config/timing-rules.json", async (importOriginal) => {
  const { default: config } = await importOriginal<{
    default: {
      version: number;
      note: string;
      rules: import("../src/core/schema").Rule[];
    };
  }>();
  return {
    default: {
      ...config,
      revision: 1,
      rules: config.rules.map((rule) => ({
        ...rule,
        enabled: true,
        confirmed: true,
        source: "Migration test fixture only",
        firstSpawn: 120,
        respawnSeconds: rule.mode === "conditional" ? 240 : null,
        location: rule.mode === "conditional" ? "Test location" : "",
      })),
    },
  };
});
import { defaultSettings, type Rule, type Settings } from "../src/core/schema";
import { migrateSettings, restoreTimerDefaults } from "../src/core/settings";
const names: Record<string, string> = {
  "small-camp": "Small jungle camp",
  "medium-camp": "Medium jungle camp",
  "large-camp": "Large jungle camp",
  boxes: "Boxes",
  statues: "Golden statues",
  bridge: "Bridge buffs",
  urn: "Soul Urn",
  rift: "Unstable Rift / other objective",
};
function legacy(): Omit<Settings, "presetRevision" | "accountId"> {
  const {
    presetRevision: _,
    accountId: __,
    ...old
  } = structuredClone(defaultSettings);
  return {
    ...old,
    volume: 0.2,
    sound: "bell" as const,
    rules: old.rules.map((rule) => ({
      ...rule,
      name: names[rule.id],
      firstSpawn: null,
      respawnSeconds: null,
      repeatSeconds: null,
      enabled: false,
      confirmed: false,
      source: "",
      location:
        rule.category === "camp"
          ? "Choose a camp location"
          : rule.category === "breakable"
            ? "Choose a location"
            : "",
    })),
  };
}
const reminder: Rule = {
  id: "personal",
  name: "Drink water",
  category: "custom",
  mode: "once",
  firstSpawn: 600,
  repeatSeconds: null,
  respawnSeconds: null,
  enabled: true,
  confirmed: true,
  source: "",
  location: "",
};
describe("settings upgrades and timer defaults", () => {
  it("upgrades untouched empty Phase 1 rules while preserving audio and personal reminders", () => {
    const old = legacy();
    old.rules.push(reminder);
    const migrated = migrateSettings(old);
    expect(migrated).toMatchObject({
      presetRevision: 1,
      accountId: "",
      volume: 0.2,
      sound: "bell",
    });
    expect(migrated.rules.filter((rule) => rule.category !== "custom")).toEqual(
      defaultSettings.rules,
    );
    expect(migrated.rules.at(-1)).toEqual(reminder);
    expect(migrateSettings(migrated)).toEqual(migrated);
  });
  it("retains customised timings, deliberately disabled rules, renamed placeholders and deleted rules", () => {
    const old = legacy();
    old.rules[0] = {
      ...defaultSettings.rules[0],
      firstSpawn: 450,
      enabled: false,
    };
    old.rules[1].name = "My camp";
    old.rules = old.rules.filter((rule) => rule.id !== "boxes");
    const migrated = migrateSettings(old);
    expect(migrated.rules[0]).toEqual(old.rules[0]);
    expect(migrated.rules[1]).toEqual(old.rules[1]);
    expect(migrated.rules.some((rule) => rule.id === "boxes")).toBe(false);
  });
  it("explicit restoration replaces built-ins and retains player and personal preferences", () => {
    const settings = migrateSettings(legacy());
    settings.accountId = "1234";
    settings.rules = [
      { ...defaultSettings.rules[0], enabled: false },
      reminder,
    ];
    expect(restoreTimerDefaults(settings)).toMatchObject({
      accountId: "1234",
      sound: "bell",
      volume: 0.2,
      rules: [...defaultSettings.rules, reminder],
    });
  });
});

it("combines matching old breakable reminders and preserves intentionally different custom schedules", () => {
  const base = structuredClone(defaultSettings);
  base.combinedBreakables = false;
  const box = { ...base.rules.find((r) => r.id === "boxes")!, name: "Boxes" };
  const statue = { ...box, id: "statues", name: "Golden statues" };
  base.rules = [box, statue, reminder];
  const combined = migrateSettings(base);
  expect(combined.rules.filter((r) => r.category === "breakable")).toHaveLength(
    1,
  );
  expect(combined.rules[0].name).toBe("Boxes & golden statues");
  expect(combined.rules.at(-1)).toEqual(reminder);
  base.rules[1].respawnSeconds = 241;
  expect(migrateSettings(base).rules).toHaveLength(3);
});
