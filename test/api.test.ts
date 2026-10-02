import { afterAll, beforeAll, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openDb } from "../src/db";
import { verifyDay } from "../src/fair";
import { DAY_MS, initSeason, tick } from "../src/game";
import { payoutMessage } from "../src/payout";
import { seasonTick } from "../src/prize";
import { createApp } from "../src/server";
import { dropBoardCache } from "../src/social";

const START = Date.parse("2026-10-06T00:00:00Z");
let clock = START + 10 * 3_600_000;
const db = openDb(":memory:");
const season = initSeason(db, START);
const app = createApp({ db, env: { DEV_LOGIN: "1", ADMIN_TOKENS: "ana:k1,bo:k2" }, now: () => clock });
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: app.routes, fetch: () => new Response("Not found", { status: 404 }) });
  app.attach(server);
  base = server.url.origin;
});
afterAll(() => server.stop(true));

async function call(path: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any, cookie: res.headers.get("set-cookie") ?? "" };
}
const sid = (setCookie: string) => ({ cookie: setCookie.split(";")[0]! });

test("sign-in needs the 18+ box", async () => {
  const r = await call("/api/auth/dev", { name: "nobox" });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain("18 or older");
});

test("test sign-in, visit, daily chest once a day", async () => {
  const s = sid((await call("/api/auth/dev", { name: "opener", accept: true, device: "d1" })).cookie);
  const v = await call("/api/visit", { seed: "ab".repeat(16) }, s);
  expect(v.status).toBe(200);
  expect(v.body.today.seed).toBe("ab".repeat(16));
  expect(v.body.season.phase).toBe("live");
  expect((await call("/api/visit", null, s)).status).toBe(400);
  // Two taps at once: one chest.
  const both = await Promise.all([call("/api/chest/open", { kind: "daily" }, s), call("/api/chest/open", { kind: "daily" }, s)]);
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(both.find((r) => r.status === 200)!.body.roll.sealed).toBe(true);
  expect(both.find((r) => r.status === 409)!.body.error).toBe("Today's chest is already open.");
});

test("signed out gets the signed-out sentence", async () => {
  const r = await call("/api/visit", {});
  expect(r.status).toBe(401);
  expect(r.body.error).toBe("Signed out. Sign in to continue.");
});

test("wallet sign-in with a signed message, a reused message fails", async () => {
  const acct = privateKeyToAccount(generatePrivateKey()); // throwaway key, never funded
  const { body } = await call("/api/auth/siwe/message", { address: acct.address });
  const signature = await acct.signMessage({ message: body.message });
  const ok = await call("/api/auth/siwe/verify", { message: body.message, signature, accept: true });
  expect(ok.status).toBe(200);
  expect(ok.body.player.needsName).toBe(true);
  const reuse = await call("/api/auth/siwe/verify", { message: body.message, signature, accept: true });
  expect(reuse.status).toBe(401);
  const other = (await call("/api/auth/siwe/message", { address: acct.address })).body.message as string;
  const moved = other.replace(/^URI: .*$/m, "URI: https://evil.example");
  expect((await call("/api/auth/siwe/verify", { message: moved, signature: await acct.signMessage({ message: moved }), accept: true })).status).toBe(401);
  const s = sid(ok.cookie);
  expect((await call("/api/name", { name: "walletpal" }, s)).status).toBe(200);
  expect((await call("/api/name", { name: "WALLETPAL" }, sid((await call("/api/auth/dev", { name: "other1", accept: true })).cookie))).status).toBe(409);
});

test("sealed receipt opens after the day ends and checks out", async () => {
  const s = sid((await call("/api/auth/dev", { name: "checker", accept: true })).cookie);
  await call("/api/visit", { seed: "cd".repeat(16) }, s);
  const o = await call("/api/chest/open", { kind: "daily" }, s);
  const day = o.body.roll.day;
  expect((await call(`/api/fair/check/${day}`, undefined, s)).body.secret).toBeNull();
  clock += DAY_MS;
  tick(db, clock, season);
  const c = await call(`/api/fair/check/${day}`, undefined, s);
  expect(c.body.secret).toMatch(/^[0-9a-f]{64}$/);
  const v = await verifyDay(c.body.secret, c.body.rolls, { commit: o.body.roll.commit, seeds: ["cd".repeat(16)] });
  expect(v.ok).toBe(true);
  expect((await call(`/api/roll/${o.body.roll.id}`)).body.sealed).toBe(false);
});

test("team review hides a player, appeal brings them back, every action logged by name", async () => {
  const login = await call("/api/auth/dev", { name: "suspect", accept: true });
  const s = sid(login.cookie);
  await call("/api/visit", {}, s);
  dropBoardCache();
  expect((await call("/api/admin/queue")).status).toBe(401);
  const id = login.body.player.id;
  expect((await call("/api/admin/review", { playerId: id, status: "review", reason: "Shared connection" }, { authorization: "Bearer k1" })).status).toBe(200);
  dropBoardCache();
  const lb = await call("/api/leaderboard?board=points");
  expect(lb.body.rows.some((r: any) => r.name === "suspect")).toBe(false);
  const st = await call("/api/visit", {}, s);
  expect(st.body.season.underReview).toBe(true);
  expect((await call("/api/appeal", { email: "me@example.com", text: "I am one person." }, s)).status).toBe(200);
  const appeals = (await call("/api/admin/appeals", undefined, { authorization: "Bearer k2" })).body;
  await call("/api/admin/appeal", { id: appeals[0].id, status: "accepted", answer: "Sorry." }, { authorization: "Bearer k2" });
  dropBoardCache();
  expect((await call("/api/leaderboard?board=points")).body.rows.some((r: any) => r.name === "suspect")).toBe(true);
  const log = db.query("SELECT admin, action FROM admin_log ORDER BY id").all();
  expect(log).toEqual([{ admin: "ana", action: "review" }, { admin: "bo", action: "appeal" }]);
});

test("share card and receipt page for a rare roll", async () => {
  // A rare roll row as the chest would write it (item 36 is a rare charm).
  const pid = (db.query("SELECT id FROM players WHERE name = 'opener'").get() as { id: number }).id;
  const row = db
    .query("INSERT INTO rolls (player_id, kind, n, day, seed, commit_hash, streak, rarity, item_id, at) VALUES (?, 'guaranteed', 99, '2026-10-06', 'ab', 'cd', 0, 'rare', 36, ?) RETURNING id")
    .get(pid, clock) as { id: number };
  const page = await fetch(`${base}/r/${row.id}`);
  expect(await page.text()).toContain('property="og:image"');
  const png = await fetch(`${base}/card/${row.id}.png`);
  expect(png.headers.get("content-type")).toBe("image/png");
});

test("invite link sets the cookie and the friend gets the referrer", async () => {
  const host = await call("/api/auth/dev", { name: "hosty", accept: true });
  const s = sid(host.cookie);
  const code = (await call("/api/visit", {}, s)).body.friends.code;
  const r = await fetch(`${base}/i/${code}?to=//evil.example`, { redirect: "manual" });
  expect(r.headers.get("location")).toBe("/");
  const slash = await fetch(`${base}/i/${code}?to=${encodeURIComponent("/\\evil.example")}`, { redirect: "manual" });
  expect(slash.headers.get("location")).toBe("/");
  const receipt = await fetch(`${base}/i/${code}?to=${encodeURIComponent("/#/receipt/5")}`, { redirect: "manual" });
  expect(receipt.headers.get("location")).toBe("/#/receipt/5");
  const inv = r.headers.get("set-cookie")!.split(";")[0]!;
  const friend = await call("/api/auth/dev", { name: "guesty", accept: true }, { cookie: inv });
  const ref = db.query("SELECT referrer_id FROM players WHERE id = ?").get(friend.body.player.id) as { referrer_id: number };
  expect(ref.referrer_id).toBe(host.body.player.id);
});

test("season end over HTTP: prize confirm by signature, winners hidden until published, test-only routes closed", async () => {
  const acct = privateKeyToAccount(generatePrivateKey()); // throwaway key, never funded
  const { body } = await call("/api/auth/siwe/message", { address: acct.address });
  const login = await call("/api/auth/siwe/verify", { message: body.message, signature: await acct.signMessage({ message: body.message }), accept: true });
  const s = sid(login.cookie);
  await call("/api/name", { name: "champ" }, s);
  db.query("UPDATE players SET wave_points = 999999 WHERE name = 'champ'").run();
  clock = season.end + 60_000;
  seasonTick(db, clock);
  const prize = (await call("/api/prize", undefined, s)).body;
  expect(prize).toMatchObject({ board: "points", place: 1, prize: 700, status: "waiting" });
  expect((await call("/api/winners")).body).toBeNull();
  const message = payoutMessage({ seasonId: prize.seasonId, playerId: prize.playerId, name: "champ", country: "Portugal", address: acct.address });
  const ok = await call("/api/prize/confirm", { country: "Portugal", address: acct.address, signature: await acct.signMessage({ message }) }, s);
  expect(ok.body.status).toBe("confirmed");
  expect((await call("/api/appeal", { email: "c@example.com", text: "Objection before publish.", kind: "objection" }, s)).status).toBe(409);
  expect((await call("/api/dev/chain", { method: "eth_chainId" })).status).toBe(404);
  expect((await call("/api/admin/dev", { action: "end-now" }, { authorization: "Bearer k1" })).status).toBe(404);
});

test("real server: every test-only route is 404, team routes too without team keys", async () => {
  const real = createApp({ db, env: {}, now: () => clock });
  const srv = Bun.serve({ port: 0, routes: real.routes, fetch: () => new Response("Not found", { status: 404 }) });
  real.attach(srv);
  try {
    const at = (path: string, data?: unknown, headers: Record<string, string> = {}) =>
      fetch(srv.url.origin + path, { method: data === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }).then((r) => r.status);
    expect(await at("/api/auth/dev", { name: "sneaky", accept: true })).toBe(404);
    expect(await at("/api/dev/chain", { method: "eth_chainId" })).toBe(404);
    expect(await at("/dev/explorer/tx/0x01")).toBe(404);
    expect(await at("/api/admin/dev", { action: "pay-all" })).toBe(404);
    expect(await at("/api/admin/queue", undefined, { authorization: "Bearer k1" })).toBe(404);
  } finally {
    srv.stop(true);
  }
});

test("hidden name shows as Hidden player on the leaderboard, except to the player", async () => {
  dropBoardCache();
  const s = sid((await call("/api/auth/dev", { name: "shyone", accept: true })).cookie);
  await call("/api/visit", {}, s);
  expect((await call("/api/settings", { hidden: true }, s)).status).toBe(200);
  dropBoardCache();
  const names = (r: any) => r.body.rows.map((x: any) => x.name);
  expect(names(await call("/api/leaderboard?board=points"))).not.toContain("shyone");
  expect(names(await call("/api/leaderboard?board=points"))).toContain("Hidden player");
  expect(names(await call("/api/leaderboard?board=points", undefined, s))).toContain("shyone");
});

test("every team route needs a team key", async () => {
  clock += 600_001; // fresh rate-limit window
  for (const path of ["queue", "appeals", "metrics", "winners"]) expect((await call(`/api/admin/${path}`)).status).toBe(401);
  for (const path of ["review", "appeal", "correction", "winner-check", "sanctions", "rate", "publish", "payout", "next-season"]) {
    expect((await call(`/api/admin/${path}`, {}, { authorization: "Bearer wrong" })).status).toBe(401);
  }
});

test("wrong team keys are rate limited", async () => {
  clock += 600_001;
  for (let i = 0; i < 20; i++) expect((await call("/api/admin/queue", undefined, { authorization: `Bearer guess${i}` })).status).toBe(401);
  expect((await call("/api/admin/queue", undefined, { authorization: "Bearer guess-last" })).status).toBe(429);
  expect((await call("/api/admin/queue", undefined, { authorization: "Bearer k1" })).status).toBe(200);
});
