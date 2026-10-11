import type { Hero } from "./api.js";
export type TeamRole = "frontline" | "control" | "damage" | "sustain";
const roles: Record<string, TeamRole[]> = {
  Abrams: ["frontline", "control"],
  Dynamo: ["control", "sustain"],
  Kelvin: ["control", "sustain"],
  "Mo & Krill": ["frontline", "control"],
  Bebop: ["control", "damage"],
  Ivy: ["sustain", "control"],
  Viscous: ["sustain", "control"],
  McGinnis: ["damage", "sustain"],
  Warden: ["frontline", "control"],
  Lash: ["control", "damage"],
  Seven: ["damage", "control"],
  Paradox: ["control", "damage"],
  Shiv: ["frontline", "damage"],
  Pocket: ["damage"],
  Haze: ["damage"],
};
export function heroRoles(hero?: Hero): TeamRole[] {
  if (!hero) return [];
  return (
    roles[hero.name] ??
    (hero.hero_type === "brawler"
      ? ["frontline"]
      : ["marksman", "assassin"].includes(hero.hero_type ?? "")
        ? ["damage"]
        : [])
  );
}
const deathAdvice: Record<string, string> = {
  Abrams: "Charge only when a teammate can follow; keep a route back to cover.",
  Dynamo: "Before committing your ultimate, check that an ally can follow up.",
  Kelvin:
    "Keep an escape route before committing to a chase; use cover to rejoin your team.",
  Haze: "Wait for enemy control abilities before entering with your ultimate.",
  "Mo & Krill":
    "Pick a target your team can reach before committing to close-range control.",
  Pocket:
    "Plan your escape before entering the backline; save an escape ability until you need it.",
  Vindicta:
    "Keep a second firing position in mind before exposing yourself to a dive.",
  "Grey Talon":
    "Use cover between shots; reposition before enemies close the gap.",
  Bebop:
    "Hook toward a teammate who can follow up; avoid starting isolated trades.",
  Ivy: "Stay within reach of an ally before taking a contested route.",
  Infernus:
    "Build up damage from cover before chasing; save an exit for the return fire.",
  Wraith:
    "Use control to isolate a reachable target and keep your escape available.",
  Lash: "Choose your landing and exit before diving; check your team's position first.",
};
