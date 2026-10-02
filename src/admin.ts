import type { Database } from "bun:sqlite";
import { dayOf, DAY_MS, GameError, type Season } from "./game";
import { dropBoardCache } from "./social";

export function adminFromToken(tokens: string | undefined, header: string | null): string | null {
  if (!tokens || !header?.startsWith("Bearer ")) return null;
  const given = header.slice(7);
  for (const pair of tokens.split(",")) {
    const [name, token] = pair.split(":");
    if (name && token && token === given) return name;
  }
  return null;
}

const log = (db: Database, admin: string, action: string, payload: unknown, now: number) =>
  db.query("INSERT INTO admin_log (admin, action, payload, at) VALUES (?, ?, ?, ?)").run(admin, action, JSON.stringify(payload), now);

// Accounts that share a connection or a device with another account, most shared first.
export function queue(db: Database) {
  return db
    .query<any, []>(
      `SELECT p.id, p.name, p.wallet, p.email, p.review, p.review_reason, p.referrer_id, p.created_at, p.wave_points,
         (SELECT COUNT(DISTINCT s2.player_id) FROM signals s1 JOIN signals s2 ON s2.ip_hash = s1.ip_hash AND s2.player_id != s1.player_id WHERE s1.player_id = p.id) AS shared_ip,
         (SELECT COUNT(DISTINCT s2.player_id) FROM signals s1 JOIN signals s2 ON s2.device = s1.device AND s2.device != 'none' AND s2.player_id != s1.player_id WHERE s1.player_id = p.id) AS shared_device,
         (SELECT COUNT(*) FROM players f WHERE f.referrer_id = p.id) AS invited,
         (SELECT COUNT(*) FROM appeals a WHERE a.player_id = p.id AND a.status = 'open') AS open_appeals
       FROM players p
       ORDER BY (p.review = 'review') DESC, open_appeals DESC, shared_ip + shared_device DESC, p.id
       LIMIT 200`,
    )
    .all();
}

export function setReview(db: Database, admin: string, playerId: number, status: string, reason: string, now: number) {
  if (status !== "ok" && status !== "review") throw new GameError("Status is ok or review.");
  if (status === "review" && !reason.trim()) throw new GameError("Give the general reason the player will see.");
  const r = db.query("UPDATE players SET review = ?, review_reason = ? WHERE id = ?").run(status, status === "review" ? reason.trim() : null, playerId);
  if (!r.changes) throw new GameError("No such player.", 404);
  log(db, admin, "review", { playerId, status, reason }, now);
  dropBoardCache();
}

export function submitAppeal(db: Database, playerId: number, email: string, text: string, now: number) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GameError("Enter an email we can answer to.");
  if (text.trim().length < 10) throw new GameError("Tell us a bit more, at least 10 characters.");
  if (db.query("SELECT 1 FROM appeals WHERE player_id = ? AND status = 'open'").get(playerId)) throw new GameError("Your appeal is already with the team.", 409);
  db.query("INSERT INTO appeals (player_id, email, text, at) VALUES (?, ?, ?, ?)").run(playerId, email.trim(), text.trim().slice(0, 2000), now);
}

export const appeals = (db: Database) =>
  db.query<any, []>("SELECT a.*, p.name, p.review FROM appeals a JOIN players p ON p.id = a.player_id ORDER BY a.status = 'open' DESC, a.id DESC LIMIT 200").all();

// An accepted appeal returns the player to the tables with every point: points were never removed.
export function resolveAppeal(db: Database, admin: string, id: number, status: string, answer: string, now: number) {
  if (status !== "accepted" && status !== "rejected") throw new GameError("Status is accepted or rejected.");
  const a = db.query<{ player_id: number }, [string, string, number, number]>(
    "UPDATE appeals SET status = ?, answer = ?, resolved_at = ? WHERE id = ? AND status = 'open' RETURNING player_id",
  ).get(status, answer.trim(), now, id);
  if (!a) throw new GameError("No open appeal with that id.", 404);
  if (status === "accepted") db.query("UPDATE players SET review = 'ok', review_reason = NULL WHERE id = ?").run(a.player_id);
  log(db, admin, "appeal", { id, status, answer }, now);
  dropBoardCache();
}

export function addCorrection(db: Database, admin: string, playerId: number, delta: number, reason: string, now: number) {
  if (!Number.isInteger(delta) || delta === 0) throw new GameError("Change must be a whole number, not zero.");
  if (!reason.trim()) throw new GameError("Give the reason that will be announced.");
  const p = db.query<{ name: string }, [number]>("SELECT name FROM players WHERE id = ?").get(playerId);
  if (!p) throw new GameError("No such player.", 404);
  db.query("INSERT INTO corrections (player_id, delta, reason, at) VALUES (?, ?, ?, ?)").run(playerId, delta, reason.trim(), now);
  db.query("INSERT INTO announcements (text, at) VALUES (?, ?)").run(
    `Score correction: ${p.name ?? "a player"} ${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")} pts. ${reason.trim()}`, now,
  );
  log(db, admin, "correction", { playerId, delta, reason }, now);
  dropBoardCache();
}

// Season numbers for the success criteria. Players under review are left out; their share is shown apart.
export function metrics(db: Database, season: Season, now: number) {
  const one = (sql: string, ...args: any[]) => (db.query(sql).get(...args) as { n: number }).n;
  const players = one("SELECT COUNT(*) AS n FROM players WHERE review = 'ok'");
  const all = one("SELECT COUNT(*) AS n FROM players");
  const sday = dayOf(season.start);
  const counted = one(
    `SELECT COUNT(*) AS n FROM players f WHERE f.review = 'ok' AND f.referrer_id IS NOT NULL
     AND (SELECT COUNT(*) FROM active_days a WHERE a.player_id = f.id AND a.day >= ?) >= 3`, sday,
  );
  const retained = (offset: number) => {
    const base = db
      .query<{ id: number; first: string }, [number, string]>(
        `SELECT p.id, MIN(a.day) AS first FROM players p JOIN active_days a ON a.player_id = p.id
         WHERE p.review = 'ok' GROUP BY p.id HAVING julianday(MIN(a.day)) + ? <= julianday(?)`,
      )
      .all(offset, dayOf(now));
    const back = base.filter((b) => db.query("SELECT 1 FROM active_days WHERE player_id = ? AND day = ?").get(b.id, dayOf(Date.parse(b.first) + offset * DAY_MS)));
    return { eligible: base.length, returned: back.length };
  };
  const sharers = one("SELECT COUNT(DISTINCT s.player_id) AS n FROM shares s JOIN players p ON p.id = s.player_id WHERE p.review = 'ok'");
  return {
    at: now, players, accounts: all,
    invitedShare: players ? counted / players : 0,
    invitesPer10: players ? (counted / players) * 10 : 0,
    day1: retained(1), day7: retained(7),
    sharedShare: players ? sharers / players : 0,
    underReviewShare: all ? (all - players) / all : 0,
  };
}
