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

// Version 2: seasons in the database, season end, winners, payouts, letters.
const SEASON_END = `
CREATE TABLE seasons (
  id INTEGER PRIMARY KEY,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  snapshot_at INTEGER,                        -- boards frozen and saved
  published_at INTEGER,                       -- winners list public; objections for 3 days
  paid_at INTEGER,
  eth_rate REAL                               -- dollars per ETH on the payout day, set by the team
);
ALTER TABLE corrections ADD COLUMN season_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appeals ADD COLUMN kind TEXT NOT NULL DEFAULT 'appeal';   -- appeal | objection
CREATE TABLE snapshots (season_id INTEGER NOT NULL, board TEXT NOT NULL, place INTEGER NOT NULL, player_id INTEGER NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (season_id, board, place));
CREATE TABLE winners (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL,
  board TEXT NOT NULL,                        -- points | invites
  place INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id),
  prize_usd INTEGER NOT NULL,
  deadline INTEGER NOT NULL,                  -- confirm country and address by then
  confirm TEXT NOT NULL DEFAULT 'waiting',    -- waiting | confirmed | expired
  team TEXT NOT NULL DEFAULT 'pending',       -- pending | ok | excluded
  reason TEXT,
  country TEXT,
  address TEXT,
  message TEXT,
  signature TEXT,
  confirmed_at INTEGER,
  sanctions_ok INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  replaced_at INTEGER,                        -- no longer on the list
  created_at INTEGER NOT NULL
);
DROP TABLE season_marks;
CREATE TABLE outbox (id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL, player_id INTEGER NOT NULL, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at INTEGER NOT NULL, sent_at INTEGER);
`;

// Version 3: indexes for the boards, the team queue and the winner list; one prize per transaction.
const INDEXES = `
CREATE INDEX players_referrer ON players(referrer_id);
CREATE INDEX signals_ip ON signals(ip_hash);
CREATE INDEX signals_device ON signals(device);
CREATE INDEX corrections_season ON corrections(season_id, player_id);
CREATE INDEX winners_season ON winners(season_id, player_id);
CREATE UNIQUE INDEX winners_tx ON winners(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX waiting_player ON waiting_chests(player_id);
`;

// Version 4: a winner put back after an accepted objection or appeal.
const RESTORE = `
ALTER TABLE winners ADD COLUMN restored_at INTEGER;
ALTER TABLE winners ADD COLUMN no_prize INTEGER NOT NULL DEFAULT 0;   -- put back after the prize was already paid on
`;

export const log = (db: Database, admin: string, action: string, payload: unknown, now: number) =>
  db.query("INSERT INTO admin_log (admin, action, payload, at) VALUES (?, ?, ?, ?)").run(admin, action, JSON.stringify(payload), now);

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  const v = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  db.transaction(() => {
    if (v < 1) db.run(SCHEMA);
    if (v < 2) db.run(SEASON_END);
    if (v < 3) db.run(INDEXES);
    if (v < 4) db.run(RESTORE);
    db.run("PRAGMA user_version = 4");
  })();
  return db;
}
