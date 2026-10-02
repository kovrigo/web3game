// Fills a test database with a few players who played today, so the tables and the
// live feed have something to show. Test servers only: refuses without DEV_LOGIN=1.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { findOrCreate } from "../src/auth";
import { openDb } from "../src/db";
import { DAY_MS, dayOf, ensureDays, openChest, seasonFromEnv, setSeed, visit } from "../src/game";

if (process.env.DEV_LOGIN !== "1" || !process.env.DB_PATH) throw new Error("Test servers only: set DEV_LOGIN=1 and DB_PATH.");
mkdirSync(dirname(process.env.DB_PATH), { recursive: true });
const db = openDb(process.env.DB_PATH);
const season = seasonFromEnv(process.env);
const now = Date.now();
ensureDays(db, now);
const names = ["mara.eth", "Quillbane", "ottoTheLantern", "sable_wave", "Henrietta_LongWatch", "Pellucid", "kettle_crow", "Wren", "grimsby", "tidewalker", "Bartholomew.Maps", "nyx-07"];
let host = 0;
for (const [i, name] of names.entries()) {
  const start = now - (2 + (i % 6)) * 3_600_000;
  const id = findOrCreate(db, { name, invite: i > 6 && host ? (db.query("SELECT invite_code FROM players WHERE id = ?").get(host) as any).invite_code : undefined }, start);
  if (i === 0) host = id;
  setSeed(db, id, randomBytes(16).toString("hex"), start);
  for (let d = 1; d <= (i % 4); d++) db.query("INSERT OR IGNORE INTO active_days (player_id, day) VALUES (?, ?)").run(id, dayOf(now - d * DAY_MS));
  visit(db, id, now, season);
  try {
    openChest(db, id, "daily", now, season);
  } catch {}
}
console.log(`Seeded ${names.length} players into ${process.env.DB_PATH}`);
