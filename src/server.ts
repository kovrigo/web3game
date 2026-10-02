import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import adminPage from "../web/admin.html";
import indexPage from "../web/index.html";
import * as A from "./admin";
import { createSession, endSession, SESSION_MS, findOrCreate, ipHash, rateLimit, recordSignal, sessionPlayer, siweMessage, siweVerify } from "./auth";
import { cardPng } from "./card";
import * as C from "./config";
import { openDb } from "./db";
import { getAddress, isAddress } from "viem";
import * as chain from "./devchain";
import { devAction } from "./devtools";
import { currentSeason, dayOf, ensureDays, fairDay, GameError, getPlayer, initSeason, openChest, phaseOf, setSeed, visit, type RollRow } from "./game";
import * as P from "./prize";
import { boards, buildState, dropBoardCache, feed, nameError, rollView, standing } from "./social";

type Env = Record<string, string | undefined>;
export type AppOptions = { db: Database; env: Env; now?: () => number };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown) => {
  if (e instanceof GameError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: "Something broke on our side. Try again." }, 500);
};
const cookies = (req: Request) =>
  Object.fromEntries((req.headers.get("cookie") ?? "").split(/;\s*/).filter((c) => c.includes("=")).map((c) => {
    const i = c.indexOf("=");
    const v = c.slice(i + 1);
    try {
      return [c.slice(0, i), decodeURIComponent(v)];
    } catch {
      return [c.slice(0, i), v];
    }
  }));
const body = async (req: Request) => {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, any>;
  } catch {}
  throw new GameError("Request body must be a JSON object.");
};

export function createApp({ db, env, now = Date.now }: AppOptions) {
  const dev = env.DEV_LOGIN === "1";
  const mock = dev && env.MOCK_CHAIN === "1";
  const S = () => currentSeason(db)!;
  const prize = (id: number) => {
    const s = P.prizeSeason(db);
    return s ? P.myPrize(db, s, id) : null;
  };
  const exchanges = (env.EXCHANGES ?? "").split(",").filter(Boolean).map((e) => {
    const [name, url] = e.split("|");
    return { name: name!.trim(), url: url?.trim() ?? null };
  });
  const salt = env.IP_SALT ?? "";
  const origin = (req: Request) => env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
  const sidCookie = (req: Request, token: string, maxAge: number) =>
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin(req).startsWith("https") ? "; Secure" : ""}`;
  let server: Server<unknown> | null = null;
  let feedCache: { at: number; rows: ReturnType<typeof feed> } | null = null;
  const cards = new Map<number, { at: number; png: Uint8Array<ArrayBuffer> }>(); // rendered share cards, 5 minutes
  let walletJs: Promise<string> | null = null; // web/wallet.ts, built on first request
  const ip = (req: Request) =>
    // The proxy appends the address it saw: the last entry is the only one a client cannot forge.
    (env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() : null) ?? server?.requestIP(req)?.address ?? "unknown";

  const me = (req: Request) => {
    const id = sessionPlayer(db, cookies(req).sid, now());
    if (!id) throw new GameError("Signed out. Sign in to continue.", 401);
    return id;
  };
  const named = (req: Request) => {
    const id = me(req);
    if (!getPlayer(db, id)!.name) throw new GameError("Pick a name first.", 409);
    return id;
  };
  // Every handler: JSON in, JSON out, errors as { error } with the sentence the player sees.
  const h = (fn: (req: Request & { params: Record<string, string> }) => unknown) => async (req: any) => {
    try {
      // Another site's page may not post with the player's cookie (the cookie's SameSite covers browsers, this covers sibling subdomains).
      const from = req.headers.get("origin");
      if (req.method !== "GET" && from && from !== origin(req)) throw new GameError("Requests from other sites are refused.", 403);
      const out = await fn(req);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return fail(e);
    }
  };

  const signIn = (req: Request, who: Parameters<typeof findOrCreate>[1], device: string) => {
    const t = now();
    const id = db.transaction(() => findOrCreate(db, { ...who, invite: cookies(req).inv }, t)).immediate();
    recordSignal(db, id, ipHash(salt, ip(req)), device ?? "", t);
    const token = createSession(db, id, t);
    const p = getPlayer(db, id)!;
    return new Response(JSON.stringify({ player: { id, name: p.name, needsName: !p.name } }), {
      headers: { "content-type": "application/json", "set-cookie": sidCookie(req, token, SESSION_MS / 1000) },
    });
  };
  const accepted = (b: Record<string, any>) => {
    if (b.accept !== true) throw new GameError("Confirm you are 18 or older and accept the season rules.");
  };

  const admin = (req: Request) => {
    if (!env.ADMIN_TOKENS) throw new GameError("Not found.", 404);
    const name = A.adminFromToken(env.ADMIN_TOKENS, req.headers.get("authorization"));
    if (!name) {
      rateLimit(`team:${ip(req)}`, 20, 600_000, now());
      throw new GameError("Wrong team key.", 401);
    }
    return name;
  };

  const routes = {
    "/": indexPage,
    "/admin": adminPage,

    "/api/season": h(() => ({
      id: S().id, phase: phaseOf(S(), now()), start: S().start, end: S().end, now: now(),
      publishedAt: S().published_at, objectionsUntil: P.objectionsUntil(S()), payBy: S().end + P.PAY_WITHIN_DAYS * 86_400_000, ethRate: S().eth_rate,
      treasury: env.TREASURY_ADDRESS ?? null, explorer: env.EXPLORER_URL ?? null,
      chainId: mock ? chain.MOCK_CHAIN_ID : env.CHAIN_ID ? Number(env.CHAIN_ID) : null, mockChain: mock, exchanges,
      fund: C.PRIZE_FUND, prizes: C.PRIZES, odds: { find: C.FIND_TABLE, guaranteed: C.GUARANTEED_TABLE, daily: [1, 2, 3, 4, 5, 6, 7].map(C.dailyTable) },
      devLogin: dev,
    })),

    "/api/session": h((req) => {
      const id = sessionPlayer(db, cookies(req).sid, now());
      const p = id ? getPlayer(db, id) : null;
      return { player: p ? { id: p.id, name: p.name, needsName: !p.name } : null };
    }),

    "/api/auth/dev": {
      POST: h(async (req) => {
        if (!dev) throw new GameError("Not found.", 404);
        rateLimit(`in:${ip(req)}`, 20, 600_000, now());
        const b = await body(req);
        accepted(b);
        const name = String(b.name ?? "");
        const err = nameError(name);
        if (err) throw new GameError(err);
        const res = signIn(req, { name }, String(b.device ?? ""));
        // Test server with the mock chain: the browser's throwaway wallet becomes the sign-in wallet.
        if (mock && typeof b.wallet === "string" && isAddress(b.wallet)) {
          db.query("UPDATE players SET wallet = ? WHERE name = ? AND wallet IS NULL AND NOT EXISTS (SELECT 1 FROM players WHERE wallet = ?)").run(getAddress(b.wallet), name, getAddress(b.wallet));
        }
        return res;
      }),
    },
    "/api/auth/siwe/message": {
      POST: h(async (req) => {
        rateLimit(`in:${ip(req)}`, 20, 600_000, now());
        const b = await body(req);
        return { message: siweMessage(db, String(b.address ?? ""), origin(req), now()) };
      }),
    },
    "/api/auth/siwe/verify": {
      POST: h(async (req) => {
        const b = await body(req);
        accepted(b);
        const wallet = await siweVerify(db, String(b.message ?? ""), String(b.signature ?? ""), origin(req), now());
        return signIn(req, { wallet }, String(b.device ?? ""));
      }),
    },
    "/api/auth/logout": {
      POST: h((req) => {
        const sid = cookies(req).sid;
        if (sid) endSession(db, sid);
        return new Response("{}", { headers: { "content-type": "application/json", "set-cookie": sidCookie(req, "", 0) } });
      }),
    },

    "/api/name": {
      POST: h(async (req) => {
        const id = me(req);
        const name = String((await body(req)).name ?? "").trim();
        const err = nameError(name);
        if (err) throw new GameError(err);
        if (getPlayer(db, id)!.name) throw new GameError("Your name is already set.", 409);
        if (db.query("SELECT 1 FROM players WHERE name = ?").get(name)) throw new GameError("That name is taken.", 409);
        db.query("UPDATE players SET name = ? WHERE id = ?").run(name, id);
        dropBoardCache();
        return { name };
      }),
    },

    "/api/visit": {
      POST: h(async (req) => {
        const id = named(req);
        rateLimit(`visit:${id}`, 120, 600_000, now());
        const b = await body(req);
        const t = now();
        ensureDays(db, t);
        visit(db, id, t, S(), typeof b.seed === "string" ? b.seed : undefined);
        if (typeof b.device === "string") recordSignal(db, id, ipHash(salt, ip(req)), b.device, t);
        return { ...buildState(db, id, t, S()), prize: prize(id) };
      }),
    },

    "/api/chest/open": {
      POST: h(async (req) => {
        const id = named(req);
        rateLimit(`open:${id}`, 60, 600_000, now());
        const kind = (await body(req)).kind;
        if (kind !== "daily" && kind !== "guaranteed") throw new GameError("Unknown chest.");
        const t = now();
        const r = openChest(db, id, kind, t, S()); // points move only with waves: the board cache stays
        return { roll: rollView(db, S(), r), state: { ...buildState(db, id, t, S()), prize: prize(id) } };
      }),
    },

    "/api/seed": {
      POST: h(async (req) => {
        const id = named(req);
        rateLimit(`seed:${id}`, 20, 600_000, now());
        const seed = String((await body(req)).seed ?? "").trim().toLowerCase();
        setSeed(db, id, seed, now());
        return { seed };
      }),
    },

    "/api/rolls": h((req) => {
      const id = named(req);
      const rows = db
        .query<RollRow, [number]>("SELECT * FROM rolls WHERE player_id = ? AND (kind != 'find' OR rarity IS NOT NULL) ORDER BY id DESC LIMIT 50")
        .all(id);
      return rows.map((r) => rollView(db, S(), r));
    }),

    "/api/roll/:id": h((req) => {
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(Number(req.params.id));
      if (!r) throw new GameError("No such roll.", 404);
      return rollView(db, S(), r);
    }),

    "/api/fair/days": h(() =>
      db
        .query<{ day: string; commit_hash: string; revealed_at: number | null }, []>("SELECT day, commit_hash, revealed_at FROM fair_days ORDER BY day DESC LIMIT 8")
        .all()
        .map((d) => ({ day: d.day, commit: d.commit_hash, revealed: !!d.revealed_at })),
    ),

    "/api/fair/check/:day": h((req) => {
      const id = named(req);
      const day = String(req.params.day);
      const fd = fairDay(db, day);
      if (!fd) throw new GameError("No seal for that day.", 404);
      const rolls = db.query<RollRow, [number, string]>("SELECT * FROM rolls WHERE player_id = ? AND day = ? ORDER BY id").all(id, day);
      return {
        day, commit: fd.commit_hash, secret: fd.revealed_at ? fd.secret : null,
        rolls: rolls.map((r) => ({ id: r.id, kind: r.kind, n: r.n, seed: r.seed, commit: r.commit_hash, streak: r.streak, rarity: r.rarity, itemId: r.item_id })),
      };
    }),

    "/api/leaderboard": h((req) => {
      const board = new URL(req.url).searchParams.get("board") === "invites" ? "invites" : "points";
      const t = now();
      const list = boards(db, S(), t)[board];
      const id = sessionPlayer(db, cookies(req).sid, t);
      const mine = id ? standing(db, S(), t, id, board) : null;
      return {
        board, total: list.length, places: C.PRIZES[board].length,
        // A hidden name shows as "Hidden player" to everyone else; the winners list keeps real names.
        rows: list.slice(0, 50).map((r, i) => ({ rank: i + 1, name: r.hidden && r.id !== id ? "Hidden player" : r.name, founder: r.founder, points: r.points, invites: r.invites, me: r.id === id })),
        me: mine?.row ? { rank: mine.rank, name: mine.row.name, founder: mine.row.founder, points: mine.row.points, invites: mine.row.invites, gap: mine.gap } : null,
      };
    }),

    "/api/feed": h(() => {
      // Polled by every open page: one query per 5 seconds at most.
      if (!feedCache || now() - feedCache.at > 5_000) feedCache = { at: now(), rows: feed(db, S()) };
      return feedCache.rows;
    }),

    "/api/announcements": h(() => db.query("SELECT text, at FROM announcements ORDER BY id DESC LIMIT 20").all()),

    "/api/settings": {
      POST: h(async (req) => {
        const id = named(req);
        const b = await body(req);
        if (typeof b.hidden !== "boolean") throw new GameError("Hidden is true or false.");
        db.query("UPDATE players SET hidden = ? WHERE id = ?").run(b.hidden ? 1 : 0, id);
        return { hidden: b.hidden };
      }),
    },

    "/api/share": {
      POST: h(async (req) => {
        const id = named(req);
        rateLimit(`share:${id}`, 30, 600_000, now());
        const b = await body(req);
        if (b.channel !== "x" && b.channel !== "telegram") throw new GameError("Unknown channel.");
        const r = db.query("SELECT 1 FROM rolls WHERE id = ? AND player_id = ?").get(Number(b.rollId), id);
        if (!r) throw new GameError("No such roll.", 404);
        db.query("INSERT INTO shares (player_id, roll_id, channel, at) VALUES (?, ?, ?, ?)").run(id, Number(b.rollId), b.channel, now());
        return {};
      }),
    },

    "/api/appeal": {
      POST: h(async (req) => {
        const id = named(req);
        const b = await body(req);
        const kind = b.kind === "objection" ? "objection" : "appeal";
        if (kind === "objection" && !(S().published_at && now() < P.objectionsUntil(S())!)) throw new GameError("Objections are closed.", 409);
        if (kind === "objection" && !P.canObject(db, S(), id)) throw new GameError("Only players with a place on this season's tables can object.", 403);
        A.submitAppeal(db, id, String(b.email ?? ""), String(b.text ?? ""), now(), kind);
        return {};
      }),
    },

    "/i/:code": (req: any) => {
      const to = new URL(req.url).searchParams.get("to");
      const code = String(req.params.code).replace(/[^A-Z0-9]/gi, "").slice(0, 16);
      return new Response(null, {
        status: 302,
        headers: { location: to && /^\/#\/[\w/-]*$/.test(to) ? to : "/", "set-cookie": `inv=${code}; Path=/; SameSite=Lax; Max-Age=${30 * 86400}` },
      });
    },

    "/r/:id": (req: any) => {
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(Number(req.params.id));
      if (!r || !r.rarity || r.item_id === null) return new Response("Not found", { status: 404 });
      const v = rollView(db, S(), r);
      const o = origin(req);
      const title = `${v.player.name} found ${v.item!.name} (${cap(v.rarity!)}) in Season One`;
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const go = `/i/${v.player.invite}?to=${encodeURIComponent(`/#/receipt/${v.id}`)}`;
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Free daily chest, provably fair.">
<meta property="og:image" content="${o}/card/${v.id}.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0; url=${esc(go)}">
</head><body style="background:#14110F;color:#F4EDE4;font-family:sans-serif"><a href="${esc(go)}" style="color:#F4EDE4">Open the receipt in Season One</a></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },

    "/card/:file": (req: any) => {
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(Number(String(req.params.file).replace(/\.png$/, "")));
      if (!r || !r.rarity || r.item_id === null) return new Response("Not found", { status: 404 });
      let c = cards.get(r.id);
      if (!c || now() - c.at > 300_000) {
        // A render blocks the server for about 10 ms: one address may not render cards in bulk.
        try {
          rateLimit(`card:${ip(req)}`, 300, 600_000, now());
        } catch {
          return new Response("Too many cards. Wait a few minutes.", { status: 429 });
        }
        const v = rollView(db, S(), r);
        const link = `${new URL(origin(req)).host}/i/${v.player.invite}`;
        c = { at: now(), png: new Uint8Array(cardPng({ player: v.player.name, founder: v.player.founder, item: v.item!.name, rarity: r.rarity, link, roll: `${r.kind} #${r.n} · ${fmtDay(r.day)}` })) };
        if (cards.size >= 500) cards.delete(cards.keys().next().value!);
        cards.set(r.id, c);
      }
      return new Response(c.png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });
    },

    "/wallet.js": async () => {
      walletJs ??= Bun.build({ entrypoints: [`${import.meta.dir}/../web/wallet.ts`], minify: true, target: "browser" }).then((b) => b.outputs[0]!.text());
      return new Response(await walletJs, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
    },

    "/api/prize": h((req) => prize(named(req))),
    "/api/prize/confirm": {
      POST: h(async (req) => {
        const id = named(req);
        const b = await body(req);
        await P.confirmPrize(db, S(), id, String(b.country ?? ""), String(b.address ?? ""), String(b.signature ?? ""), now());
        return P.myPrize(db, S(), id);
      }),
    },
    "/api/winners": h(() => {
      const s = P.prizeSeason(db);
      return s ? P.publicWinners(db, s) : null;
    }),

    // Mock chain, test server only.
    "/api/dev/chain": {
      POST: h(async (req) => {
        if (!mock) throw new GameError("Not found.", 404);
        const b = await body(req);
        return { result: chain.rpc(String(b.method), Array.isArray(b.params) ? b.params : [], now()) };
      }),
    },
    "/dev/explorer/:kind/:id": (req: any) => {
      if (!mock) return new Response("Not found", { status: 404 });
      const data = req.params.kind === "tx" ? chain.mockTx(req.params.id) : { address: req.params.id, balanceWei: chain.mockBalance(req.params.id) };
      return new Response(`<!doctype html><meta charset="utf-8"><title>Mock explorer</title><body style="background:#14110F;color:#F4EDE4;font-family:monospace;padding:16px"><h1>Mock chain, test server only</h1><pre>${JSON.stringify(data, null, 2)?.replace(/[<>&]/g, "") ?? "Not found"}</pre></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    },

    // Team page.
    "/api/admin/queue": h((req) => (admin(req), A.queue(db))),
    "/api/admin/review": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.setReview(db, a, Number(b.playerId), String(b.status), String(b.reason ?? ""), now()); return {}; }) },
    "/api/admin/appeals": h((req) => (admin(req), A.appeals(db))),
    "/api/admin/appeal": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.resolveAppeal(db, a, Number(b.id), String(b.status), String(b.answer ?? ""), now()); return {}; }) },
    "/api/admin/correction": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.addCorrection(db, a, S(), Number(b.playerId), Number(b.delta), String(b.reason ?? ""), now()); return {}; }) },
    "/api/admin/metrics": h((req) => (admin(req), A.metrics(db, S(), now()))),
    "/api/admin/winners": h((req) => (admin(req), P.teamView(db, S(), now()))),
    "/api/admin/winner-check": { POST: h(async (req) => { const a = admin(req); const b = await body(req); P.teamCheck(db, a, S(), Number(b.id), String(b.team), String(b.reason ?? ""), now()); return {}; }) },
    "/api/admin/sanctions": { POST: h(async (req) => { const a = admin(req); const b = await body(req); P.sanctionsCheck(db, a, S(), Number(b.id), now()); return {}; }) },
    "/api/admin/rate": { POST: h(async (req) => { const a = admin(req); const b = await body(req); P.setRate(db, a, S(), Number(b.rate), now()); return {}; }) },
    "/api/admin/publish": { POST: h(async (req) => { const a = admin(req); P.publish(db, a, S(), now()); return {}; }) },
    "/api/admin/payout": { POST: h(async (req) => { const a = admin(req); const b = await body(req); P.recordPayout(db, a, S(), Number(b.id), String(b.txHash ?? ""), now()); return {}; }) },
    "/api/admin/dev": {
      POST: h(async (req) => {
        if (!mock) throw new GameError("Not found.", 404);
        const a = admin(req);
        await devAction(db, a, String((await body(req)).action), now());
        return {};
      }),
    },
    "/api/admin/next-season": { POST: h(async (req) => { const a = admin(req); const b = await body(req); P.startNextSeason(db, a, S(), Date.parse(String(b.start ?? "")), now()); return {}; }) },
  };

  return {
    routes,
    attach(s: Server<unknown>) {
      server = s;
    },
  };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const fmtDay = (day: string) => C.fmtDate(Date.parse(`${day}T00:00:00Z`));

if (import.meta.main) {
  const env = process.env;
  if (!env.PORT) throw new Error("PORT is not set. Start the dev server with `paneweb up`.");
  // A real server never guesses its own address or runs without a salt for IP hashes.
  if (env.DEV_LOGIN !== "1" && (!env.PUBLIC_ORIGIN || !env.IP_SALT)) throw new Error("PUBLIC_ORIGIN and IP_SALT must be set.");
  // Without https the session cookie travels in clear text.
  if (env.DEV_LOGIN !== "1" && !env.PUBLIC_ORIGIN!.startsWith("https://")) throw new Error("PUBLIC_ORIGIN must start with https://.");
  if (env.DEV_LOGIN !== "1" && env.ADMIN_TOKENS && env.ADMIN_TOKENS.split(",").some((p) => p.slice(p.indexOf(":") + 1).length < 24)) throw new Error("Each team key in ADMIN_TOKENS needs 24 characters or more.");
  // Test sign-in lets anyone in by name: it never runs next to a real chain or treasury.
  if (env.DEV_LOGIN === "1" && (env.CHAIN_ID || env.TREASURY_ADDRESS || !/dev/.test(env.DB_PATH ?? ""))) {
    throw new Error("DEV_LOGIN=1 runs only on a dev database (DB_PATH with 'dev') and never with CHAIN_ID or TREASURY_ADDRESS.");
  }
  const dbPath = env.DB_PATH ?? "data/game.sqlite";
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const season = initSeason(db, Date.parse(env.SEASON_START ?? "2026-10-06T00:00:00Z"));
  const app = createApp({ db, env });
  const server = Bun.serve({
    port: Number(env.PORT),
    development: env.DEV_LOGIN === "1",
    maxRequestBodySize: 64 * 1024,
    routes: app.routes,
    fetch: () => Response.json({ error: "Not found." }, { status: 404 }),
  });
  app.attach(server);
  const run = () => {
    try {
      db.query("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
      P.seasonTick(db, Date.now());
    } catch (e) {
      console.error("tick failed", e);
    }
  };
  run();
  setInterval(run, 60_000);
  console.log(`Season One on ${server.url} (season ${season.id} from ${dayOf(season.start)}, ${env.DEV_LOGIN === "1" ? "test sign-in on" : "test sign-in off"}${env.MOCK_CHAIN === "1" ? ", mock chain" : ""})`);
}
