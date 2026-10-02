// Mock chain for the test server only (DEV_LOGIN=1). No real network, keys or funds.
// It answers the few wallet calls the prize transfer uses and keeps balances in memory.
import { randomBytes } from "node:crypto";
import { GameError } from "./game";

export const MOCK_CHAIN_ID = 31337;
const GAS_PRICE = 1_000_000_000n; // 1 gwei
const balances = new Map<string, bigint>();
const txs = new Map<string, { from: string; to: string; value: string; at: number }>();
const key = (a: string) => a.toLowerCase();
const hex = (n: bigint) => `0x${n.toString(16)}`;

export function credit(to: string, wei: bigint, now: number) {
  balances.set(key(to), (balances.get(key(to)) ?? 0n) + wei);
  const hash = `0x${randomBytes(32).toString("hex")}`;
  txs.set(hash, { from: "treasury", to, value: wei.toString(), at: now });
  return hash;
}

export function rpc(method: string, params: any[], now: number): unknown {
  switch (method) {
    case "eth_chainId":
      return hex(BigInt(MOCK_CHAIN_ID));
    case "eth_getBalance":
      return hex(balances.get(key(String(params[0]))) ?? 0n);
    case "eth_gasPrice":
      return hex(GAS_PRICE);
    case "eth_sendTransaction": {
      const t = params[0] ?? {};
      const from = key(String(t.from)), value = BigInt(t.value ?? 0), gas = BigInt(t.gas ?? 21000), price = BigInt(t.gasPrice ?? GAS_PRICE);
      if (value < 0n || gas < 21000n || price < GAS_PRICE) throw new GameError("Mock chain: bad value, gas or gas price.");
      const have = balances.get(from) ?? 0n;
      if (have < value + gas * price) throw new GameError("insufficient funds for gas * price + value");
      balances.set(from, have - value - gas * price);
      balances.set(key(String(t.to)), (balances.get(key(String(t.to))) ?? 0n) + value);
      const hash = `0x${randomBytes(32).toString("hex")}`;
      txs.set(hash, { from, to: String(t.to), value: value.toString(), at: now });
      return hash;
    }
    default:
      throw new GameError(`Mock chain does not support ${method}.`);
  }
}

export const mockTx = (hash: string) => txs.get(hash) ?? null;
export const mockBalance = (a: string) => (balances.get(key(a)) ?? 0n).toString();
