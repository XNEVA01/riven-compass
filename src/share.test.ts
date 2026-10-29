import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { expect, it } from "vitest";
import { decodeSession, encodeSession } from "./share";
import { demoSession, type Session } from "./state";

const roundtrip = (s: Session): Session => {
  const decoded = decodeSession(encodeSession(s));
  if (!decoded) throw new Error("decode failed");
  return decoded;
};

it("shares a session as a link and reads it back unchanged where it matters", () => {
  const demo = demoSession("tc");
  const back = roundtrip(demo);
  expect(back.weaponId).toBe(demo.weaponId);
  expect(back.card).toEqual(demo.card);
  expect(back.target).toEqual(demo.target);
  expect(back.kuva).toBe(25167812);
  expect(back.disposition).toBeCloseTo(1.2, 5);
  // the recipient keeps their own interface language
  expect(back.lang).toBe("zh");
});

it("keeps the chosen objective across a share", () => {
  const demo = demoSession("zh");
  const back = roundtrip({ ...demo, target: { ...demo.target, objective: "kuva" } });
  expect(back.target.objective).toBe("kuva");
});

it("leaves progress logs out of the link", () => {
  const demo = demoSession("zh");
  const back = roundtrip({
    ...demo,
    step: { cycles: 3, kuva: 900, route: "keep" },
    total: { cycles: 12, kuva: 4000 },
    log: [{ at: 1, text: "记录" }],
    counted: ["a", "b"],
  });
  expect(back.step).toEqual({ cycles: 0, kuva: 0 });
  expect(back.total).toEqual({ cycles: 0, kuva: 0 });
  expect(back.log).toEqual([]);
  expect(back.counted).toEqual([]);
});

it("encodes to url-safe characters only (no &, =, # or spaces)", () => {
  expect(encodeSession(demoSession("en"))).toMatch(/^[A-Za-z0-9+-]+$/);
});

it("refuses links it cannot read", () => {
  expect(decodeSession("")).toBeNull();
  expect(decodeSession("not-lz-string-garbage!")).toBeNull();
});

it("refuses a share whose weapon is unknown here", () => {
  const json = JSON.stringify({ v: 1, version: 2, weaponId: "/No/Such/Weapon", card: { pos: [], neg: null, cycles: 0 }, target: {} });
  expect(decodeSession(compressToEncodedURIComponent(json))).toBeNull();
});

it("refuses a payload from a share format it does not know", () => {
  const json = JSON.stringify({
    v: 99,
    version: 2,
    weaponId: "/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon",
    card: { pos: [], neg: null, cycles: 0 },
    target: {},
  });
  expect(decodeSession(compressToEncodedURIComponent(json))).toBeNull();
});

it("refuses a share without a weapon (nothing to share yet)", () => {
  expect(decodeSession(encodeSession({ ...demoSession("zh"), weaponId: null }))).toBeNull();
});

it("still reads the v1 links it once wrote (full weapon path)", () => {
  const demo = demoSession("zh");
  const json = JSON.stringify({ v: 1, version: 2, weaponId: demo.weaponId, card: demo.card, target: demo.target, kuva: demo.kuva, disposition: demo.disposition });
  const back = decodeSession(compressToEncodedURIComponent(json));
  expect(back?.weaponId).toBe(demo.weaponId);
});

it("writes the weapon as its leaf name and shrinks the link", () => {
  const demo = demoSession("zh");
  const old = compressToEncodedURIComponent(
    JSON.stringify({ v: 1, version: 2, weaponId: demo.weaponId, card: demo.card, target: demo.target, kuva: demo.kuva, disposition: demo.disposition }),
  );
  const now = encodeSession(demo);
  expect(now.length).toBeLessThan(old.length - 20);
  const json = JSON.parse(decompressFromEncodedURIComponent(now) ?? "{}") as { w?: string };
  expect(json.w).toBe("PrimeEpitaphSidearmWeapon");
});

it("reads a v2 link carrying only the leaf name", () => {
  const demo = demoSession("zh");
  const json = JSON.stringify({ v: 2, version: 2, w: "PrimeEpitaphSidearmWeapon", card: demo.card, target: demo.target, kuva: demo.kuva, disposition: demo.disposition });
  const back = decodeSession(compressToEncodedURIComponent(json));
  expect(back?.weaponId).toBe(demo.weaponId);
});

it("refuses a v2 link whose leaf it does not know", () => {
  const json = JSON.stringify({ v: 2, version: 2, w: "NoSuchWeapon", card: { pos: [], neg: null, cycles: 0 }, target: {} });
  expect(decodeSession(compressToEncodedURIComponent(json))).toBeNull();
});
