import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { dailyTable, FIND_TABLE, GUARANTEED_TABLE, TOTAL } from "../src/config";
import { hmacWeb, pick, rollMessage, sha256Web, verifyDay, type CheckRoll } from "../src/fair";
import { ITEMS } from "../src/items";

const secret = "11".repeat(32);
const hmacNode = (msg: string) => new Uint8Array(createHmac("sha256", Buffer.from(secret, "hex")).update(msg).digest());

test("every odds table sums to 100%", () => {
  for (const t of [FIND_TABLE, GUARANTEED_TABLE, ...[1, 2, 3, 4, 5, 6, 7].map(dailyTable)]) {
    expect(t.reduce((s, [, w]) => s + w, 0)).toBe(TOTAL);
    expect(t.every(([, w]) => w >= 0)).toBe(true);
  }
});

test("streak raises rare-or-better and lowers common", () => {
  const rareUp = (s: number) => dailyTable(s).filter(([r]) => r === "rare" || r === "epic" || r === "legendary").reduce((a, [, w]) => a + w, 0);
  expect(rareUp(7)).toBeGreaterThan(rareUp(1));
  expect(dailyTable(9)).toEqual(dailyTable(7));
});

test("server and browser hashes give the same roll", async () => {
  for (let n = 1; n <= 50; n++) {
    const msg = rollMessage("abcdef12", "daily", n);
    expect(await hmacWeb(secret, msg)).toEqual(hmacNode(msg));
  }
});

test("pick is deterministic and the item matches the rarity", () => {
  const h = hmacNode(rollMessage("abcdef12", "daily", 1));
  const a = pick(h, "daily", 3);
  expect(pick(h, "daily", 3)).toEqual(a);
  expect(ITEMS[a.itemId!]!.rarity).toBe(a.rarity!);
});

test("guaranteed rolls are never below rare", () => {
  for (let n = 1; n <= 300; n++) {
    const r = pick(hmacNode(rollMessage("abcdef12", "guaranteed", n)), "guaranteed", 0);
    expect(["rare", "epic", "legendary"]).toContain(r.rarity!);
  }
});

test("find odds land near the table over many rolls", () => {
  let none = 0;
  const N = 20_000;
  for (let n = 1; n <= N; n++) if (pick(hmacNode(rollMessage("feed", "find", n * 10)), "find", 0).rarity === null) none++;
  expect(none / N).toBeGreaterThan(0.78);
  expect(none / N).toBeLessThan(0.82);
});

async function rollsFor(seed: string) {
  const commit = await sha256Web(secret);
  const out: CheckRoll[] = [];
  for (const [kind, n] of [["daily", 4], ["find", 10], ["find", 20], ["find", 30]] as const) {
    const { rarity, itemId } = pick(hmacNode(rollMessage(seed, kind, n)), kind, 2);
    out.push({ id: out.length + 1, kind, n, seed, commit, streak: 2, rarity, itemId });
  }
  return out;
}

test("honest day verifies", async () => {
  const rolls = await rollsFor("abcdef12");
  const v = await verifyDay(secret, rolls, { commit: rolls[0]!.commit, seeds: ["abcdef12"] });
  expect(v).toEqual({ ok: true, checked: 4, mismatches: [] });
});

test("a changed result is caught", async () => {
  const rolls = await rollsFor("abcdef12");
  rolls[0]!.rarity = rolls[0]!.rarity === "legendary" ? "common" : "legendary";
  expect((await verifyDay(secret, rolls)).mismatches).toEqual([1]);
});

test("a hidden roll shows as a gap, a foreign seed and a wrong commit are caught", async () => {
  const rolls = await rollsFor("abcdef12");
  expect((await verifyDay(secret, rolls.filter((r) => r.id !== 3))).mismatches).toEqual([4]);
  expect((await verifyDay(secret, rolls, { seeds: ["99999999"] })).mismatches).toEqual([1, 2, 3, 4]);
  expect((await verifyDay(secret, rolls, { commit: "00" })).ok).toBe(false);
});
