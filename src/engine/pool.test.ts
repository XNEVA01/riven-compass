import { describe, expect, it } from "vitest";
import { GAME, weaponById } from "./data";
import { poolFor } from "./pool";
import { Solver } from "./solver";

const SPEED = "WeaponProjectileSpeedMod";
const byName = (en: string) => {
  const w = GAME.weapons.find((x) => x.name.en === en);
  if (!w) throw new Error(`missing ${en}`);
  return w;
};

describe("which stats roll on a weapon", () => {
  it("follows the game data for projectile speed; one kept on an old riven stays but is not drawn again", () => {
    // warframe.market lists Arca Plasmor rivens with projectile speed, but Patch 40.0.0 (2025-10-15) stopped
    // incompatible stats from rolling and old rivens kept theirs: the weapon has no PROJECTILE tag
    for (const name of ["Arca Plasmor", "Tenet Arca Plasmor"]) {
      expect(poolFor(byName(name)).pos, name).not.toContain(SPEED);
      const kept = poolFor(byName(name), { pos: [SPEED], neg: [SPEED] });
      expect([kept.pos.includes(SPEED), kept.neg.includes(SPEED)], name).toEqual([true, true]);
      expect([kept.keptPos, kept.keptNeg], name).toEqual([[SPEED], [SPEED]]);
    }
  });

  it("rolls impact, puncture and slash on every Zaw, a third of the damage each", () => {
    const zaws = GAME.weapons.filter((w) => w.cls === "Zaw");
    expect(zaws.length).toBeGreaterThan(0);
    for (const w of zaws) {
      const pool = poolFor(w);
      for (const tag of ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"]) {
        expect(pool.pos, w.name.en).toContain(tag);
        expect(pool.neg, w.name.en).toContain(tag);
      }
    }
  });

  it("still does not roll on hitscan weapons", () => {
    for (const name of ["Soma", "Hek", "Lex"]) expect(poolFor(byName(name)).pos, name).not.toContain(SPEED);
  });
});

describe("stats kept from an old roll", () => {
  // the Grimoire stopped rolling magazine capacity in Hotfix 38.0.10; rivens that had it keep it
  const grimoire = GAME.weapons.find((w) => w.id === "/Lotus/Weapons/Tenno/Grimoire/TnGrimoire");
  if (!grimoire) throw new Error("missing Grimoire");
  const CLIP = "WeaponClipMaxMod";
  const card = { layout: { pos: 2, neg: 0 } as const, pos: [CLIP, "WeaponDamageAmountMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };

  it("stay on the card but are not drawn again", () => {
    expect(poolFor(grimoire).pos).not.toContain(CLIP);
    const pool = poolFor(grimoire, { pos: [CLIP] });
    expect(pool.pos).toContain(CLIP);
    expect(pool.keptPos).toEqual([CLIP]);
    // a better magazine roll than the one on the card can never come back
    const high = new Solver(pool, { groups: [{ tags: [CLIP], minW: 1.07 }], layouts: [{ pos: 2, neg: 0 }], allowedNeg: [] }, "cycles");
    const id = high.solve(card).id;
    expect(high.value[id]).toBe(Number.POSITIVE_INFINITY);
    // the one on the card still counts, and can be locked while the other trait is cycled
    const keep = new Solver(
      pool,
      {
        groups: [
          { tags: [CLIP], minW: 0.9 },
          { tags: ["WeaponFireIterationsMod"], minW: 0.9 },
        ],
        layouts: [{ pos: 2, neg: 0 }],
        allowedNeg: [],
      },
      "cycles",
    );
    keep.solve(card);
    const best = keep.routes(card).find((r) => r.optimal);
    expect(best?.action.kind === "cycle" && typeof best.action.lock === "object" && best.action.lock.tag).toBe(CLIP);
  });
});

describe("a spliced trait already on the riven", () => {
  it("keeps counting for the target after it used up an ingredient that cannot come back", () => {
    // Burst Laser (a companion weapon) no longer rolls ammo maximum; an old one spliced with reload speed made
    // "magazine reloaded when holstered", and the target is that stat
    const burst = byName("Burst Laser");
    const HOLSTER = "WeaponMagazineReloadHolstered";
    expect(poolFor(burst).pos).not.toContain("WeaponAmmoMaxMod");
    const pool = poolFor(burst, { pos: [HOLSTER, "WeaponCritDamageMod", "WeaponDamageAmountMod"] });
    expect(pool.spliced).toContain(HOLSTER);
    // no recipe for it is left, so nothing can splice it again
    expect(pool.splices.some((r) => r.result === HOLSTER)).toBe(false);
    const s = new Solver(pool, { groups: [{ tags: [HOLSTER], minW: 0.9 }], layouts: [{ pos: 3, neg: 0 }], allowedNeg: [] }, "cycles");
    const card = {
      layout: { pos: 3, neg: 0 } as const,
      pos: ["WeaponCritDamageMod", "WeaponDamageAmountMod"].map((tag) => ({ tag, w: 1 })),
      neg: null,
      spliced: { tag: HOLSTER, w: 1.001 },
    };
    expect(s.isGoal(s.solve(card))).toBe(true);
  });
});

describe("impact, puncture and slash", () => {
  const [IMPACT, PUNCTURE, SLASH] = ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"];
  const both = (name: string, tag: string) => {
    const pool = poolFor(byName(name));
    return pool.pos.includes(tag) && pool.neg.includes(tag);
  };

  it("count each type's share of the physical damage, not of all damage", () => {
    // elements make up most of their damage, yet warframe.market lists many of these rivens with the stat
    for (const [name, tag] of [
      ["Penta", IMPACT],
      ["Zarr", IMPACT],
      ["Kuva Bramma", IMPACT],
      ["Tonkor", PUNCTURE],
      ["Ocucor", PUNCTURE],
    ] as const)
      expect(both(name, tag), `${name} ${tag}`).toBe(true);
    // a type at 25% or less of the physical damage still cannot roll
    expect(both("Hek", IMPACT)).toBe(false);
    expect(both("Strun", PUNCTURE)).toBe(false);
  });

  it("roll on every kitgun, a third each like a Zaw", () => {
    for (const w of GAME.weapons.filter((x) => x.cls === "Kitgun")) for (const tag of [IMPACT, PUNCTURE, SLASH]) expect(both(w.name.en, tag), `${w.name.en} ${tag}`).toBe(true);
  });

  it("follow the weapon a variant derives from, since the riven belongs to the family", () => {
    // Strun Wraith has 20% slash of its own, Strun 30%: its riven is a Strun riven
    expect(both("Strun Wraith", SLASH)).toBe(both("Strun", SLASH));
    expect(both("Strun Wraith", SLASH)).toBe(true);
    // Kuva Ogris has physical damage of its own, but Ogris has none (and no Ogris riven is listed with slash)
    expect(both("Kuva Ogris", SLASH)).toBe(false);
    // Karak sits at exactly 25% slash, yet its rivens are listed with slash: an exception for the family
    for (const name of ["Karak", "Karak Wraith", "Kuva Karak"]) expect(both(name, SLASH), name).toBe(true);
    expect(both("Tiberon Prime", SLASH)).toBe(false);
  });

  it("use the player's weapon when one is exported twice under one name", () => {
    expect(GAME.weapons.filter((w) => w.name.en === "Azothane")).toHaveLength(1);
    const shell = "/Lotus/Weapons/Tenno/Melee/Swords/DaxDuviriTwoHandedKatana/DaxDuviriTwoHandedKatanaPlayerWeapon";
    expect(weaponById(shell)?.id).toBe("/Lotus/Weapons/Tenno/Melee/Swords/DaxDuviriTwoHandedKatana/DaxDuviriTwoHandedKatanaWeapon");
    expect(poolFor(byName("Azothane")).pos).toContain(SLASH);
  });
});
