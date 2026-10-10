import { it, expect } from "vitest";
import { shortAnnouncement } from "../src/core/alert-cues";
import { defaultSettings, settingsSchema } from "../src/core/schema";
it("keeps announcements short and removes location repetition", () => {
  expect(
    shortAnnouncement("Small jungle camp (Your tracked small camp) event now"),
  ).toBe("Small camp ready");
  expect(
    shortAnnouncement(
      "Boxes & golden statues (General surface location) earliest respawn now",
    ),
  ).toBe("Boxes and statues can respawn");
  expect(shortAnnouncement("x".repeat(250))).toHaveLength(180);
});
it("validates voice speed, sound options and backwards-compatible defaults", () => {
  for (const sound of ["knock", "radio", "glass", "whistle"])
    expect(settingsSchema.parse({ ...defaultSettings, sound }).sound).toBe(
      sound,
    );
  expect(
    settingsSchema.safeParse({ ...defaultSettings, alertSpeed: 3 }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({ ...defaultSettings, alertSpeed: 0.1 }).success,
  ).toBe(false);
  const { alertSpeed: _, voiceId: __, ...old } = defaultSettings;
  expect(settingsSchema.parse(old)).toMatchObject({
    alertSpeed: 1.35,
    voiceId: "",
  });
});
