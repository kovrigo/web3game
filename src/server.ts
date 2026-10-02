import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import adminPage from "../web/admin.html";
import indexPage from "../web/index.html";
import * as A from "./admin";
import { createSession, endSession, findOrCreate, ipHash, rateLimit, recordSignal, sessionPlayer, siweMessage, siweVerify } from "./auth";
import { cardPng } from "./card";
import * as C from "./config";
import { openDb } from "./db";
import { dayOf, ensureDays, fairDay, GameError, getPlayer, openChest, phaseOf, seasonFromEnv, setSeed, tick, visit, type RollRow, type Season } from "./game";
import { boards, buildState, dropBoardCache, feed, nameError, rollView, standing } from "./social";

type Env = Record<string, string | undefined>;
export type AppOptions = { db: Database; season: Season; env: Env; now?: () => number };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown) => {
  if (e instanceof GameError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: "Something broke on our side. Try again." }, 500);
};
const cookies = (req: Request) =>
  Object.fromEntries((req.headers.get("cookie") ?? "").split(/;\s*/).filter(Boolean).map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  }));
const body = async (req: Request) => {
  try {
    return (await req.json()) as Record<string, any>;
  } catch {
    throw new GameError("Request body must be JSON.");
  }
};

export function createApp({ db, season, env, now = Date.now }: AppOptions) {
  const dev = env.DEV_LOGIN === "1";
  const salt = env.IP_SALT ?? "";
  const origin = (req: Request) => env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
  const sidCookie = (req: Request, token: string, maxAge: number) =>
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin(req).startsWith("https") ? "; Secure" : ""}`;
  let server: Server<unknown> | null = null;
  const ip = (req: Request) =>
    (env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null) ?? server?.requestIP(req)?.address ?? "unknown";

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
      headers: { "content-type": "application/json", "set-cookie": sidCookie(req, token, 30 * 86400) },
    });
  };
  const accepted = (b: Record<string, any>) => {
    if (b.accept !== true) throw new GameError("Confirm you are 18 or older and accept the season rules.");
  };

  const admin = (req: Request) => {
    if (!env.ADMIN_TOKENS) throw new GameError("Not found.", 404);
    const name = A.adminFromToken(env.ADMIN_TOKENS, req.headers.get("authorization"));
    if (!name) throw new GameError("Wrong team key.", 401);
    return name;
  };

  const routes = {
    "/": indexPage,
    "/admin": adminPage,

    "/api/season": h(() => ({
      phase: phaseOf(season, now()), start: season.start, end: season.end, now: now(),
      treasury: env.TREASURY_ADDRESS ?? null, explorer: env.EXPLORER_URL ?? null,
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
        const err = nameError(String(b.name ?? ""));
        if (err) throw new GameError(err);
        return signIn(req, { name: b.name }, String(b.device ?? ""));
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
        const b = await body(req);
        const t = now();
        ensureDays(db, t);
        visit(db, id, t, season, typeof b.seed === "string" ? b.seed : undefined);
        if (typeof b.device === "string") recordSignal(db, id, ipHash(salt, ip(req)), b.device, t);
        return buildState(db, id, t, season);
      }),
    },

    "/api/chest/open": {
      POST: h(async (req) => {
        const id = named(req);
        rateLimit(`open:${id}`, 60, 600_000, now());
        const kind = (await body(req)).kind;
        if (kind !== "daily" && kind !== "guaranteed") throw new GameError("Unknown chest.");
        const t = now();
        const r = openChest(db, id, kind, t, season);
        dropBoardCache();
        return { roll: rollView(db, season, r), state: buildState(db, id, t, season) };
      }),
    },

    "/api/seed": {
      POST: h(async (req) => {
        const id = named(req);
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
      return rows.map((r) => rollView(db, season, r));
    }),

    "/api/roll/:id": h((req) => {
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(Number(req.params.id));
      if (!r) throw new GameError("No such roll.", 404);
      return rollView(db, season, r);
    }),

    "/api/fair/days": h(() =>
      db
        .query<{ day: string; commit_hash: string; revealed_at: number | null }, []>("SELECT day, commit_hash, revealed_at FROM fair_days ORDER BY day DESC LIMIT 8")
        .all()
        .map((d) => ({ day: d.day, commit: d.commit_hash, revealed: !!d.revealed_at })),
    ),

    "/api/fair/check/:day": h((req) => {
      const id = named(req);
      const day = req.params.day;
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
      const list = boards(db, season, t)[board];
      const id = sessionPlayer(db, cookies(req).sid, t);
      const mine = id ? standing(db, season, t, id, board) : null;
      return {
        board, total: list.length, places: C.PRIZES[board].length,
        rows: list.slice(0, 50).map((r, i) => ({ rank: i + 1, name: r.name, founder: r.founder, points: r.points, invites: r.invites, me: r.id === id })),
        me: mine?.row ? { rank: mine.rank, name: mine.row.name, founder: mine.row.founder, points: mine.row.points, invites: mine.row.invites, gap: mine.gap } : null,
      };
    }),

    "/api/feed": h(() => feed(db, season)),

    "/api/announcements": h(() => db.query("SELECT text, at FROM announcements ORDER BY id DESC LIMIT 20").all()),

    "/api/settings": {
      POST: h(async (req) => {
        const id = named(req);
        const b = await body(req);
        db.query("UPDATE players SET hidden = ? WHERE id = ?").run(b.hidden ? 1 : 0, id);
        return { hidden: !!b.hidden };
      }),
    },

    "/api/share": {
      POST: h(async (req) => {
        const id = named(req);
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
        A.submitAppeal(db, id, String(b.email ?? ""), String(b.text ?? ""), now());
        return {};
      }),
    },

    "/i/:code": (req: any) => {
      const to = new URL(req.url).searchParams.get("to");
      const code = String(req.params.code).replace(/[^A-Z0-9]/gi, "").slice(0, 16);
      return new Response(null, {
        status: 302,
        headers: { location: to?.startsWith("/") && !to.startsWith("//") ? to : "/", "set-cookie": `inv=${code}; Path=/; SameSite=Lax; Max-Age=${30 * 86400}` },
      });
    },

    "/r/:id": (req: any) => {
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(Number(req.params.id));
      if (!r || !r.rarity || r.item_id === null) return new Response("Not found", { status: 404 });
      const v = rollView(db, season, r);
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
      const r = db.query<RollRow, [number]>("SELECT * FROM rolls WHERE id = ?").get(parseInt(req.params.file));
      if (!r || !r.rarity || r.item_id === null) return new Response("Not found", { status: 404 });
      const v = rollView(db, season, r);
      const link = `${new URL(origin(req)).host}/i/${v.player.invite}`;
      const png = cardPng({ player: v.player.name, founder: v.player.founder, item: v.item!.name, rarity: r.rarity, link, roll: `${r.kind} #${r.n} · ${fmtDay(r.day)}` });
      return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });
    },

    // Team page.
    "/api/admin/queue": h((req) => (admin(req), A.queue(db))),
    "/api/admin/review": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.setReview(db, a, Number(b.playerId), String(b.status), String(b.reason ?? ""), now()); return {}; }) },
    "/api/admin/appeals": h((req) => (admin(req), A.appeals(db))),
    "/api/admin/appeal": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.resolveAppeal(db, a, Number(b.id), String(b.status), String(b.answer ?? ""), now()); return {}; }) },
    "/api/admin/correction": { POST: h(async (req) => { const a = admin(req); const b = await body(req); A.addCorrection(db, a, Number(b.playerId), Number(b.delta), String(b.reason ?? ""), now()); return {}; }) },
    "/api/admin/metrics": h((req) => (admin(req), A.metrics(db, season, now()))),
  };

  return {
    routes,
    attach(s: Server<unknown>) {
      server = s;
    },
  };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const fmtDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

if (import.meta.main) {
  const env = process.env;
  if (!env.PORT) throw new Error("PORT is not set. Start the dev server with `paneweb up`.");
  const season = seasonFromEnv(env);
  const dbPath = env.DB_PATH ?? "data/game.sqlite";
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const app = createApp({ db, season, env });
  const server = Bun.serve({
    port: Number(env.PORT),
    development: env.DEV_LOGIN === "1",
    routes: app.routes,
    fetch: () => Response.json({ error: "Not found." }, { status: 404 }),
  });
  app.attach(server);
  const run = () => {
    try {
      tick(db, Date.now(), season);
    } catch (e) {
      console.error("tick failed", e);
    }
  };
  run();
  setInterval(run, 60_000);
  console.log(`Season One on ${server.url} (season ${dayOf(season.start)}, ${env.DEV_LOGIN === "1" ? "test sign-in on" : "test sign-in off"})`);
}
