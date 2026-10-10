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
export function heroAction(hero: Hero | undefined, metric: string) {
  if (metric === "deaths")
    return (
      deathAdvice[hero?.name ?? ""] ??
      {
        brawler:
          "Commit only when an ally can follow; leave yourself a route back to cover.",
        assassin: "Choose an entry and an exit before going for the backline.",
        marksman:
          "Fight from cover with an escape route; move when enemies close the gap.",
        mystic:
          "Keep your escape or defensive cooldown available before committing.",
      }[hero?.hero_type ?? ""] ??
      "Count visible threats and choose an escape route before committing."
    );
  const actions: Record<string, string> = {
    combat: heroRoles(hero).includes("control")
      ? "Arrive before the next objective fight with your control ability ready and a teammate in range."
      : "Clear a nearby wave, then arrive with a teammate before the next objective fight.",
    farm: "Clear the next reachable wave before rotating; take a nearby camp along that route.",
    economy:
      "Spend before the next contested objective; protect unspent souls instead of forcing a fight while behind.",
    damage:
      hero?.hero_type === "marksman"
        ? "Take a covered firing angle and stay in range long enough to deal sustained damage."
        : "Enter the next fight with your damage cooldowns ready and a target your team can reach.",
    objectives:
      "After the next won fight, move with your team to a safe Guardian or Walker.",
    healing:
      "Keep a teammate in ability range before the next fight; save your defensive cooldown for them.",
  };
  return (
    actions[metric] ??
    "Review one death and write down the decision you would change."
  );
}
