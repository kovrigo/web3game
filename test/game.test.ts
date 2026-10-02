import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { findOrCreate } from "../src/auth";
import { openDb } from "../src/db";
import { DAY_MS, dayOf, ensureDays, getPlayer, nextStreak, openChest, phaseOf, settle, tick, visit, type Season } from "../src/game";
import { boards, buildState, dropBoardCache, friendsOf, nameError } from "../src/social";
import { addCorrection, resolveAppeal, setReview, submitAppeal } from "../src/admin";

const START = Date.parse("2026-10-06T00:00:00Z");
const season: Season = { start: START, end: START + 28 * DAY_MS };
const H = 3_600_000;
let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  dropBoardCache();
});

const join = (name: string, at: number, invite?: string) => {
  ensureDays(db, at);
  return findOrCreate(db, { name, invite }, at);
};
const seedOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const go = (id: number, at: number) => {
  ensureDays(db, at);
  visit(db, id, at, season, seedOf(`${id}:${dayOf(at)}`));
};

test("phases", () => {
  expect(phaseOf(season, START - 1)).toBe("upcoming");
  expect(phaseOf(season, START)).toBe("live");
  expect(phaseOf(season, season.end - DAY_MS)).toBe("final_day");
  expect(phaseOf(season, season.end)).toBe("ended");
});

test("waves: none before a minute, 180 in 3 hours, hero rests after 8 hours", () => {
  const id = join("wren", START);
  go(id, START);
  expect(settle(db, id, START + 59_000, season).waves).toBe(0);
  go(id, START + 3 * H);
  expect(getPlayer(db, id)!.wave).toBe(180);
  go(id, START + 3 * H + 2 * DAY_MS);
  expect(getPlayer(db, id)!.wave).toBe(180 + 480);
  // After the rest the hero wakes at the visit, not at the old tick.
  go(id, START + 3 * H + 2 * DAY_MS + 10 * 60_000);
  expect(getPlayer(db, id)!.wave).toBe(180 + 480 + 10);
});

test("waves never count before the start or after the end", () => {
  const id = join("early", START - 5 * H);
  go(id, START - 5 * H);
  go(id, START + H);
  expect(getPlayer(db, id)!.wave).toBe(60); // counted from the start, not from the visit
  go(id, season.end - 30 * 60_000);
  expect(getPlayer(db, id)!.wave).toBe(60 + 480);
  go(id, season.end + 5 * H);
  expect(getPlayer(db, id)!.wave).toBe(60 + 480 + 30);
});

test("a find rolls on every 10th wave and points follow gear", () => {
  const id = join("finder", START);
  go(id, START);
  go(id, START + 100 * 60_000);
  const finds = db.query("SELECT n FROM rolls WHERE player_id = ? AND kind = 'find' ORDER BY n").all(id) as { n: number }[];
  expect(finds.map((f) => f.n)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  expect(getPlayer(db, id)!.wave_points).toBe(100 * 10);
});

test("two visits at the same moment credit waves once", () => {
  const id = join("twin", START);
  go(id, START);
  go(id, START + H);
  go(id, START + H);
  expect(getPlayer(db, id)!.wave).toBe(60);
});

test("streak: in a row, one missed day steps back one, cap 7", () => {
  expect(nextStreak(0, null, "2026-10-06")).toBe(1);
  expect(nextStreak(3, "2026-10-06", "2026-10-07")).toBe(4);
  expect(nextStreak(4, "2026-10-06", "2026-10-08")).toBe(4);
  expect(nextStreak(4, "2026-10-06", "2026-10-10")).toBe(2);
  expect(nextStreak(7, "2026-10-06", "2026-10-07")).toBe(7);
});

test("daily chest opens once a day", () => {
  const id = join("opener", START);
  go(id, START + H);
  openChest(db, id, "daily", START + H, season);
  expect(() => openChest(db, id, "daily", START + 2 * H, season)).toThrow("Today's chest is already open.");
  go(id, START + DAY_MS + H);
  expect(openChest(db, id, "daily", START + DAY_MS + H, season).n).toBe(2);
});

test("chest refused outside the season", () => {
  const id = join("late", START - H);
  go(id, START - H);
  expect(() => openChest(db, id, "daily", START - H, season)).toThrow("The season is not running.");
});

test("guarantee: three dry active days give a guaranteed chest", () => {
  const id = join("unlucky", START);
  for (let d = 0; d < 3; d++) {
    go(id, START + d * DAY_MS + H);
    db.query("UPDATE players SET rest_at = last_tick WHERE id = ?").run(id); // no waves, so no lucky finds in between
  }
  const chests = db.query("SELECT kind FROM waiting_chests WHERE player_id = ?").all(id);
  expect(chests).toEqual([{ kind: "guaranteed" }]);
  const r = openChest(db, id, "guaranteed", START + 2 * DAY_MS + 2 * H, season);
  expect(["rare", "epic", "legendary"]).toContain(r.rarity!);
  expect(getPlayer(db, id)!.dry_days).toBe(0);
  expect(() => openChest(db, id, "guaranteed", START + 2 * DAY_MS + 3 * H, season)).toThrow("No chests waiting.");
});

test("tick settles everyone before revealing a day", () => {
  const id = join("sleeper", START);
  go(id, START + 20 * H);
  tick(db, START + DAY_MS + 30_000, season);
  const p = getPlayer(db, id)!;
  expect(p.wave).toBe(480 + 4 * 60); // 8 hours before the rest, then 20:00 to 24:00
  const day = db.query("SELECT revealed_at FROM fair_days WHERE day = ?").get(dayOf(START)) as { revealed_at: number };
  expect(day.revealed_at).toBeGreaterThan(0);
});

test("invites count at 3 active days, share is 10% and capped", () => {
  const host = join("host", START);
  const friend = join("friend", START, getPlayer(db, host)!.invite_code);
  expect(getPlayer(db, friend)!.referrer_id).toBe(host);
  go(friend, START + H);
  go(friend, START + DAY_MS + H);
  expect(friendsOf(db, season, host).counted).toBe(0);
  go(friend, START + 2 * DAY_MS + H);
  db.query("UPDATE players SET wave_points = 1000 WHERE id = ?").run(friend);
  expect(friendsOf(db, season, host)).toMatchObject({ counted: 1, refPoints: 100 });
  db.query("UPDATE players SET wave_points = 10000000 WHERE id = ?").run(friend);
  expect(friendsOf(db, season, host).refPoints).toBe(50_000);
  setReview(db, "t", friend, "review", "shared device", START);
  expect(friendsOf(db, season, host).counted).toBe(0);
});

test("own invite code does not make you your own referrer", () => {
  const a = join("solo", START);
  const again = findOrCreate(db, { name: "solo", invite: getPlayer(db, a)!.invite_code }, START);
  expect(again).toBe(a);
  expect(getPlayer(db, a)!.referrer_id).toBeNull();
});

test("review hides a player from tables, an accepted appeal brings every point back", () => {
  const a = join("alpha", START), b = join("beta", START);
  db.query("UPDATE players SET wave_points = 500 WHERE id = ?").run(a);
  setReview(db, "t", a, "review", "Shared connection with other accounts", START);
  expect(boards(db, season, START, true).points.map((r) => r.id)).toEqual([b]);
  submitAppeal(db, a, "a@example.com", "I play alone from home.", START);
  const id = (db.query("SELECT id FROM appeals").get() as { id: number }).id;
  resolveAppeal(db, "t", id, "accepted", "Checked, sorry.", START);
  const rows = boards(db, season, START, true).points;
  expect(rows[0]).toMatchObject({ id: a, points: 500 });
});

test("corrections change points and are announced", () => {
  const a = join("fixme", START);
  addCorrection(db, "t", a, -200, "Used a wave counter bug.", START);
  expect(boards(db, season, START, true).points[0]!.points).toBe(-200);
  expect((db.query("SELECT text FROM announcements").get() as { text: string }).text).toContain("-200 pts");
});

test("founder badge needs 3 active days in the season", () => {
  const id = join("founder", START);
  for (let d = 0; d < 3; d++) go(id, START + d * DAY_MS + H);
  expect(buildState(db, id, START + 2 * DAY_MS + H, season).player.founder).toBe(true);
  const late = join("late", season.end - DAY_MS);
  go(late, season.end - H);
  go(late, season.end + H);
  go(late, season.end + DAY_MS + H);
  expect(buildState(db, late, season.end + DAY_MS + H, season).player.founder).toBe(false);
});

test("names", () => {
  expect(nameError("ab")).not.toBeNull();
  expect(nameError("a".repeat(21))).not.toBeNull();
  expect(nameError("has space")).not.toBeNull();
  expect(nameError("SlutQueen")).not.toBeNull();
  expect(nameError("mara.eth")).toBeNull();
});
