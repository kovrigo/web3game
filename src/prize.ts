// Season end: snapshot, winners, confirmations, team checks, publication, payouts, next season.
//
//   season end ──> settle all ──> snapshot ──> winners (7 days to confirm, team checks)
//        excluded or late ──> next player from the boards (3 days to confirm)
//   all confirmed + checked ──> publish (3 days of objections) ──> payout links ──> paid ──> next season
import type { Database } from "bun:sqlite";
import { getAddress, isAddress, verifyMessage } from "viem";
import { PRIZES, SEASON_DAYS } from "./config";
import { currentSeason, DAY_MS, GameError, getPlayer, tick, type Season } from "./game";
import { assignPrizes, COUNTRY_RE, payoutMessage, type Board } from "./payout";
import { boards, dropBoardCache } from "./social";

export const CONFIRM_DAYS = 7;
export const REPLACEMENT_DAYS = 3;
export const OBJECTION_DAYS = 3;
export const PAY_WITHIN_DAYS = 14;

export type Winner = {
  id: number; season_id: number; board: Board; place: number; player_id: number; prize_usd: number; deadline: number;
  confirm: "waiting" | "confirmed" | "expired"; team: "pending" | "ok" | "excluded"; reason: string | null;
  country: string | null; address: string | null; message: string | null; signature: string | null; confirmed_at: number | null;
  sanctions_ok: number; tx_hash: string | null; replaced_at: number | null; created_at: number;
};

const log = (db: Database, admin: string, action: string, payload: unknown, now: number) =>
  db.query("INSERT INTO admin_log (admin, action, payload, at) VALUES (?, ?, ?, ?)").run(admin, action, JSON.stringify(payload), now);

export const activeWinners = (db: Database, season: Season) =>
  db.query<Winner, [number]>("SELECT * FROM winners WHERE season_id = ? AND replaced_at IS NULL ORDER BY board DESC, place").all(season.id);

// Every minute: the day and season-end work in game.ts, then the steps here.
export function seasonTick(db: Database, now: number) {
  let season = currentSeason(db)!;
  tick(db, now, season);
  if (now >= season.end && !season.snapshot_at) snapshot(db, season, now);
  season = currentSeason(db)!;
  if (season.snapshot_at && !season.paid_at) {
    db.query("UPDATE winners SET confirm = 'expired' WHERE season_id = ? AND confirm = 'waiting' AND replaced_at IS NULL AND deadline < ?").run(season.id, now);
    syncWinners(db, season, now);
  }
}

// Freezes both boards as they stood at the end.
export function snapshot(db: Database, season: Season, now: number) {
  db.transaction(() => {
    const b = boards(db, season, now, true);
    const ins = db.query("INSERT INTO snapshots (season_id, board, place, player_id, value) VALUES (?, ?, ?, ?, ?)");
    b.points.forEach((r, i) => ins.run(season.id, "points", i + 1, r.id, r.points));
    b.invites.forEach((r, i) => ins.run(season.id, "invites", i + 1, r.id, r.invites));
    db.query("UPDATE seasons SET snapshot_at = ? WHERE id = ?").run(now, season.id);
  }).immediate();
  syncWinners(db, currentSeason(db)!, now);
}

// Keeps the winner rows in line with the boards. Rows follow the player, not the place:
// when someone above drops out, the others move up and keep their confirmation.
export function syncWinners(db: Database, season: Season, now: number) {
  db.transaction(() => {
    const first = !db.query("SELECT 1 FROM winners WHERE season_id = ?").get(season.id);
    const out = new Set(
      db.query<{ player_id: number }, [number]>("SELECT player_id FROM winners WHERE season_id = ? AND (team = 'excluded' OR confirm = 'expired')").all(season.id).map((r) => r.player_id),
    );
    const b = boards(db, season, now, true);
    const { slots } = assignPrizes(b.points.map((r) => r.id), b.invites.map((r) => r.id), out);
    const active = activeWinners(db, season);
    for (const s of slots) {
      const cur = active.find((w) => w.board === s.board && w.player_id === s.playerId);
      if (cur) {
        if (cur.place !== s.place || cur.prize_usd !== s.prize) db.query("UPDATE winners SET place = ?, prize_usd = ? WHERE id = ?").run(s.place, s.prize, cur.id);
        continue;
      }
      const deadline = first ? season.end + CONFIRM_DAYS * DAY_MS : now + REPLACEMENT_DAYS * DAY_MS;
      db.query("INSERT INTO winners (season_id, board, place, player_id, prize_usd, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        season.id, s.board, s.place, s.playerId, s.prize, deadline, now,
      );
      letter(db, season, s.playerId, s.board, s.place, s.prize, deadline, now);
    }
    for (const w of active) {
      if (!slots.some((s) => s.board === w.board && s.playerId === w.player_id)) db.query("UPDATE winners SET replaced_at = ? WHERE id = ?").run(now, w.id);
    }
  }).immediate();
}

// No email service yet: letters wait in the outbox, shown on the team page.
function letter(db: Database, season: Season, playerId: number, board: Board, place: number, prize: number, deadline: number, now: number) {
  const p = getPlayer(db, playerId)!;
  if (!p.email) return;
  const by = new Date(deadline).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const body = [
    `Hi ${p.name ?? "player"},`,
    "",
    `You placed ${place} in the ${board === "points" ? "points race" : "invite race"} of Season One. Your prize is $${prize.toLocaleString("en-US")}, paid in ETH on Robinhood Chain.`,
    "",
    `Sign in to Season One and confirm your country and payout address by ${by}. If you do not confirm by then, the prize goes to the next player.`,
    "",
    "Season One",
  ].join("\n");
  db.query("INSERT INTO outbox (season_id, player_id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    season.id, playerId, p.email, "You won a prize in Season One", body, now,
  );
}

// The player's own prize row: active, or the latest one they lost (with the reason).
export function myPrize(db: Database, season: Season, playerId: number) {
  const w =
    db.query<Winner, [number, number]>("SELECT * FROM winners WHERE season_id = ? AND player_id = ? AND replaced_at IS NULL").get(season.id, playerId) ??
    db.query<Winner, [number, number]>("SELECT * FROM winners WHERE season_id = ? AND player_id = ? ORDER BY id DESC LIMIT 1").get(season.id, playerId);
  if (!w) return null;
  const p = getPlayer(db, playerId)!;
  return {
    id: w.id, board: w.board, place: w.place, prize: w.prize_usd, deadline: w.deadline,
    status: w.replaced_at ? (w.team === "excluded" ? "excluded" : w.confirm === "expired" ? "expired" : "moved") : w.tx_hash ? "paid" : w.confirm,
    reason: w.team === "excluded" ? w.reason : null,
    country: w.country, address: w.address, txHash: w.tx_hash,
    eth: season.eth_rate ? w.prize_usd / season.eth_rate : null,
    wallet: p.wallet, seasonId: season.id, playerId, name: p.name ?? "",
  };
}

export async function confirmPrize(db: Database, season: Season, playerId: number, country: string, address: string, signature: string, now: number) {
  const w = db.query<Winner, [number, number]>("SELECT * FROM winners WHERE season_id = ? AND player_id = ? AND replaced_at IS NULL").get(season.id, playerId);
  if (!w) throw new GameError("You have no prize to confirm.", 404);
  if (w.confirm !== "waiting") throw new GameError("Your prize is already confirmed.", 409);
  if (w.deadline < now) throw new GameError("The time to confirm has passed.", 409);
  if (!COUNTRY_RE.test(country.trim())) throw new GameError("Enter your country.");
  if (!isAddress(address.trim())) throw new GameError("That payout address is not valid.");
  const p = getPlayer(db, playerId)!;
  if (!p.wallet) throw new GameError("Sign in with a wallet to sign your confirmation.", 409);
  const message = payoutMessage({ seasonId: season.id, playerId, name: p.name ?? "", country: country.trim(), address: getAddress(address.trim()) });
  const ok = await verifyMessage({ address: p.wallet as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new GameError("The signature does not match your wallet.", 401);
  const r = db
    .query("UPDATE winners SET confirm = 'confirmed', country = ?, address = ?, message = ?, signature = ?, confirmed_at = ? WHERE id = ? AND confirm = 'waiting'")
    .run(country.trim(), getAddress(address.trim()), message, signature, now, w.id);
  if (!r.changes) throw new GameError("Your prize is already confirmed.", 409);
}

// ---------- team actions

const needEnded = (s: Season) => {
  if (!s.snapshot_at) throw new GameError("The season has not ended yet.", 409);
};
const getWinner = (db: Database, season: Season, id: number) => {
  const w = db.query<Winner, [number, number]>("SELECT * FROM winners WHERE id = ? AND season_id = ? AND replaced_at IS NULL").get(id, season.id);
  if (!w) throw new GameError("No such winner on the current list.", 404);
  return w;
};

export function teamCheck(db: Database, admin: string, season: Season, id: number, team: string, reason: string, now: number) {
  needEnded(season);
  if (team !== "ok" && team !== "excluded") throw new GameError("Check is ok or excluded.");
  if (team === "excluded" && !reason.trim()) throw new GameError("Give the reason the player will see.");
  getWinner(db, season, id);
  db.query("UPDATE winners SET team = ?, reason = ? WHERE id = ?").run(team, team === "excluded" ? reason.trim() : null, id);
  log(db, admin, "winner-check", { id, team, reason }, now);
  syncWinners(db, season, now);
}

export function sanctionsCheck(db: Database, admin: string, season: Season, id: number, now: number) {
  const w = getWinner(db, season, id);
  if (!w.address) throw new GameError("The winner has not confirmed an address yet.", 409);
  db.query("UPDATE winners SET sanctions_ok = 1 WHERE id = ?").run(id);
  log(db, admin, "sanctions-ok", { id, address: w.address }, now);
}

export function setRate(db: Database, admin: string, season: Season, rate: number, now: number) {
  needEnded(season);
  if (!(rate > 0) || rate > 1_000_000) throw new GameError("Rate is dollars per 1 ETH, above zero.");
  if (season.paid_at || activeWinners(db, season).some((w) => w.tx_hash)) throw new GameError("Payouts have started; the rate is fixed.", 409);
  db.query("UPDATE seasons SET eth_rate = ? WHERE id = ?").run(rate, season.id);
  log(db, admin, "eth-rate", { rate }, now);
}

export function publish(db: Database, admin: string, season: Season, now: number) {
  needEnded(season);
  if (season.published_at) throw new GameError("The list is already published.", 409);
  const list = activeWinners(db, season);
  const notReady = list.filter((w) => w.confirm !== "confirmed" || w.team !== "ok" || !w.sanctions_ok);
  if (!list.length) throw new GameError("No winners on the list.", 409);
  if (notReady.length) throw new GameError(`${notReady.length} winners still need confirmation, a team check or a sanctions check.`, 409);
  db.query("UPDATE seasons SET published_at = ? WHERE id = ?").run(now, season.id);
  log(db, admin, "publish", { winners: list.length }, now);
}

export const objectionsUntil = (s: Season) => (s.published_at ? s.published_at + OBJECTION_DAYS * DAY_MS : null);

export function recordPayout(db: Database, admin: string, season: Season, id: number, txHash: string, now: number) {
  if (!season.published_at) throw new GameError("Publish the list first.", 409);
  if (now < objectionsUntil(season)!) throw new GameError("Objections are still open.", 409);
  if (db.query("SELECT 1 FROM appeals WHERE kind = 'objection' AND status = 'open'").get()) throw new GameError("Answer every objection before paying.", 409);
  if (!season.eth_rate) throw new GameError("Set the ETH rate of the payout day first.", 409);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new GameError("A transaction link needs a 0x hash of 64 characters.");
  const w = getWinner(db, season, id);
  if (w.tx_hash) throw new GameError("This prize is already paid.", 409);
  if (w.confirm !== "confirmed" || w.team !== "ok" || !w.sanctions_ok) throw new GameError("This winner is not ready for payout.", 409);
  db.query("UPDATE winners SET tx_hash = ? WHERE id = ?").run(txHash.toLowerCase(), id);
  log(db, admin, "payout", { id, txHash }, now);
  if (activeWinners(db, season).every((x) => x.tx_hash)) db.query("UPDATE seasons SET paid_at = ? WHERE id = ?").run(now, season.id);
}

// After payouts: a new season. Points, corrections and counted friends start from zero; items stay.
export function startNextSeason(db: Database, admin: string, season: Season, start: number, now: number) {
  if (!season.paid_at) throw new GameError("Pay every prize before starting the next season.", 409);
  if (!(start > now)) throw new GameError("The next season must start in the future.");
  db.transaction(() => {
    db.query("INSERT INTO seasons (start, end) VALUES (?, ?)").run(start, start + SEASON_DAYS * DAY_MS);
    // Wave counters and roll numbers keep running: roll numbers must never repeat.
    db.query("UPDATE players SET wave_points = 0, dry_days = 0, streak = 0, last_daily_day = NULL, away_waves = 0, away_points = 0").run();
    log(db, admin, "next-season", { start }, now);
  }).immediate();
  dropBoardCache();
}

// Public list once published.
export function publicWinners(db: Database, season: Season) {
  if (!season.published_at) return null;
  return activeWinners(db, season).map((w) => ({
    board: w.board, place: w.place, prize: w.prize_usd, name: getPlayer(db, w.player_id)!.name, txHash: w.tx_hash,
    eth: season.eth_rate ? w.prize_usd / season.eth_rate : null,
  }));
}

export function teamView(db: Database, season: Season, now: number) {
  const list = db.query<Winner, [number]>("SELECT * FROM winners WHERE season_id = ? ORDER BY replaced_at IS NOT NULL, board DESC, place, id").all(season.id);
  const b = season.snapshot_at ? boards(db, season, now) : null;
  const out = new Set(list.filter((w) => w.team === "excluded" || w.confirm === "expired").map((w) => w.player_id));
  const reserve = b ? assignPrizes(b.points.map((r) => r.id), b.invites.map((r) => r.id), out).reserve : { points: [], invites: [] };
  const name = (id: number) => getPlayer(db, id)?.name ?? `#${id}`;
  return {
    season,
    payBy: season.end + PAY_WITHIN_DAYS * DAY_MS,
    objectionsUntil: objectionsUntil(season),
    winners: list.map((w) => ({ ...w, name: name(w.player_id), email: getPlayer(db, w.player_id)!.email, wallet: getPlayer(db, w.player_id)!.wallet })),
    reserve: { points: reserve.points.map(name), invites: reserve.invites.map(name) },
    outbox: db.query("SELECT * FROM outbox WHERE season_id = ? ORDER BY id DESC").all(season.id),
    places: PRIZES,
  };
}
