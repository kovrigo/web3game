// Fills a test database with a few players who played today, so the tables and the
// live feed have something to show. Test servers only: refuses without DEV_LOGIN=1 and a dev database.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { findOrCreate } from "../src/auth";
import { testAccount } from "../src/devtools";
import { openDb } from "../src/db";
import { DAY_MS, dayOf, ensureDays, initSeason, openChest, setSeed, visit } from "../src/game";

// Seeded players use the public test wallets: anyone could sign as them on a real database.
const dbPath = process.env.DB_PATH ?? "";
if (process.env.DEV_LOGIN !== "1" || !/dev/.test(dbPath)) throw new Error("Test servers only: set DEV_LOGIN=1 and a DB_PATH with 'dev'.");
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const season = initSeason(db, Date.parse(process.env.SEASON_START ?? ""));
const now = Date.now();
ensureDays(db, now);
const names = ["mara.eth", "Quillbane", "ottoTheLantern", "sable_wave", "Henrietta_LongWatch", "Pellucid", "kettle_crow", "Wren", "grimsby", "tidewalker", "Bartholomew.Maps", "nyx-07"];
let host = 0;
for (const [i, name] of names.entries()) {
  const start = now - (2 + (i % 6)) * 3_600_000;
  const id = findOrCreate(db, { name, wallet: testAccount(i).address, invite: i > 6 && host ? (db.query("SELECT invite_code FROM players WHERE id = ?").get(host) as any).invite_code : undefined }, start);
  if (i === 0) host = id;
  setSeed(db, id, randomBytes(16).toString("hex"), start);
  for (let d = 1; d <= (i % 4); d++) db.query("INSERT OR IGNORE INTO active_days (player_id, day) VALUES (?, ?)").run(id, dayOf(now - d * DAY_MS));
  visit(db, id, now, season);
  try {
    openChest(db, id, "daily", now, season);
  } catch {}
}
console.log(`Seeded ${names.length} players into ${dbPath}`);
