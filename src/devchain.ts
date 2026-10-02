// Mock chain for the test server only (DEV_LOGIN=1). No real network, keys or funds.
// It answers the few wallet calls the prize transfer uses. Transfers live in the test database,
// so a paid prize keeps its ETH across server restarts; a real database never gets the table.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { GameError } from "./game";

export const MOCK_CHAIN_ID = 31337;
const GAS_PRICE = 1_000_000_000n; // 1 gwei
const key = (a: string) => a.toLowerCase();
const hex = (n: bigint) => `0x${n.toString(16)}`;
type Tx = { hash: string; from_addr: string; to_addr: string; value: string; fee: string; at: number };

const ready = new WeakSet<Database>();
const table = (db: Database) => {
  if (!ready.has(db)) {
    db.run("CREATE TABLE IF NOT EXISTS mock_txs (hash TEXT PRIMARY KEY, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, value TEXT NOT NULL, fee TEXT NOT NULL, at INTEGER NOT NULL)");
    ready.add(db);
  }
  return db;
};
const send = (db: Database, from: string, to: string, value: bigint, fee: bigint, now: number) => {
  const hash = `0x${randomBytes(32).toString("hex")}`;
  table(db).query("INSERT INTO mock_txs (hash, from_addr, to_addr, value, fee, at) VALUES (?, ?, ?, ?, ?, ?)").run(hash, from, key(to), value.toString(), fee.toString(), now);
  return hash;
};
const balance = (db: Database, a: string) =>
  table(db)
    .query<Tx, [string, string]>("SELECT * FROM mock_txs WHERE to_addr = ? OR from_addr = ?")
    .all(key(a), key(a))
    .reduce((s, t) => s + (t.to_addr === key(a) ? BigInt(t.value) : 0n) - (t.from_addr === key(a) ? BigInt(t.value) + BigInt(t.fee) : 0n), 0n);

export const credit = (db: Database, to: string, wei: bigint, now: number) => send(db, "treasury", to, wei, 0n, now);

export function rpc(db: Database, method: string, params: any[], now: number): unknown {
  switch (method) {
    case "eth_chainId":
      return hex(BigInt(MOCK_CHAIN_ID));
    case "eth_getBalance":
      return hex(balance(db, String(params[0])));
    case "eth_gasPrice":
      return hex(GAS_PRICE);
    case "eth_sendTransaction": {
      const t = params[0] ?? {};
      const from = key(String(t.from)), value = BigInt(t.value ?? 0), gas = BigInt(t.gas ?? 21000), price = BigInt(t.gasPrice ?? GAS_PRICE);
      if (value < 0n || gas < 21000n || price < GAS_PRICE) throw new GameError("Mock chain: bad value, gas or gas price.");
      if (balance(db, from) < value + gas * price) throw new GameError("insufficient funds for gas * price + value");
      return send(db, from, String(t.to), value, gas * price, now);
    }
    default:
      throw new GameError(`Mock chain does not support ${method}.`);
  }
}

export const mockTx = (db: Database, hash: string) => {
  const t = table(db).query<Tx, [string]>("SELECT * FROM mock_txs WHERE hash = ?").get(hash);
  return t ? { from: t.from_addr, to: t.to_addr, value: t.value, at: t.at } : null;
};
export const mockBalance = (db: Database, a: string) => balance(db, a).toString();
