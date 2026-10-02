// Regression: ISSUE-003 — a score correction named a player who hid their name
// Found by /qa on 2026-10-02
import { expect, test } from "bun:test";
import { findOrCreate } from "../src/auth";
import { openDb } from "../src/db";
import { ensureDays, initSeason } from "../src/game";
import { addCorrection } from "../src/admin";

const START = Date.parse("2026-10-06T00:00:00Z");

test("score correction keeps a hidden name hidden, names everyone else", () => {
  const db = openDb(":memory:");
  const season = initSeason(db, START);
  ensureDays(db, START);
  const shy = findOrCreate(db, { name: "shyone" }, START);
  const open = findOrCreate(db, { name: "openone" }, START);
  db.query("UPDATE players SET hidden = 1 WHERE id = ?").run(shy);
  addCorrection(db, "t", season, shy, -200, "Used a wave counter bug.", START);
  addCorrection(db, "t", season, open, 50, "Lost waves in an outage.", START);
  const texts = db.query<{ text: string }, []>("SELECT text FROM announcements ORDER BY id").all().map((r) => r.text);
  expect(texts[0]).toBe("Score correction: Hidden player -200 pts. Used a wave counter bug.");
  expect(texts[1]).toBe("Score correction: openone +50 pts. Lost waves in an outage.");
});
