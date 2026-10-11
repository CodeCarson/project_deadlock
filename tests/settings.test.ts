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

it("merges an enabled verified breakable with an unconfirmed disabled twin while migrating legacy settings", () => {
  const base = structuredClone(defaultSettings);
  base.combinedBreakables = false;
  const box = {
    ...base.rules.find((r) => r.id === "boxes")!,
    name: "Boxes",
    confirmed: false,
    enabled: false,
    source: "",
  };
  const statue = {
    ...box,
    id: "statues",
    name: "Golden statues",
    confirmed: true,
    enabled: true,
    source: "Verified statue schedule",
  };
  base.rules = [box, statue, reminder];
  const migrated = migrateSettings(base);
  expect(migrated.rules[0]).toMatchObject({
    enabled: true,
    confirmed: true,
    source: "Verified statue schedule",
    name: "Boxes & golden statues",
  });
  expect(migrated.rules.at(-1)).toEqual(reminder);
  expect(migrateSettings(migrated)).toEqual(migrated);
});

it("migrates removed voices without losing the account, speed or clock settings", () => {
  const base = {
    ...defaultSettings,
    accountId: "60392473",
    voiceId: "pack:seven",
    alertSpeed: 1.75,
  };
  const migrated = migrateSettings(base);
  expect(migrated).toMatchObject({
    accountId: "60392473",
    voiceId: "pack:silas",
    alertSpeed: 1.75,
    clockSyncSeconds: base.clockSyncSeconds,
    clockGraceSeconds: base.clockGraceSeconds,
  });
  expect(migrateSettings({ ...base, voiceId: "pack:bf_emma" }).voiceId).toBe(
    "pack:june",
  );
});

it("retires old Stats preferences while retaining timer, clock and planner settings", () => {
  const current = {
    ...defaultSettings,
    accountId: "60392473",
    automaticTracking: true,
    captureRegion: { x: 200, y: 50, width: 120, height: 40 },
    planner: {
      ...defaultSettings.planner,
      preference: "comfort",
      accountIds: ["60392473", "", "", "", "", ""],
    },
  };
  const migrated = migrateSettings({
    ...current,
    autoRefreshStats: true,
    playerFilters: { hero: "1", mode: "all", days: "all" },
    playerResearch: { "60392473": { notes: [] } },
  });
  expect(migrated).toMatchObject(current);
  for (const field of ["autoRefreshStats", "playerFilters", "playerResearch"])
    expect(migrated).not.toHaveProperty(field);
});
