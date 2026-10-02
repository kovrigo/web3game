// Regression: ISSUE-006 — a test server restart wiped paid prizes from the mock chain (0 ETH, explorer "null")
// Found by /qa on 2026-10-02
import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../src/db";
import * as chain from "../src/devchain";

test("mock chain balances and transactions survive a restart", () => {
  const path = `${tmpdir()}/devchain-${process.pid}.sqlite`;
  const me = "0x97aB5c0000000000000000000000000000008bB1";
  let db = openDb(path);
  const paid = chain.credit(db, me, 10n ** 17n, 1);
  db.close();
  db = openDb(path); // the server came back
  expect(BigInt(chain.rpc(db, "eth_getBalance", [me.toLowerCase()], 2) as string)).toBe(10n ** 17n);
  expect(chain.mockTx(db, paid)).toEqual({ from: "treasury", to: me.toLowerCase(), value: (10n ** 17n).toString(), at: 1 });
  const fee = 21000n * 1_000_000_000n;
  chain.rpc(db, "eth_sendTransaction", [{ from: me, to: "0x000000000000000000000000000000000000dEaD", value: `0x${(10n ** 17n - fee).toString(16)}`, gas: "0x5208", gasPrice: "0x3b9aca00" }], 3);
  expect(chain.mockBalance(db, me)).toBe("0");
  expect(chain.mockBalance(db, "0x000000000000000000000000000000000000dead")).toBe((10n ** 17n - fee).toString());
  expect(() => chain.rpc(db, "eth_sendTransaction", [{ from: me, to: me, value: "0x1" }], 4)).toThrow("insufficient funds");
  db.close();
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
});
