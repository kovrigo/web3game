import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE COLLATE NOCASE,
  wallet TEXT UNIQUE,
  email TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  referrer_id INTEGER REFERENCES players(id),
  invite_code TEXT NOT NULL UNIQUE,
  review TEXT NOT NULL DEFAULT 'ok',          -- ok | review
  review_reason TEXT,
  accepted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_tick INTEGER NOT NULL,                 -- ms; waves are settled up to here
  rest_at INTEGER NOT NULL,                   -- ms; hero rests after this until the next visit
  last_visit INTEGER NOT NULL,
  wave INTEGER NOT NULL DEFAULT 0,
  wave_points INTEGER NOT NULL DEFAULT 0,
  dry_days INTEGER NOT NULL DEFAULT 0,        -- active days with no rare-or-better roll
  streak INTEGER NOT NULL DEFAULT 0,
  last_daily_day TEXT,
  daily_n INTEGER NOT NULL DEFAULT 0,
  guar_n INTEGER NOT NULL DEFAULT 0,
  away_since INTEGER NOT NULL,
  away_waves INTEGER NOT NULL DEFAULT 0,
  away_points INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (token TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), expires_at INTEGER NOT NULL);
CREATE TABLE siwe_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE active_days (player_id INTEGER NOT NULL REFERENCES players(id), day TEXT NOT NULL, PRIMARY KEY (player_id, day));
CREATE TABLE fair_days (day TEXT PRIMARY KEY, secret TEXT NOT NULL, commit_hash TEXT NOT NULL, created_at INTEGER NOT NULL, revealed_at INTEGER);
CREATE TABLE player_seeds (player_id INTEGER NOT NULL REFERENCES players(id), seed TEXT NOT NULL, set_at INTEGER NOT NULL);
CREATE INDEX player_seeds_at ON player_seeds (player_id, set_at);
CREATE TABLE rolls (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL,                         -- daily | guaranteed | find
  n INTEGER NOT NULL,
  day TEXT NOT NULL,
  seed TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  streak INTEGER NOT NULL,
  rarity TEXT,
  item_id INTEGER,
  at INTEGER NOT NULL,
  UNIQUE (player_id, kind, n)
);
CREATE INDEX rolls_day ON rolls (player_id, day);
CREATE INDEX rolls_feed ON rolls (rarity, id);
CREATE TABLE gear (player_id INTEGER NOT NULL REFERENCES players(id), slot TEXT NOT NULL, item_id INTEGER NOT NULL, roll_id INTEGER NOT NULL, PRIMARY KEY (player_id, slot));
CREATE TABLE waiting_chests (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), kind TEXT NOT NULL, at INTEGER NOT NULL, roll_id INTEGER);
CREATE TABLE signals (player_id INTEGER NOT NULL REFERENCES players(id), ip_hash TEXT NOT NULL, device TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE (player_id, ip_hash, device));
CREATE TABLE appeals (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), email TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', answer TEXT, at INTEGER NOT NULL, resolved_at INTEGER);
CREATE TABLE corrections (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE announcements (id INTEGER PRIMARY KEY, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE shares (player_id INTEGER NOT NULL REFERENCES players(id), roll_id INTEGER NOT NULL, channel TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE admin_log (id INTEGER PRIMARY KEY, admin TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE season_marks (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  const v = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (v === 0) {
    db.transaction(() => {
      db.run(SCHEMA);
      db.run("PRAGMA user_version = 1");
    })();
  }
  return db;
}
