// Test server only (DEV_LOGIN=1 and MOCK_CHAIN=1): shortcuts that let a person walk the
// whole season end in minutes. Test players use the public Hardhat test mnemonic, so no
// secret key exists anywhere. Never reachable on a real server.
import type { Database } from "bun:sqlite";
import { mnemonicToAccount } from "viem/accounts";
import * as chain from "./devchain";
import { currentSeason, DAY_MS, GameError } from "./game";
import { payoutMessage } from "./payout";
import * as P from "./prize";

export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const testAccount = (i: number) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: i });

export async function devAction(db: Database, admin: string, action: string, now: number) {
  const s = currentSeason(db)!;
  if (action === "end-now") {
    if (now >= s.end) throw new GameError("The season has already ended.", 409);
    db.query("UPDATE seasons SET start = min(start, ?), end = ? WHERE id = ?").run(now - DAY_MS, now - 1, s.id);
    P.seasonTick(db, now);
    return;
  }
  if (action === "prepare-test-winners") {
    // Seeded test players sign with their test wallets and pass the team checks.
    const wallets = new Map(Array.from({ length: 40 }, (_, i) => [testAccount(i).address.toLowerCase(), i]));
    for (const w of P.activeWinners(db, s)) {
      const p = db.query<{ name: string; wallet: string | null }, [number]>("SELECT name, wallet FROM players WHERE id = ?").get(w.player_id)!;
      const i = p.wallet ? wallets.get(p.wallet.toLowerCase()) : undefined;
      if (i === undefined) continue;
      if (w.confirm === "waiting") {
        const message = payoutMessage({ seasonId: s.id, playerId: w.player_id, name: p.name, country: "Testland", address: p.wallet! });
        await P.confirmPrize(db, s, w.player_id, "Testland", p.wallet!, await testAccount(i).signMessage({ message }), now);
      }
      P.teamCheck(db, admin, currentSeason(db)!, w.id, "ok", "", now);
      P.sanctionsCheck(db, admin, currentSeason(db)!, w.id, now);
    }
    return;
  }
  if (action === "close-objections") {
    if (!s.published_at) throw new GameError("Publish the list first.", 409);
    db.query("UPDATE seasons SET published_at = ? WHERE id = ?").run(now - P.OBJECTION_DAYS * DAY_MS - 1, s.id);
    return;
  }
  if (action === "pay-all") {
    if (!s.eth_rate) throw new GameError("Set the ETH rate first.", 409);
    for (const w of P.activeWinners(db, s).filter((x) => !x.tx_hash)) {
      const wei = BigInt(Math.round((w.prize_usd / s.eth_rate) * 1e9)) * 10n ** 9n;
      P.recordPayout(db, admin, currentSeason(db)!, w.id, chain.credit(db, w.address!, wei, now), now);
    }
    return;
  }
  throw new GameError("Unknown test action.");
}
