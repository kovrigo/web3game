import type { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as C from "./config";
import { pick, rollMessage } from "./fair";
import { ITEMS } from "./items";

export type Season = { start: number; end: number };
export type Phase = "upcoming" | "live" | "final_day" | "ended";
export type Player = {
  id: number; name: string | null; wallet: string | null; email: string | null; hidden: number;
  referrer_id: number | null; invite_code: string; review: string; review_reason: string | null;
  accepted_at: number; created_at: number; last_tick: number; rest_at: number; last_visit: number;
  wave: number; wave_points: number; dry_days: number; streak: number; last_daily_day: string | null;
  daily_n: number; guar_n: number; away_since: number; away_waves: number; away_points: number;
};
export type RollRow = {
  id: number; player_id: number; kind: C.RollKind; n: number; day: string; seed: string;
  commit_hash: string; streak: number; rarity: C.Rarity | null; item_id: number | null; at: number;
};

export class GameError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const DAY_MS = 86_400_000;
const WAVE_MS = C.WAVE_SECONDS * 1000;
const AWAY_GAP_MS = 15 * 60_000;
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function seasonFromEnv(env: Record<string, string | undefined>): Season {
  const start = Date.parse(env.SEASON_START ?? "2026-10-06T00:00:00Z");
  if (Number.isNaN(start)) throw new Error(`SEASON_START is not a date: ${env.SEASON_START}`);
  return { start, end: start + C.SEASON_DAYS * DAY_MS };
}

export function phaseOf(s: Season, now: number): Phase {
  if (now < s.start) return "upcoming";
  if (now >= s.end) return "ended";
  return now >= s.end - DAY_MS ? "final_day" : "live";
}
const running = (s: Season, now: number) => now >= s.start && now < s.end;

export const getPlayer = (db: Database, id: number) =>
  db.query<Player, [number]>("SELECT * FROM players WHERE id = ?").get(id);

// Today's and tomorrow's secrets exist from the start of today, so any seed a
// player sets today post-dates the commit of every day it can be used on.
export function ensureDays(db: Database, now: number) {
  const ins = db.query("INSERT OR IGNORE INTO fair_days (day, secret, commit_hash, created_at) VALUES (?, ?, ?, ?)");
  for (const day of [dayOf(now), dayOf(now + DAY_MS)]) {
    const secret = randomBytes(32);
    ins.run(day, secret.toString("hex"), createHash("sha256").update(secret).digest("hex"), now);
  }
}

export const fairDay = (db: Database, day: string) =>
  db
    .query<{ day: string; secret: string; commit_hash: string; revealed_at: number | null }, [string]>(
      "SELECT day, secret, commit_hash, revealed_at FROM fair_days WHERE day = ?",
    )
    .get(day);

export const seedAt = (db: Database, playerId: number, t: number) =>
  db
    .query<{ seed: string; set_at: number }, [number, number]>(
      "SELECT seed, set_at FROM player_seeds WHERE player_id = ? AND set_at <= ? ORDER BY set_at DESC, rowid DESC LIMIT 1",
    )
    .get(playerId, t);

export const gearPower = (db: Database, playerId: number) =>
  db
    .query<{ item_id: number }, [number]>("SELECT item_id FROM gear WHERE player_id = ?")
    .all(playerId)
    .reduce((sum, g) => sum + C.POWER[ITEMS[g.item_id]!.rarity], 0);

function equipIfBetter(db: Database, playerId: number, itemId: number, rollId: number) {
  const item = ITEMS[itemId]!;
  const cur = db
    .query<{ item_id: number }, [number, string]>("SELECT item_id FROM gear WHERE player_id = ? AND slot = ?")
    .get(playerId, item.slot);
  if (cur && C.POWER[ITEMS[cur.item_id]!.rarity] >= C.POWER[item.rarity]) return;
  db.query("INSERT OR REPLACE INTO gear (player_id, slot, item_id, roll_id) VALUES (?, ?, ?, ?)").run(
    playerId, item.slot, itemId, rollId,
  );
}

// One roll. Returns null when the day has no secret or the player has no seed yet.
function roll(db: Database, playerId: number, kind: C.RollKind, n: number, at: number, streak: number): RollRow | null {
  const day = dayOf(at);
  const fd = fairDay(db, day);
  const seed = seedAt(db, playerId, at);
  if (!fd || !seed) {
    if (!fd) console.warn(`no secret for ${day}: ${kind} ${n} of player ${playerId} not rolled`);
    return null;
  }
  const h = new Uint8Array(createHmac("sha256", Buffer.from(fd.secret, "hex")).update(rollMessage(seed.seed, kind, n)).digest());
  const { rarity, itemId } = pick(h, kind, streak);
  const row = db
    .query<RollRow, any[]>(
      `INSERT INTO rolls (player_id, kind, n, day, seed, commit_hash, streak, rarity, item_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(playerId, kind, n, day, seed.seed, fd.commit_hash, streak, rarity, itemId, at)!;
  if (itemId !== null) equipIfBetter(db, playerId, itemId, row.id);
  if (rarity && C.RARE_UP.includes(rarity)) db.query("UPDATE players SET dry_days = 0 WHERE id = ?").run(playerId);
  return row;
}

// Credits waves from last_tick up to `now`, never past the season end or the hero's rest.
export function settle(db: Database, playerId: number, now: number, season: Season) {
  const p = getPlayer(db, playerId)!;
  const from = Math.max(p.last_tick, season.start);
  const to = Math.min(now, season.end, p.rest_at);
  const waves = to > from ? Math.floor((to - from) / WAVE_MS) : 0;
  if (waves === 0) return { waves: 0, points: 0 };
  const points = waves * (C.BASE_WAVE_POINTS + gearPower(db, playerId));
  for (let w = p.wave + 1; w <= p.wave + waves; w++) {
    if (w % C.FIND_EVERY === 0) roll(db, playerId, "find", w, from + (w - p.wave) * WAVE_MS, 0);
  }
  db.query("UPDATE players SET wave = wave + ?, wave_points = wave_points + ?, last_tick = ? WHERE id = ?").run(
    waves, points, from + waves * WAVE_MS, playerId,
  );
  return { waves, points };
}

const SEED_RE = /^[0-9a-f]{8,64}$/;

// A player's visit: settle waves, wake the hero, mark the active day, keep one seed per day.
export function visit(db: Database, playerId: number, now: number, season: Season, seed?: string) {
  return db.transaction(() => {
    const p = getPlayer(db, playerId)!;
    if (now - p.last_visit > AWAY_GAP_MS) {
      db.query("UPDATE players SET away_since = last_visit, away_waves = 0, away_points = 0 WHERE id = ?").run(playerId);
    }
    const r = settle(db, playerId, now, season);
    const resting = p.rest_at <= now;
    db.query(
      `UPDATE players SET away_waves = away_waves + ?, away_points = away_points + ?, last_visit = ?,
         rest_at = ?, last_tick = CASE WHEN ? THEN max(last_tick, ?) ELSE last_tick END WHERE id = ?`,
    ).run(r.waves, r.points, now, now + C.OFFLINE_CAP_SECONDS * 1000, resting ? 1 : 0, now, playerId);

    const today = dayOf(now);
    const fresh = db.query("INSERT OR IGNORE INTO active_days (player_id, day) VALUES (?, ?)").run(playerId, today).changes === 1;
    if (fresh && running(season, now)) {
      const dry = getPlayer(db, playerId)!.dry_days + 1;
      if (dry >= C.GUARANTEE_DAYS) {
        db.query("INSERT INTO waiting_chests (player_id, kind, at) VALUES (?, 'guaranteed', ?)").run(playerId, now);
      }
      db.query("UPDATE players SET dry_days = ? WHERE id = ?").run(dry >= C.GUARANTEE_DAYS ? 0 : dry, playerId);
    }
    const cur = seedAt(db, playerId, now);
    if (seed && SEED_RE.test(seed) && (!cur || cur.set_at < dayStart(today))) setSeed(db, playerId, seed, now);
  }).immediate();
}

export function setSeed(db: Database, playerId: number, seed: string, now: number) {
  if (!SEED_RE.test(seed)) throw new GameError("Your number must be 8 to 64 characters, 0-9 and a-f.");
  db.query("INSERT INTO player_seeds (player_id, seed, set_at) VALUES (?, ?, ?)").run(playerId, seed, now);
}

export function nextStreak(streak: number, lastDay: string | null, today: string) {
  if (!lastDay) return 1;
  const missed = Math.round((dayStart(today) - dayStart(lastDay)) / DAY_MS) - 1;
  return Math.min(C.STREAK_MAX, Math.max(0, streak - missed) + 1);
}

export function openChest(db: Database, playerId: number, kind: "daily" | "guaranteed", now: number, season: Season) {
  return db.transaction(() => {
    if (!running(season, now)) throw new GameError("The season is not running.", 409);
    const p = getPlayer(db, playerId)!;
    const today = dayOf(now);
    if (!fairDay(db, today)) throw new GameError("Chests open after today's seal is published.", 409);
    if (kind === "daily") {
      if (p.last_daily_day === today) throw new GameError("Today's chest is already open.", 409);
      const streak = nextStreak(p.streak, p.last_daily_day, today);
      const r = roll(db, playerId, "daily", p.daily_n + 1, now, streak);
      if (!r) throw new GameError("Chest not opened. Try again.", 409);
      db.query("UPDATE players SET last_daily_day = ?, streak = ?, daily_n = daily_n + 1 WHERE id = ?").run(today, streak, playerId);
      return r;
    }
    const chest = db
      .query<{ id: number }, [number]>("SELECT id FROM waiting_chests WHERE player_id = ? AND kind = 'guaranteed' AND roll_id IS NULL ORDER BY id LIMIT 1")
      .get(playerId);
    if (!chest) throw new GameError("No chests waiting.", 409);
    const r = roll(db, playerId, "guaranteed", p.guar_n + 1, now, 0);
    if (!r) throw new GameError("Chest not opened. Try again.", 409);
    db.query("UPDATE waiting_chests SET roll_id = ? WHERE id = ?").run(r.id, chest.id);
    db.query("UPDATE players SET guar_n = guar_n + 1 WHERE id = ?").run(playerId);
    return r;
  }).immediate();
}

// Every player's waves up to `at`, in one transaction.
export function settleAll(db: Database, at: number, season: Season) {
  db.transaction(() => {
    for (const { id } of db.query<{ id: number }, []>("SELECT id FROM players").all()) settle(db, id, at, season);
  }).immediate();
}

// Runs every minute: settle every player up to each finished day, then reveal it;
// at the season end, settle everyone up to the end once.
export function tick(db: Database, now: number, season: Season) {
  ensureDays(db, now);
  const today = dayOf(now);
  const due = db
    .query<{ day: string }, [string]>("SELECT day FROM fair_days WHERE revealed_at IS NULL AND day < ? ORDER BY day")
    .all(today);
  for (const { day } of due) {
    settleAll(db, dayStart(day) + DAY_MS, season);
    db.query("UPDATE fair_days SET revealed_at = ? WHERE day = ?").run(now, day);
  }
  if (now >= season.end && !db.query("SELECT 1 FROM season_marks WHERE key = 'end_settled'").get()) {
    settleAll(db, season.end, season);
    db.query("INSERT INTO season_marks (key, at) VALUES ('end_settled', ?)").run(now);
  }
}
