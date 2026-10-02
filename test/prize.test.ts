import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { findOrCreate } from "../src/auth";
import { openDb } from "../src/db";
import { resolveAppeal, submitAppeal } from "../src/admin";
import { currentSeason, DAY_MS, getPlayer, initSeason, phaseOf, visit, type Season } from "../src/game";
import { amountAfterGas, assignPrizes, formatEth, payoutMessage } from "../src/payout";
import * as P from "../src/prize";
import { dropBoardCache } from "../src/social";

const START = Date.parse("2026-10-06T00:00:00Z");
const END = START + 28 * DAY_MS;
let db: Database;
let season: Season;
const S = () => currentSeason(db)!;

beforeEach(() => {
  db = openDb(":memory:");
  season = initSeason(db, START);
  dropBoardCache();
});

// n players with falling points; player i has (n - i) * 100 points.
function players(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const id = findOrCreate(db, { name: `p${i + 1}` }, START);
    db.query("UPDATE players SET wave_points = ? WHERE id = ?").run((n - i) * 100, id);
    return id;
  });
}

test("one person, one prize: the bigger prize wins, a tie keeps the points race", () => {
  const pts = [1, 2, 3, 4, 5], inv = [3, 1, 6, 7];
  const a = assignPrizes(pts, inv, new Set());
  // Player 1: points 1st $700 vs invites 2nd $250. Player 3: points 3rd $300 vs invites 1st $400.
  const of = (b: string) => a.slots.filter((s) => s.board === b).map((s) => s.playerId);
  expect(of("points")).toEqual([1, 2, 4, 5]);
  expect(of("invites")).toEqual([3, 6, 7]);
  expect(a.slots.find((s) => s.playerId === 4)).toMatchObject({ place: 3, prize: 300 });
  // Without player 1, player 3 is 2nd in points ($450), more than 1st in invites ($400).
  const out = assignPrizes(pts, inv, new Set([1]));
  expect(out.slots.filter((s) => s.board === "invites").map((s) => s.playerId)).toEqual([6, 7]);
  expect(out.slots.some((s) => s.playerId === 1)).toBe(false);
});

test("reserve is the next 10 of each board", () => {
  const ids = Array.from({ length: 40 }, (_, i) => i + 1);
  const a = assignPrizes(ids, [], new Set());
  expect(a.slots).toHaveLength(20);
  expect(a.reserve.points).toEqual(ids.slice(20, 30));
});

test("amount after gas and ETH formatting", () => {
  expect(amountAfterGas(10n ** 18n, 10n ** 9n)).toEqual({ fee: 21_000n * 10n ** 9n, value: 10n ** 18n - 21_000n * 10n ** 9n });
  expect(amountAfterGas(1000n, 10n ** 9n).value).toBe(0n);
  expect(formatEth(1_234_500_000_000_000_000n)).toBe("1.2345");
  expect(formatEth(10n ** 18n)).toBe("1");
});

test("season end: snapshot, 30 winners, letters only for email players, 7 days to confirm", () => {
  const ids = players(35);
  db.query("UPDATE players SET email = 'p1@example.com' WHERE id = ?").run(ids[0]!);
  P.seasonTick(db, END + 60_000);
  expect(S().snapshot_at).toBe(END + 60_000);
  expect((db.query("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }).n).toBe(35);
  const w = P.activeWinners(db, S());
  expect(w).toHaveLength(20); // nobody invited anyone: invite race is empty
  expect(w.every((x) => x.deadline === END + 7 * DAY_MS)).toBe(true);
  const mail = db.query("SELECT to_email, subject, status FROM outbox").all();
  expect(mail).toEqual([{ to_email: "p1@example.com", subject: "You won a prize in Season One", status: "waiting" }]);
  expect(phaseOf(S(), END + 60_000)).toBe("ended");
});

test("points freeze at the end: a late visit adds nothing", () => {
  const [a] = players(1);
  visit(db, a!, END - 60 * 60_000, season);
  const before = getPlayer(db, a!)!.wave;
  visit(db, a!, END + 5 * 60 * 60_000, season);
  expect(getPlayer(db, a!)!.wave - before).toBe(60); // the last hour only
});

test("excluded winner: others move up and keep their confirmation, the newcomer gets 3 days", () => {
  const ids = players(25);
  P.seasonTick(db, END + 60_000);
  const second = P.activeWinners(db, S()).find((w) => w.player_id === ids[1])!;
  db.query("UPDATE winners SET confirm = 'confirmed' WHERE id = ?").run(second.id);
  const first = P.activeWinners(db, S()).find((w) => w.player_id === ids[0])!;
  const t = END + DAY_MS;
  P.teamCheck(db, "ana", S(), first.id, "excluded", "Same device as another winner.", t);
  const list = P.activeWinners(db, S());
  expect(list.find((w) => w.player_id === ids[1])).toMatchObject({ place: 1, prize_usd: 700, confirm: "confirmed" });
  expect(list.find((w) => w.player_id === ids[20])).toMatchObject({ place: 20, deadline: t + 3 * DAY_MS });
  expect(P.myPrize(db, S(), ids[0]!)).toMatchObject({ status: "excluded", reason: "Same device as another winner." });
});

test("no confirmation in 7 days: the prize goes to the next player", () => {
  const ids = players(21);
  P.seasonTick(db, END + 60_000);
  db.query("UPDATE winners SET confirm = 'confirmed' WHERE player_id != ?").run(ids[4]!);
  P.seasonTick(db, END + 7 * DAY_MS + 60_000);
  expect(P.myPrize(db, S(), ids[4]!)!.status).toBe("expired");
  expect(P.activeWinners(db, S()).some((w) => w.player_id === ids[20])).toBe(true);
});

async function confirmWith(acct: ReturnType<typeof privateKeyToAccount>, playerId: number, address: string, t: number) {
  const message = payoutMessage({ seasonId: S().id, playerId, name: getPlayer(db, playerId)!.name!, country: "Portugal", address });
  return P.confirmPrize(db, S(), playerId, "Portugal", address, await acct.signMessage({ message }), t);
}

test("winner signs country and address with the sign-in wallet", async () => {
  const [id] = players(1);
  const acct = privateKeyToAccount(generatePrivateKey()); // throwaway key, never funded
  db.query("UPDATE players SET wallet = ? WHERE id = ?").run(acct.address, id!);
  P.seasonTick(db, END + 60_000);
  const other = privateKeyToAccount(generatePrivateKey());
  await expect(confirmWith(other, id!, acct.address, END + DAY_MS)).rejects.toThrow("The signature does not match your wallet.");
  // A signature over one address does not confirm another.
  const signed = await acct.signMessage({ message: payoutMessage({ seasonId: S().id, playerId: id!, name: "p1", country: "Portugal", address: acct.address }) });
  await expect(P.confirmPrize(db, S(), id!, "Portugal", other.address, signed, END + DAY_MS)).rejects.toThrow("does not match");
  await expect(P.confirmPrize(db, S(), id!, "1", acct.address, signed, END + DAY_MS)).rejects.toThrow("Enter your country.");
  await expect(P.confirmPrize(db, S(), id!, "Portugal", "0x123", signed, END + DAY_MS)).rejects.toThrow("not valid");
  await expect(confirmWith(acct, id!, acct.address, END + 8 * DAY_MS)).rejects.toThrow("time to confirm has passed");
  await confirmWith(acct, id!, acct.address, END + DAY_MS);
  expect(P.myPrize(db, S(), id!)).toMatchObject({ status: "confirmed", country: "Portugal", address: acct.address });
  await expect(confirmWith(acct, id!, acct.address, END + DAY_MS)).rejects.toThrow("already confirmed");
});

test("publish, objections, payout links, paid, next season", async () => {
  const [a, b] = players(2);
  const acct = privateKeyToAccount(generatePrivateKey());
  P.seasonTick(db, END + 60_000);
  let t = END + DAY_MS;
  expect(() => P.publish(db, "ana", S(), t)).toThrow("2 winners still need");
  for (const id of [a!, b!]) {
    const w = P.activeWinners(db, S()).find((x) => x.player_id === id)!;
    db.query("UPDATE winners SET confirm = 'confirmed', address = ? WHERE id = ?").run(acct.address, w.id);
    P.teamCheck(db, "ana", S(), w.id, "ok", "", t);
    P.sanctionsCheck(db, "ana", S(), w.id, t);
  }
  P.publish(db, "ana", S(), t);
  expect(phaseOf(S(), t)).toBe("published");
  expect(P.publicWinners(db, S())!.map((w) => w.name)).toEqual(["p1", "p2"]);
  const hash = `0x${"ab".repeat(32)}`;
  const [w1, w2] = P.activeWinners(db, S());
  expect(() => P.recordPayout(db, "bo", S(), w1!.id, hash, t + DAY_MS)).toThrow("Objections are still open.");
  submitAppeal(db, b!, "p2@example.com", "Player p1 shares my flat.", t + DAY_MS, "objection");
  t += 3 * DAY_MS + 1;
  expect(() => P.recordPayout(db, "bo", S(), w1!.id, hash, t)).toThrow("Answer every objection before paying.");
  db.query("UPDATE appeals SET status = 'rejected'").run();
  expect(() => P.recordPayout(db, "bo", S(), w1!.id, hash, t)).toThrow("Set the ETH rate");
  P.setRate(db, "bo", S(), 3200, t);
  expect(() => P.startNextSeason(db, "bo", S(), t + DAY_MS, t)).toThrow("Pay every prize");
  P.recordPayout(db, "bo", S(), w1!.id, hash, t);
  expect(() => P.setRate(db, "bo", S(), 3000, t)).toThrow("rate is fixed");
  expect(() => P.recordPayout(db, "bo", S(), w2!.id, hash.toUpperCase().replace("0X", "0x"), t)).toThrow("already recorded for another prize");
  expect(() => P.teamCheck(db, "ana", S(), w2!.id, "excluded", "Late finding.", t)).toThrow("the list is fixed");
  // A correction after payouts started moves nobody.
  db.query("UPDATE players SET wave_points = 5000 WHERE id = ?").run(b!);
  P.seasonTick(db, t);
  expect(P.activeWinners(db, S()).map((w) => [w.player_id, w.prize_usd])).toEqual([[a!, 700], [b!, 450]]);
  P.recordPayout(db, "bo", S(), w2!.id, `0x${"cd".repeat(32)}`, t);
  expect(phaseOf(S(), t)).toBe("paid");
  expect(P.myPrize(db, S(), a!)).toMatchObject({ status: "paid", txHash: hash, eth: 700 / 3200 });

  db.query("INSERT INTO gear (player_id, slot, item_id, roll_id) VALUES (?, 'charm', 36, 1)").run(a!);
  P.startNextSeason(db, "bo", S(), t + DAY_MS, t);
  expect(S().id).toBe(2);
  expect(getPlayer(db, a!)!.wave_points).toBe(0);
  // Last season's prize and payout links stay visible during the next season.
  expect(P.prizeSeason(db)!.id).toBe(1);
  expect(P.myPrize(db, P.prizeSeason(db)!, a!)).toMatchObject({ status: "paid", txHash: hash });
  expect(db.query("SELECT item_id FROM gear WHERE player_id = ?").get(a!)).toEqual({ item_id: 36 });
  const log = db.query("SELECT admin, action FROM admin_log ORDER BY id").all() as { action: string }[];
  expect(log.map((l) => l.action)).toContain("next-season");
});

test("only players with a place on a board of that season may object", () => {
  const [a] = players(1);
  const zero = findOrCreate(db, { name: "zero" }, START);
  db.query("UPDATE players SET rest_at = ? WHERE id = ?").run(START, zero); // never fought: no points
  P.seasonTick(db, END + 60_000);
  const late = findOrCreate(db, { name: "late" }, END + DAY_MS);
  expect(P.canObject(db, S(), a!)).toBe(true);
  expect(P.canObject(db, S(), zero)).toBe(false);
  expect(P.canObject(db, S(), late)).toBe(false);
});

test("hidden winner keeps the real name on the winners list", () => {
  const [a] = players(1);
  db.query("UPDATE players SET hidden = 1 WHERE id = ?").run(a!);
  P.seasonTick(db, END + 60_000);
  const w = P.activeWinners(db, S())[0]!;
  db.query("UPDATE winners SET confirm = 'confirmed', address = ? WHERE id = ?").run(`0x${"11".repeat(20)}`, w.id);
  P.teamCheck(db, "ana", S(), w.id, "ok", "", END + DAY_MS);
  P.sanctionsCheck(db, "ana", S(), w.id, END + DAY_MS);
  P.publish(db, "ana", S(), END + DAY_MS);
  expect(P.publicWinners(db, S())!.map((x) => x.name)).toEqual(["p1"]);
});

// The player's latest dispute, accepted by the team.
function accept(playerId: number, t: number) {
  submitAppeal(db, playerId, "w@example.com", "I am a real person, please check again.", t);
  const { id } = db.query("SELECT id FROM appeals WHERE player_id = ? ORDER BY id DESC LIMIT 1").get(playerId) as { id: number };
  resolveAppeal(db, "bo", id, "accepted", "Checked again.", t);
}

test("accepted dispute restores an excluded winner with their confirmation; the stand-in moves off", () => {
  const ids = players(21);
  P.seasonTick(db, END + 60_000);
  const first = P.activeWinners(db, S()).find((w) => w.player_id === ids[0])!;
  db.query("UPDATE winners SET confirm = 'confirmed' WHERE id = ?").run(first.id);
  P.teamCheck(db, "ana", S(), first.id, "excluded", "Same device as another winner.", END + DAY_MS);
  expect(P.activeWinners(db, S()).some((w) => w.player_id === ids[20])).toBe(true);
  accept(ids[0]!, END + 2 * DAY_MS);
  expect(P.myPrize(db, S(), ids[0]!)).toMatchObject({ id: first.id, place: 1, status: "confirmed", reason: null });
  expect(P.activeWinners(db, S()).find((w) => w.player_id === ids[0])).toMatchObject({ team: "pending" });
  expect(P.myPrize(db, S(), ids[20]!)!.status).toBe("moved");
});

test("accepted dispute gives an expired winner 3 more days", () => {
  const ids = players(21);
  P.seasonTick(db, END + 60_000);
  db.query("UPDATE winners SET confirm = 'confirmed' WHERE player_id != ?").run(ids[4]!);
  const t = END + 7 * DAY_MS + 60_000;
  P.seasonTick(db, t);
  expect(P.myPrize(db, S(), ids[4]!)!.status).toBe("expired");
  accept(ids[4]!, t + DAY_MS);
  expect(P.myPrize(db, S(), ids[4]!)).toMatchObject({ status: "waiting", place: 5, deadline: t + DAY_MS + 3 * DAY_MS });
  P.seasonTick(db, t + DAY_MS + 60_000); // the minute tick keeps them on the list
  expect(P.myPrize(db, S(), ids[4]!)!.status).toBe("waiting");
});

test("accepted dispute after the prize was paid on: no prize left, the team sees it", () => {
  const [a, b] = players(2);
  P.seasonTick(db, END + 60_000);
  const t = END + DAY_MS;
  const wa = P.activeWinners(db, S()).find((w) => w.player_id === a)!;
  P.teamCheck(db, "ana", S(), wa.id, "excluded", "Shared wallet.", t);
  for (const w of P.activeWinners(db, S())) {
    db.query("UPDATE winners SET confirm = 'confirmed', address = ? WHERE id = ?").run(`0x${"22".repeat(20)}`, w.id);
    P.teamCheck(db, "ana", S(), w.id, "ok", "", t);
    P.sanctionsCheck(db, "ana", S(), w.id, t);
  }
  P.publish(db, "ana", S(), t);
  P.setRate(db, "bo", S(), 3200, t);
  const paidAt = t + 4 * DAY_MS;
  P.recordPayout(db, "bo", S(), P.activeWinners(db, S())[0]!.id, `0x${"ef".repeat(32)}`, paidAt);
  accept(a!, paidAt + DAY_MS);
  expect(P.myPrize(db, S(), a!)!.status).toBe("no_prize");
  expect(P.activeWinners(db, S()).map((w) => w.player_id)).toEqual([b!]);
  expect(P.teamView(db, S(), paidAt + DAY_MS).winners.find((w) => w.player_id === a)).toMatchObject({ no_prize: 1 });
});
