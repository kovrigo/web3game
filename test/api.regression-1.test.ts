// Regression: ISSUE-005 — "Object to the list" showed to players the server refuses
// Found by /qa on 2026-10-02
import { afterAll, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { DAY_MS, initSeason } from "../src/game";
import { seasonTick } from "../src/prize";
import { createApp } from "../src/server";

const START = Date.parse("2026-10-06T00:00:00Z");
const END = START + 28 * DAY_MS;
let clock = START + 3_600_000;
const db = openDb(":memory:");
initSeason(db, START);
const app = createApp({ db, env: { DEV_LOGIN: "1" }, now: () => clock });
const server = Bun.serve({ port: 0, routes: app.routes, fetch: () => new Response("Not found", { status: 404 }) });
app.attach(server);
afterAll(() => server.stop(true));

const post = async (path: string, data: unknown, cookie = "") => {
  const res = await fetch(server.url.origin + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(data) });
  return { body: (await res.json()) as any, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
};

test("state says who may object: a player on the final table, not a late sign-up", async () => {
  const player = (await post("/api/auth/dev", { name: "racer", accept: true })).cookie;
  expect((await post("/api/visit", {}, player)).body.canObject).toBe(false); // no table yet
  clock = END + 3_600_000;
  seasonTick(db, clock);
  expect((await post("/api/visit", {}, player)).body.canObject).toBe(true);
  const late = (await post("/api/auth/dev", { name: "latecomer", accept: true })).cookie;
  expect((await post("/api/visit", {}, late)).body.canObject).toBe(false);
});
