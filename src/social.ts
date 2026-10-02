import type { Database } from "bun:sqlite";
import * as C from "./config";
import { ITEMS } from "./items";
import { DAY_MS, dayOf, fairDay, gearPower, getPlayer, phaseOf, seedAt, type RollRow, type Season } from "./game";

const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fag", "rape", "nazi", "hitler", "whore", "slut", "retard", "admin", "moderator"];
export function nameError(name: string): string | null {
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) return "Use 3 to 20 characters: letters, digits, dot, dash or underscore.";
  const low = name.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return "Pick another name.";
  return null;
}

const sday = (s: Season) => dayOf(s.start);
const eday = (s: Season) => dayOf(s.end - 1);

export type BoardRow = { id: number; name: string; founder: boolean; points: number; invites: number };

// Points = waves + capped share of counted friends + corrections. Players under review are left out.
function computeBoards(db: Database, season: Season) {
  const rows = db
    .query<BoardRow & { founder: number }, any>(
      `WITH counted AS (
         SELECT f.referrer_id AS rid, f.wave_points AS pts FROM players f
         WHERE f.referrer_id IS NOT NULL AND f.review = 'ok'
           AND (SELECT COUNT(*) FROM active_days a WHERE a.player_id = f.id AND a.day >= $sday) >= $need
       ),
       ref AS (SELECT rid, COUNT(*) AS n, SUM(pts) AS s FROM counted GROUP BY rid),
       corr AS (SELECT player_id, SUM(delta) AS d FROM corrections GROUP BY player_id)
       SELECT p.id, p.name,
         p.wave_points + min($cap, CAST(COALESCE(ref.s, 0) * $share AS INTEGER)) + COALESCE(corr.d, 0) AS points,
         COALESCE(ref.n, 0) AS invites,
         (SELECT COUNT(*) FROM active_days a WHERE a.player_id = p.id AND a.day BETWEEN $sday AND $eday) >= $fdays AS founder
       FROM players p LEFT JOIN ref ON ref.rid = p.id LEFT JOIN corr ON corr.player_id = p.id
       WHERE p.review = 'ok' AND p.name IS NOT NULL`,
    )
    .all({ sday: sday(season), eday: eday(season), need: C.INVITE_DAYS, cap: C.REF_CAP, share: C.REF_SHARE, fdays: C.FOUNDER_DAYS })
    .map((r) => ({ ...r, founder: !!r.founder }));
  // Ties: earlier sign-up first (lower id).
  const points = [...rows].sort((a, b) => b.points - a.points || a.id - b.id);
  const invites = rows.filter((r) => r.invites > 0).sort((a, b) => b.invites - a.invites || a.id - b.id);
  return { points, invites };
}

let cache: { at: number; db: Database; boards: ReturnType<typeof computeBoards> } | null = null;
export function boards(db: Database, season: Season, now: number, fresh = false) {
  if (fresh || !cache || cache.db !== db || now - cache.at > 10_000) cache = { at: now, db, boards: computeBoards(db, season) };
  return cache.boards;
}
export const dropBoardCache = () => void (cache = null);

export function standing(db: Database, season: Season, now: number, playerId: number, board: "points" | "invites") {
  const list = boards(db, season, now)[board];
  const i = list.findIndex((r) => r.id === playerId);
  const places = C.PRIZES[board].length;
  const me = i >= 0 ? list[i]! : null;
  const key = board === "points" ? "points" : "invites";
  const lineValue = list[places - 1]?.[key] ?? 0;
  const gap = me && i >= places ? lineValue - me[key] + 1 : 0;
  return { rank: i >= 0 ? i + 1 : null, row: me, gap, total: list.length, places };
}

export const founderOf = (db: Database, season: Season, playerId: number) =>
  db
    .query<{ n: number }, [number, string, string]>("SELECT COUNT(*) AS n FROM active_days WHERE player_id = ? AND day BETWEEN ? AND ?")
    .get(playerId, sday(season), eday(season))!.n;

export function friendsOf(db: Database, season: Season, playerId: number) {
  const list = db
    .query<{ id: number; name: string | null; review: string; days: number; pts: number }, [string, number]>(
      `SELECT f.id, f.name, f.review, f.wave_points AS pts,
         (SELECT COUNT(*) FROM active_days a WHERE a.player_id = f.id AND a.day >= ?) AS days
       FROM players f WHERE f.referrer_id = ? ORDER BY f.id`,
    )
    .all(sday(season), playerId);
  const counted = list.filter((f) => f.days >= C.INVITE_DAYS && f.review === "ok");
  const refPoints = Math.min(C.REF_CAP, Math.floor(counted.reduce((s, f) => s + f.pts, 0) * C.REF_SHARE));
  return {
    list: list.map((f) => ({ name: f.name ?? "New player", days: Math.min(f.days, C.INVITE_DAYS), counted: f.days >= C.INVITE_DAYS && f.review === "ok" })),
    counted: counted.length,
    refPoints,
  };
}

// Public view of a roll. Sealed until its day's secret is revealed.
export function rollView(db: Database, season: Season, r: RollRow) {
  const p = getPlayer(db, r.player_id)!;
  return {
    id: r.id, kind: r.kind, n: r.n, day: r.day, seed: r.seed, commit: r.commit_hash, streak: r.streak,
    rarity: r.rarity, itemId: r.item_id, item: r.item_id === null ? null : ITEMS[r.item_id]!, at: r.at,
    sealed: !fairDay(db, r.day)?.revealed_at,
    player: { name: p.hidden ? "Hidden player" : (p.name ?? "Player"), founder: founderOf(db, season, p.id) >= C.FOUNDER_DAYS, invite: p.invite_code },
  };
}

export function feed(db: Database, season: Season, limit = 20) {
  return db
    .query<RollRow, [number]>(
      `SELECT r.* FROM rolls r JOIN players p ON p.id = r.player_id
       WHERE r.rarity IN ('rare', 'epic', 'legendary') AND p.review = 'ok' ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((r) => rollView(db, season, r));
}

export function buildState(db: Database, playerId: number, now: number, season: Season) {
  const p = getPlayer(db, playerId)!;
  const today = dayOf(now);
  const pts = standing(db, season, now, playerId, "points");
  const fr = friendsOf(db, season, playerId);
  const corr = db.query<{ d: number | null }, [number]>("SELECT SUM(delta) AS d FROM corrections WHERE player_id = ?").get(playerId)!.d ?? 0;
  const gear = db.query<{ slot: string; item_id: number; roll_id: number }, [number]>("SELECT slot, item_id, roll_id FROM gear WHERE player_id = ?").all(playerId);
  const finds = db
    .query<RollRow, [number, number]>("SELECT * FROM rolls WHERE player_id = ? AND kind = 'find' AND rarity IS NOT NULL AND at >= ? ORDER BY id DESC LIMIT 20")
    .all(playerId, p.away_since)
    .map((r) => rollView(db, season, r));
  const waiting = db.query<{ id: number; kind: string }, [number]>("SELECT id, kind FROM waiting_chests WHERE player_id = ? AND roll_id IS NULL ORDER BY id").all(playerId);
  const appeal = db.query<{ status: string; answer: string | null }, [number]>("SELECT status, answer FROM appeals WHERE player_id = ? ORDER BY id DESC LIMIT 1").get(playerId);
  const fd = fairDay(db, today);
  const founderDays = founderOf(db, season, playerId);
  return {
    now,
    day: today,
    season: {
      phase: phaseOf(season, now), start: season.start, end: season.end,
      rank: pts.rank, gap: pts.gap, places: pts.places, total: pts.total,
      points: p.wave_points + fr.refPoints + corr, underReview: p.review !== "ok",
    },
    player: { name: p.name, hidden: !!p.hidden, founder: founderDays >= C.FOUNDER_DAYS, founderDays: Math.min(founderDays, C.FOUNDER_DAYS), wallet: p.wallet },
    away: { since: p.away_since, waves: p.away_waves, points: p.away_points, finds },
    hero: {
      wave: p.wave, power: gearPower(db, playerId), resting: p.rest_at <= now,
      gear: C.SLOTS.map((slot) => {
        const g = gear.find((x) => x.slot === slot);
        return { slot, item: g ? ITEMS[g.item_id]! : null, rollId: g?.roll_id ?? null };
      }),
    },
    chests: {
      dailyOpen: p.last_daily_day === today,
      nextDailyAt: Date.parse(`${today}T00:00:00Z`) + DAY_MS,
      waiting: waiting,
    },
    streak: { value: p.last_daily_day === today ? p.streak : Math.max(0, p.streak - Math.max(0, missedSince(p.last_daily_day, today) - 1)) },
    guarantee: { days: p.dry_days, need: C.GUARANTEE_DAYS },
    friends: { code: p.invite_code, list: fr.list, counted: fr.counted, refPoints: fr.refPoints, cap: C.REF_CAP, invites: standing(db, season, now, playerId, "invites") },
    today: { commit: fd?.commit_hash ?? null, seed: seedAt(db, playerId, now)?.seed ?? null },
    review: { status: p.review, reason: p.review_reason, appeal: appeal ?? null },
  };
}

function missedSince(lastDay: string | null, today: string) {
  if (!lastDay) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) / DAY_MS);
}
