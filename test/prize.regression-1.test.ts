// Regression: ISSUE-004 — players with 0 points won points-race prizes when fewer than 20 players scored
// Found by /qa on 2026-10-02
import { expect, test } from "bun:test";
import { findOrCreate } from "../src/auth";
import { openDb } from "../src/db";
import { currentSeason, DAY_MS, initSeason } from "../src/game";
import * as P from "../src/prize";
import { dropBoardCache } from "../src/social";

const START = Date.parse("2026-10-06T00:00:00Z");
const END = START + 28 * DAY_MS;

test("a thin season gives points-race prizes only to players with points", () => {
  const db = openDb(":memory:");
  initSeason(db, START);
  dropBoardCache();
  const scored = [300, 200, 100].map((pts, i) => {
    const id = findOrCreate(db, { name: `scored${i}` }, START);
    db.query("UPDATE players SET wave_points = ? WHERE id = ?").run(pts, id);
    return id;
  });
  const idle = findOrCreate(db, { name: "idle" }, START);
  db.query("UPDATE players SET wave_points = 0, rest_at = ?").run(START); // nobody fights after the start: points stay as set
  scored.forEach((id, i) => db.query("UPDATE players SET wave_points = ? WHERE id = ?").run(300 - i * 100, id));
  P.seasonTick(db, END + 1);
  const s = currentSeason(db)!;
  expect(P.activeWinners(db, s).filter((w) => w.board === "points").map((w) => w.player_id)).toEqual(scored);
  expect(P.teamView(db, s, END + 1).reserve.points).not.toContain("idle");
  expect(P.activeWinners(db, s).some((w) => w.player_id === idle)).toBe(false);
});
