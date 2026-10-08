import { defaultSettings, settingsSchema, type Settings } from "./schema.js";
const legacyNames: Record<string, string> = {
  "small-camp": "Small jungle camp",
  "medium-camp": "Medium jungle camp",
  "large-camp": "Large jungle camp",
  boxes: "Boxes",
  statues: "Golden statues",
  bridge: "Bridge buffs",
  urn: "Soul Urn",
  rift: "Unstable Rift / other objective",
};
/** Upgrade only untouched Phase 1 placeholders. Custom rules and existing choices are preserved. */
export function migrateSettings(raw: unknown): Settings {
  const settings = settingsSchema.parse(raw);
  if (settings.presetRevision >= defaultSettings.presetRevision)
    return settings;
  return settingsSchema.parse({
    ...settings,
    presetRevision: defaultSettings.presetRevision,
    rules: settings.rules.map((rule) => {
      const isPlaceholder =
        legacyNames[rule.id] === rule.name &&
        rule.firstSpawn === null &&
        rule.repeatSeconds === null &&
        rule.respawnSeconds === null &&
        !rule.enabled &&
        !rule.confirmed &&
        !rule.source &&
        ["", "Choose a camp location", "Choose a location"].includes(
          rule.location,
        );
      const replacement = defaultSettings.rules.find(
        (next) => next.id === rule.id,
      );
      return isPlaceholder && replacement?.confirmed && replacement.enabled
        ? structuredClone(replacement)
        : rule;
    }),
  });
}
export function restoreTimerDefaults(settings: Settings): Settings {
  const builtins = new Set(defaultSettings.rules.map((rule) => rule.id));
  return settingsSchema.parse({
    ...settings,
    presetRevision: defaultSettings.presetRevision,
    rules: [
      ...structuredClone(defaultSettings.rules),
      ...settings.rules.filter((rule) => !builtins.has(rule.id)),
    ],
  });
}
