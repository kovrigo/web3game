// Season One client. One page, hash routes, no framework.
// Server holds every number; this file only shows them and asks for changes.
import { FOUNDER_DAYS, type Rarity, type Table } from "../src/config";
import { toHex, verifyDay, type CheckRoll, type LocalRecord } from "../src/fair";
import { amountAfterGas, formatEth, payoutMessage, TRANSFER_GAS } from "../src/payout";

type Item = { id: number; name: string; slot: string; rarity: Rarity };
type Roll = {
  id: number; kind: "daily" | "guaranteed" | "find"; n: number; day: string; seed: string; commit: string; streak: number;
  rarity: Rarity | null; itemId: number | null; item: Item | null; at: number; sealed: boolean;
  player: { name: string; founder: boolean; invite: string };
};
type State = any;
type Season = {
  id: number; phase: string; start: number; end: number; now: number; treasury: string | null; explorer: string | null; fund: number;
  prizes: { points: number[]; invites: number[] }; odds: { find: Table; guaranteed: Table; daily: Table[] }; devLogin: boolean;
  publishedAt: number | null; objectionsUntil: number | null; payBy: number; ethRate: number | null;
  chainId: number | null; mockChain: boolean; exchanges: { name: string; url: string | null }[];
};
type Prize = {
  id: number; board: "points" | "invites"; place: number; prize: number; deadline: number;
  status: "waiting" | "confirmed" | "paid" | "excluded" | "expired" | "moved"; reason: string | null;
  country: string | null; address: string | null; txHash: string | null; eth: number | null;
  wallet: string | null; seasonId: number; playerId: number; name: string;
};

const DAY = 86_400_000;
const $app = document.getElementById("app")!;
const $sheet = document.getElementById("sheet-root")!;
const $announce = document.getElementById("announce")!;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = () => matchMedia("(min-width: 1024px)").matches;

// ---------- helpers

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString("en-US");
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDayShort = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clock = () => Date.now() + skew;
const over = (phase: string) => phase === "ended" || phase === "published" || phase === "paid";
let skew = 0;

function left(ms: number, seconds = false) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (seconds) return `${d ? `${d}d ` : ""}${pad(h)}h ${pad(m)}m ${pad(s % 60)}s`;
  return d ? `${d}d ${pad(h)}h ${pad(m)}m` : `${h}h ${pad(m)}m`;
}
function ago(ms: number) {
  const m = Math.floor((clock() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode: the game works, the browser just keeps no local record */
    }
  },
};
const randHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const device = store.get("device", "") || (() => { const d = randHex(12); store.set("device", d); return d; })();

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
let lastOk = 0;
async function api<T = any>(path: string, data?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  } catch {
    setOffline(true);
    throw new ApiError(`Offline. Showing data from ${lastOk ? new Date(lastOk).toTimeString().slice(0, 5) : "earlier"}.`, 0);
  }
  setOffline(false);
  lastOk = Date.now();
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && ui.session) {
      ui.session = null;
      ui.signedOut = true;
      render();
    }
    throw new ApiError(out.error ?? "Something broke on our side. Try again.", res.status);
  }
  return out as T;
}
let offline = false;
function setOffline(v: boolean) {
  if (v === offline) return;
  offline = v;
  document.body.classList.toggle("offline", v);
  render();
}
const say = (text: string) => {
  $announce.textContent = "";
  setTimeout(() => ($announce.textContent = text), 50);
};

// What the browser saw before any reveal: the day's seal and its own numbers.
const records = () => store.get<Record<string, LocalRecord>>("days", {});
function remember(day: string, commit: string | null, seed: string | null) {
  const all = records();
  const r = all[day] ?? {};
  if (commit) r.commit = commit;
  if (seed) r.seeds = [...new Set([...(r.seeds ?? []), seed])];
  all[day] = r;
  // Keep two weeks.
  for (const k of Object.keys(all).sort().slice(0, -14)) delete all[k];
  store.set("days", all);
}

// ---------- wallet

type Provider = { request(a: { method: string; params?: unknown[] }): Promise<any> };
let mockProvider: Provider | null = null;
// Test server only: a throwaway key kept in this browser, talking to the mock chain. No real funds.
async function mockWallet(): Promise<Provider> {
  if (mockProvider) return mockProvider;
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const key = store.get("mockKey", "") || (() => { const k = generatePrivateKey(); store.set("mockKey", k); return k; })();
  const acct = privateKeyToAccount(key as `0x${string}`);
  mockProvider = {
    async request({ method, params = [] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct.address];
      if (method === "personal_sign") return acct.signMessage({ message: { raw: params[0] as `0x${string}` } });
      return (await api("/api/dev/chain", { method, params })).result;
    },
  };
  return mockProvider;
}
async function wallet(): Promise<Provider> {
  const eth = (window as any).ethereum as Provider | undefined;
  if (eth) return eth;
  if (ui.season?.mockChain) return mockWallet();
  throw new Error("No wallet found. Open this page in a wallet browser or install a wallet extension.");
}
const utf8Hex = (text: string) => `0x${toHex(new TextEncoder().encode(text))}`;
const explorerLink = (kind: "tx" | "address", id: string) => (ui.season?.explorer ? `${ui.season.explorer}/${kind}/${id}` : null);
const usd = (n: number) => `$${num(n)}`;
const eth = (n: number | null) => (n === null ? "" : ` (${n.toFixed(4)} ETH)`);
const boardName = (b: string) => (b === "points" ? "points race" : "invite race");

// ---------- state

const ui = {
  season: null as Season | null,
  session: null as { id: number; name: string | null; needsName: boolean } | null,
  signedOut: false,
  state: null as State | null,
  board: { points: null as any, invites: null as any },
  boardKind: "points" as "points" | "invites",
  feed: null as Roll[] | null,
  shownFeed: [] as Roll[],
  feedQueue: [] as Roll[],
  announcements: [] as { text: string; at: number }[],
  rolls: null as Roll[] | null,
  receipt: null as Roll | null,
  opening: null as { roll: Roll; frames: { rarity: Rarity; label: string }[]; played: boolean } | null,
  checks: {} as Record<number, { ok: boolean; mismatch: boolean; note?: string }>,
  fairResult: null as null | { ok: boolean; checked: number; mismatches: number[]; note?: string },
  error: "" as string,
};

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name = "", arg = ""] = h.split("/");
  return { name: name || (ui.session ? "hero" : "home"), arg };
}
const go = (path: string) => (location.hash = `#/${path}`);

// ---------- season bar

function bar() {
  const s = ui.season;
  const st = ui.state?.season;
  if (!s) return "";
  const now = clock();
  const phase = st?.phase ?? s.phase;
  let rank = "Unranked";
  if (st?.underReview) rank = "Under review";
  else if (st?.rank && st.points > 0) rank = `#${num(st.rank)}`;
  const pts = st ? num(st.points) : "0";
  let time = "", label = "", aria = "";
  if (phase === "upcoming") {
    time = `Starts in ${left(s.start - now)}`;
    aria = `season starts in ${left(s.start - now)}`;
  } else if (over(phase)) {
    time = "Season ended";
    label = "final";
    aria = "season ended";
  } else {
    const fin = phase === "final_day";
    time = `<span class="${fin ? "final" : ""}">${left(s.end - now, fin)}</span>${fin ? `<span class="tag">Final day</span>` : ""}`;
    aria = `season ends in ${left(s.end - now)}`;
  }
  const rankText = label && rank.startsWith("#") ? `${rank} <span class="tag">${label}</span>` : rank;
  const full = `${rank.startsWith("#") ? `Rank ${rank.slice(1)}` : rank}, ${pts} points, ${aria}. Open season standings.`;
  return `<button class="seasonbar" data-go="season" aria-label="${esc(full)}"><b>${rankText}</b><span class="sep">|</span><span><b>${pts}</b><span class="unit"> pts</span></span><span class="sep">|</span><span>${time}</span></button>`;
}

const TABS = ["hero", "chests", "season", "friends"] as const;
function tabs(cls: string) {
  const cur = route().name;
  return `<nav class="${cls}" role="tablist" aria-label="Game">${TABS.map(
    (t) => `<button class="tab" role="tab" data-go="${t}" aria-selected="${cur === t}" tabindex="${cur === t ? 0 : -1}"><i></i>${cap(t)}</button>`,
  ).join("")}</nav>`;
}

// ---------- shared bits

const itemFrame = (r: Rarity | null, label: string, cls = "") => `<div class="frame ${r ? `f-${r}` : "f-empty"} ${cls}" aria-hidden="true">${esc(label)}</div>`;
const founderChip = (on: boolean) => (on ? `<span class="chip chip-founder">Founder</span>` : "");
const alertBox = (kind: "error" | "warning" | "ok" | "info", strong: string, text = "") =>
  `<div class="alert ${kind}" role="${kind === "error" ? "alert" : "status"}"><span class="ico" aria-hidden="true">${kind === "ok" ? "✓" : "!"}</span><p><b>${esc(strong)}</b> ${esc(text)}</p></div>`;

function feedRows(list: Roll[] | null, count: number, enterId?: number) {
  if (!list) return Array.from({ length: Math.min(count, 3) }, () => `<div class="feed-row" aria-hidden="true"><span class="skel" style="width:70%"></span><span class="skel" style="width:28px"></span></div>`).join("");
  if (!list.length) return `<div class="empty"><b>No rare drops yet this season.</b><p class="small">The first one shows here the moment it lands.</p></div>`;
  return list
    .slice(0, count)
    .map(
      (r) => `<button class="feed-row${r.id === enterId && !reduced() ? " enter" : ""}" data-receipt="${r.id}">
        <span><b class="fname">${esc(r.player.name)}</b> ${founderChip(r.player.founder)} found <b class="r-${r.rarity}">${esc(r.item?.name)}</b> <span class="muted">(${cap(r.rarity!)})</span></span>
        <span class="age mono">${ago(r.at)} <span aria-hidden="true">›</span></span></button>`,
    )
    .join("");
}
const feedSection = (count: number, seeAll: boolean) => `
  <div class="head"><h2 class="title">Live drops</h2>${seeAll ? `<a class="ghost" href="#/season">See all</a>` : `<span class="label">Live</span>`}</div>
  <div data-feed="${count}">${feedRows(ui.shownFeed.length || ui.feed ? ui.shownFeed : null, count)}</div>`;

function boardRows(kind: "points" | "invites", limit: number, pinMe: boolean) {
  const b = ui.board[kind];
  if (!b) return Array.from({ length: 3 }, () => `<div class="lb-row" aria-hidden="true"><span class="skel" style="width:20px"></span><span class="skel" style="width:60%"></span><span class="skel" style="width:56px"></span></div>`).join("");
  const phase = ui.state?.season.phase ?? ui.season?.phase;
  if (phase === "upcoming") return `<div class="empty"><b>The season starts ${fmtDayShort(ui.season!.start)}, 00:00 UTC.</b><p class="small">The table fills from the first wave.</p></div>`;
  if (!b.rows.length) return `<div class="empty"><b>No one on the table yet.</b><p class="small">${kind === "invites" ? "A friend counts after 3 days of play." : "Points arrive with the first waves."}</p></div>`;
  const val = (r: any) => (kind === "points" ? `${num(r.points)}` : `${num(r.invites)}`);
  const rows = b.rows.slice(0, limit);
  let html = "";
  rows.forEach((r: any, i: number) => {
    html += `<div class="lb-row${r.me ? " lb-me" : ""}"><span class="lb-rank mono">${r.rank}</span><span class="lb-name"><span class="n">${esc(r.name)}</span>${founderChip(r.founder)}</span><span class="lb-pts mono">${val(r)}</span></div>`;
    if (i + 1 === b.places && rows.length > b.places) html += `<div class="prize-line">Prize line</div>`;
  });
  if (pinMe && b.me && !rows.some((r: any) => r.me)) {
    const unit = kind === "points" ? "pts" : "friends";
    html += `<div class="lb-pin"><div class="lb-row lb-me"><span class="lb-rank mono">${b.me.rank}</span><span class="lb-name"><span class="n">${esc(b.me.name)}<span class="lb-gap">${b.me.gap ? `${num(b.me.gap)} ${unit} to prize line` : ""}</span></span>${founderChip(b.me.founder)}</span><span class="lb-pts mono">${val(b.me)}</span></div></div>`;
  }
  return html;
}

// ---------- screens: before sign-in

function home() {
  const s = ui.season;
  const until = s ? (s.phase === "upcoming" ? `Starts in` : over(s.phase) ? "Season One" : "Season ends in") : "";
  const t = s ? (s.phase === "upcoming" ? left(s.start - clock()) : over(s.phase) ? "Ended" : left(s.end - clock())) : "";
  const treasury = s?.treasury
    ? s.explorer
      ? `<a href="${esc(`${s.explorer}/address/${s.treasury}`)}" target="_blank" rel="noopener">public 2-of-3 treasury</a>`
      : "public 2-of-3 treasury"
    : "public 2-of-3 treasury";
  return `<main class="landing">
    <div class="land-top">
      <div>
        <h1 class="land-name">Season One</h1>
        <p class="land-line">A 4-week points race. Free daily chests. Prizes in ETH on Robinhood Chain.</p>
        <p class="land-proof">Prize fund <span class="mono" style="color:var(--text)">$${num(s?.fund ?? 5000)}</span> held in a ${treasury}</p>
      </div>
      <div class="land-cta">
        <p class="label">${until}</p>
        <p class="clock" data-clock="landing">${t}</p>
        <button class="btn btn-primary" data-act="signin">Start playing</button>
      </div>
    </div>
    ${ui.signedOut ? alertBox("warning", "Signed out.", "Sign in to continue.") : ""}
    <div class="land-grid">
      <section class="panel"><div class="head"><h2 class="title">Leaderboard</h2><span class="label">${ui.board.points ? `${num(ui.board.points.total)} players` : ""}</span></div>${boardRows("points", 3, false)}</section>
      <section class="panel">${feedSection(3, false)}</section>
    </div>
    <p class="land-links small"><a href="#/rules">Season rules</a><a href="#/odds">Odds</a><a href="#/fair">How we can't rig it</a><span>18+</span></p>
  </main>`;
}

function signInSheet() {
  const dev = ui.season?.devLogin;
  openSheet(`
    <div class="sheet-head"><h2 class="title">Start playing</h2><button class="close" data-act="close" aria-label="Close">×</button></div>
    <label class="check"><input type="checkbox" id="accept"><span>I am 18 or older and accept the <a href="#/rules" data-act="close">season rules</a></span></label>
    <button class="btn btn-primary" data-act="email" disabled>Continue with email</button>
    <button class="btn btn-secondary" data-act="wallet" disabled>Connect wallet</button>
    <p class="small">Signing in with a wallet is one free signature. No transaction, no gas.</p>
    <div id="signin-error"></div>
    ${dev ? `<div class="section stack"><p class="label">Test server only</p>
      <label class="field"><span>Test name</span><input class="input" id="dev-name" autocomplete="off" maxlength="20" placeholder="3 to 20 characters"></label>
      <button class="btn btn-secondary" data-act="dev" disabled>Test sign-in</button></div>` : ""}
  `);
  const accept = document.getElementById("accept") as HTMLInputElement;
  accept.addEventListener("change", () => $sheet.querySelectorAll<HTMLButtonElement>("[data-act=email],[data-act=wallet],[data-act=dev]").forEach((b) => (b.disabled = !accept.checked)));
}

function nameScreen(err = "") {
  return `<main class="read">
    <h1>Pick your name</h1>
    <p>Other players see it in the table and the live feed. Your wallet address is never shown.</p>
    <form class="stack" data-form="name">
      <label class="field"><span>Name in the game</span><input class="input" name="name" required minlength="3" maxlength="20" autocomplete="nickname" autofocus></label>
      <p class="small">3 to 20 characters: letters, digits, dot, dash or underscore.</p>
      ${err ? `<p class="field-error" role="alert">${esc(err)}</p>` : ""}
      <button class="btn btn-primary" data-mut>Start</button>
    </form>
  </main>`;
}

// ---------- screens: game tabs

function heroTab() {
  const s = ui.state;
  if (!s) return skeletonPanel();
  const r = s.review;
  const review = r.status === "review"
    ? `${alertBox("warning", "Account under review. Not shown in tables.", r.reason ?? "")}
       ${r.appeal?.status === "open" ? alertBox("info", "Appeal sent.", "Answer within 3 business days.")
        : r.appeal?.status === "rejected" ? alertBox("error", "Appeal not accepted.", r.appeal.answer ?? "")
        : `<button class="btn btn-secondary" data-act="dispute" data-mut>Dispute</button>`}`
    : r.appeal?.status === "accepted" ? alertBox("ok", "Appeal accepted.", "Your account is back in the tables with all points.") : "";
  const prize = prizeBanner(s.prize as Prize | null);
  const first = s.hero.wave === 0;
  const phase = s.season.phase;
  const away = first
    ? `<p class="away-wave mono">Wave 0</p><p>${phase === "upcoming" ? `Your hero starts fighting when the season opens, ${fmtDayShort(s.season.start)} 00:00 UTC.` : over(phase) ? "The season is over. Your hero rests until the next one." : "Your hero is fighting now. Come back later for loot."}</p>`
    : `<p class="label">Wave</p><p class="away-wave mono">${num(s.hero.wave)}</p>
       <div class="away-line"><p>Your hero cleared <span class="mono">${num(s.away.waves)}</span> waves while you were away</p><span class="gain">+${num(s.away.points)}</span></div>
       ${s.hero.resting ? `<p class="small">Your hero rests 8 hours after your last visit. Visiting wakes them up.</p>` : ""}
       ${s.away.finds.length ? `<div class="section">${s.away.finds.map((f: Roll) => `<button class="list-row" data-receipt="${f.id}"><span class="trunc">Wave ${num(f.n)}: <b class="r-${f.rarity}">${esc(f.item?.name)}</b> <span class="muted">(${cap(f.rarity!)})</span></span><span aria-hidden="true">›</span></button>`).join("")}</div>` : ""}`;
  const st = Math.min(7, s.streak.value);
  const g = s.guarantee;
  const dailyBtn = phase === "upcoming" ? `<button class="btn" disabled>Opens when the season starts</button>`
    : over(phase) ? `<button class="btn" disabled>Season ended</button>`
    : !s.today.commit ? `<button class="btn" disabled>Chests open after today's seal is published.</button>`
    : s.chests.dailyOpen ? `<button class="btn" disabled>Next chest in <span class="mono" data-clock="next">${left(s.chests.nextDailyAt - clock())}</span></button>`
    : `<button class="btn btn-primary" data-act="open" data-kind="daily" data-mut>Open daily chest</button>`;
  const near = (() => {
    const b = ui.board.points;
    if (!b?.me || s.season.underReview) return "";
    const above = b.me.rank > 1 ? b.rows.find((x: any) => x.rank === b.me.rank - 1) : null;
    return `<section class="section phone-only"><div class="head"><h2 class="title">Near you</h2><span class="label">Season</span></div>
      ${above ? `<div class="lb-row"><span class="lb-rank mono">${above.rank}</span><span class="lb-name"><span class="n">${esc(above.name)}</span>${founderChip(above.founder)}</span><span class="lb-pts mono">${num(above.points)}</span></div>` : ""}
      <div class="lb-row lb-me"><span class="lb-rank mono">${b.me.rank}</span><span class="lb-name"><span class="n">${esc(b.me.name)}</span>${founderChip(b.me.founder)}</span><span class="lb-pts mono">${num(b.me.points)}</span></div></section>`;
  })();
  return `${review}${prize}
    <section class="panel" aria-label="While you were away">${away}</section>
    ${s.chests.waiting.length ? alertBox("ok", "A rare chest is waiting.", "Open it on the Chests tab.") : ""}
    <section class="section">
      <div class="head"><h2 class="title">Daily chest</h2><span class="label">Streak <span class="mono" style="color:var(--text)">${st} / 7</span></span></div>
      <div class="streak" role="img" aria-label="Streak ${st} of 7 days">${Array.from({ length: 7 }, (_, i) => `<span class="${i < st ? "on" : ""}"></span>`).join("")}</div>
      <div class="meter"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.need}" aria-valuenow="${g.days}" aria-label="Rare chest guarantee"><i style="width:${(g.days / g.need) * 100}%"></i></div><span class="mono">${g.days} / ${g.need} days</span></div>
      <p class="small" style="margin:6px 0 12px">A rare chest or better arrives within 3 days.</p>
      ${dailyBtn}
    </section>
    <section class="section phone-only">${feedSection(2, true)}</section>
    ${near}
    <section class="section"><div class="head"><h2 class="title">Gear</h2><span class="label">Power <span class="mono" style="color:var(--text)">${s.hero.power}</span></span></div>
      <div class="gear">${s.hero.gear.map((g: any) => `<button class="slot" data-act="slot" data-slot="${g.slot}" aria-label="${cap(g.slot)}: ${g.item ? `${esc(g.item.name)}, ${g.item.rarity}` : "empty"}">${itemFrame(g.item?.rarity ?? null, g.item ? g.item.rarity : "Empty")}<span class="trunc">${g.item ? esc(g.item.name) : cap(g.slot)}</span></button>`).join("")}</div>
      <p class="small" style="margin-top:8px">Each wave gives 10 pts plus your gear power. Better gear goes on by itself.</p>
    </section>
    <section class="section"><div class="head"><h2 class="title">Account</h2></div>
      <div class="list-row"><span class="trunc">${esc(s.player.name)} ${founderChip(s.player.founder)}</span><span></span></div>
      <label class="check"><input type="checkbox" data-act="hidden" ${s.player.hidden ? "checked" : ""} data-mut><span>Hide my name in the live feed and on share cards</span></label>
      <p class="land-links small"><a href="#/rules">Season rules</a><a href="#/odds">Odds</a><a href="#/fair">How we can't rig it</a><button class="ghost" data-act="logout">Sign out</button></p>
    </section>`;
}

function chestsTab() {
  const s = ui.state;
  if (!s) return skeletonPanel();
  const live = s.season.phase === "live" || s.season.phase === "final_day";
  const waiting: string[] = [];
  if (live && !s.chests.dailyOpen && s.today.commit) waiting.push(`<div class="list-row"><span><b>Daily chest</b><br><span class="small">Streak day ${Math.min(7, s.streak.value + 1)}</span></span><button class="btn btn-primary" style="width:auto" data-act="open" data-kind="daily" data-mut>Open</button></div>`);
  for (const _ of s.chests.waiting) waiting.push(`<div class="list-row"><span><b>Rare chest</b><br><span class="small">Guarantee: rare or better</span></span><button class="btn btn-primary" style="width:auto" data-act="open" data-kind="guaranteed" data-mut>Open</button></div>`);
  const rolls = ui.rolls;
  return `<section class="panel">
      <div class="head"><h2 class="title">Chests</h2><a class="ghost" href="#/odds">Odds</a></div>
      ${waiting.length ? waiting.join("") : `<div class="empty"><b>No chests waiting.</b><p class="small">Next daily chest in <span class="mono" data-clock="next">${left(s.chests.nextDailyAt - clock())}</span>.</p></div>`}
    </section>
    <section class="section"><div class="head"><h2 class="title">Your rolls</h2><a class="ghost" href="#/fair">Check a day</a></div>
      ${rolls === null ? `<div class="lb-row"><span class="skel" style="width:60%"></span></div>`
        : rolls.length ? rolls.map((r) => `<button class="list-row" data-receipt="${r.id}"><span class="trunc">${kindName(r)} <span class="mono muted">#${r.n}</span> · <b class="r-${r.rarity}">${esc(r.item?.name)}</b></span><span class="s mono">${r.sealed ? "Sealed" : fmtDayShort(Date.parse(r.day))}</span></button>`).join("")
        : `<div class="empty"><b>No rolls yet.</b><p class="small">Your first daily chest is one tap away.</p></div>`}
    </section>`;
}
const kindName = (r: Roll) => (r.kind === "daily" ? "Daily chest" : r.kind === "guaranteed" ? "Rare chest" : `Wave ${num(r.n)} find`);

function seasonTab() {
  const s = ui.state;
  const k = ui.boardKind;
  const sz = ui.season;
  const phase = s?.season.phase ?? sz?.phase;
  const ended = phase === "ended" ? alertBox("info", "Season ended.", `Checking winners until ${fmtDayShort((sz?.end ?? 0) + 7 * DAY)}.`)
    : phase === "published" ? `${alertBox("info", "Winners published.", `Objections until ${fmtDayShort(sz!.objectionsUntil!)}.`)}<a class="btn btn-secondary" href="#/winners">See winners</a>`
    : phase === "paid" ? `${alertBox("ok", "Prizes paid.", "Every winner has a transaction link.")}<a class="btn btn-secondary" href="#/winners">See winners</a>`
    : (sz?.id ?? 1) > 1 ? `<a class="btn btn-secondary" href="#/winners">Last season's winners</a>`
    : "";
  return `${ended}
    <div class="row-actions" role="group" aria-label="Table">
      <button class="btn ${k === "points" ? "btn-primary" : "btn-secondary"}" data-act="board" data-kind="points" aria-pressed="${k === "points"}">Points</button>
      <button class="btn ${k === "invites" ? "btn-primary" : "btn-secondary"}" data-act="board" data-kind="invites" aria-pressed="${k === "invites"}">Invites</button>
    </div>
    <p class="small">70% points race · 30% invite race · about 30 prizes · <a href="#/prizes">Prizes</a></p>
    <section class="panel"><div class="head"><h2 class="title">${k === "points" ? "Points race" : "Invite race"}</h2><span class="label">${ui.board[k] ? `${num(ui.board[k].total)} ${k === "points" ? "players" : "inviters"}` : ""}</span></div>
      ${boardRows(k, 50, true)}
    </section>
    <section class="section ${desktop() ? "phone-only" : ""}">${feedSection(10, false)}</section>
    <section class="section"><div class="head"><h2 class="title">Season notes</h2></div>
      ${ui.announcements.length ? ui.announcements.map((a) => `<div class="list-row"><span>${esc(a.text)}</span><span class="s">${fmtDayShort(a.at)}</span></div>`).join("") : `<p class="small">No score corrections this season.</p>`}
      <p class="land-links small" style="margin-top:8px"><a href="#/rules">Season rules</a>${sz?.treasury && sz.explorer ? `<a href="${esc(`${sz.explorer}/address/${sz.treasury}`)}" target="_blank" rel="noopener">Treasury address</a>` : ""}</p>
    </section>`;
}

function friendsTab() {
  const s = ui.state;
  if (!s) return skeletonPanel();
  const f = s.friends;
  const link = `${location.origin}/i/${f.code}`;
  const inv = f.invites;
  return `<section class="panel">
      <div class="head"><h2 class="title">Invite friends</h2><span class="label">+10%</span></div>
      <label class="field"><span>Invite link</span>
        <button class="input mono" style="text-align:left;color:var(--muted)" data-act="copy" data-text="${esc(link)}" aria-label="Copy invite link ${esc(link)}">${esc(link.replace(/^https?:\/\//, ""))}</button></label>
      <button class="btn btn-primary" style="margin-top:12px" data-act="copy" data-text="${esc(link)}" data-copy-label="Copy invite link">Copy invite link</button>
      <p class="small" style="margin-top:12px">+10% of their points, up to ${num(f.cap)} per season. A friend counts after 3 days of play.</p>
    </section>
    <section class="section"><div class="head"><h2 class="title">Your friends</h2><span class="label"><span class="mono" style="color:var(--text)">${f.counted}</span> counted</span></div>
      ${f.list.length ? f.list.map((x: any) => `<div class="list-row"><span class="trunc"><b>${esc(x.name)}</b></span><span class="s ${x.counted ? "ok" : ""}">${x.counted ? "Counted" : `${x.days} / 3 days`}</span></div>`).join("")
        : `<div class="empty"><b>No friends yet.</b><p class="small">A friend counts after 3 days of play.</p></div>`}
      ${f.refPoints ? `<p class="small" style="margin-top:8px">From friends: <span class="mono">${num(f.refPoints)}</span> pts</p>` : ""}
    </section>
    <section class="section"><div class="head"><h2 class="title">Invite race</h2><span class="label">30% of prizes</span></div>
      ${inv.rank ? `<p><span class="clock">#${num(inv.rank)}</span> <span class="small">of <span class="mono">${num(inv.total)}</span> inviters</span></p>${inv.gap ? `<p class="small">${num(inv.gap)} more counted friends to the prize line.</p>` : ""}` : `<p class="small">Not in the race yet. Your first counted friend puts you on the table.</p>`}
      <a class="ghost" href="#/season" data-act="board-invites">Full table</a>
    </section>
    <section class="section"><div class="head"><h2 class="title">Founder badge</h2>${founderChip(s.player.founder)}</div>
      ${s.player.founder ? `<p class="small">You have the Founder badge. It shows next to your name in the table, the live feed and on share cards.</p>`
        : `<div class="meter"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${FOUNDER_DAYS}" aria-valuenow="${s.player.founderDays}" aria-label="Founder badge"><i style="width:${(s.player.founderDays / FOUNDER_DAYS) * 100}%"></i></div><span class="mono">Founder: ${s.player.founderDays} / 3 active days</span></div>
           <p class="small" style="margin-top:6px">${over(s.season.phase) ? "The Founder badge was given during Season One only." : `Play ${3 - s.player.founderDays} more day${3 - s.player.founderDays === 1 ? "" : "s"} this season to get the Founder badge.`}</p>`}
    </section>`;
}

const skeletonPanel = () => `<section class="panel" aria-busy="true"><span class="skel" style="width:40%;height:28px;margin-bottom:12px"></span><span class="skel" style="width:80%"></span></section>`;

// ---------- chest opening and receipts

function receiptHtml(r: Roll, opts: { stamp?: boolean; enter?: boolean } = {}) {
  const check = ui.checks[r.id];
  const date = fmtDay(r.at);
  return `<article class="receipt${opts.enter && !reduced() ? " enter" : ""}" aria-label="Receipt">
    ${check?.ok ? `<span class="stamp${opts.stamp && !reduced() ? " enter" : ""}">Verified</span>` : ""}
    <div class="rc-top">
      ${itemFrame(r.rarity, "Item art")}
      <div><p class="rc-rarity i-${r.rarity}">${cap(r.rarity ?? "none")}</p><p class="rc-name">${esc(r.item?.name ?? "Nothing this time")}</p></div>
    </div>
    <hr class="rc-rule">
    <div class="rc-lines">
      <div class="rc-line"><span class="k">Roll</span> ${kindName(r).replace(/ find$/, "")} #${r.n} · ${date}</div>
      <div class="rc-line"><span class="k">Server seal</span> ${short(r.commit)}<button class="copy" data-act="copy" data-text="${r.commit}" aria-label="Copy full server seal"></button></div>
      <div class="rc-line"><span class="k">Your number</span> ${short(r.seed)}<button class="copy" data-act="copy" data-text="${r.seed}" aria-label="Copy your full number"></button></div>
    </div>
    <p class="rc-status">${r.sealed ? "Sealed. Checkable after 00:00 UTC" : check?.ok ? "Checked in this browser." : check?.mismatch ? "" : "Seal opened. Ready to check."}</p>
  </article>
  ${check?.mismatch ? alertBox("error", "Mismatch found.", check.note ?? `Roll #${r.id} does not match the opened seal.`) : ""}`;
}

function checkButton(r: Roll) {
  if (r.sealed) return `<button class="ghost block" disabled><span>Check this roll in <span class="mono">${left(Date.parse(r.day) + DAY - clock())}</span></span></button>`;
  if (ui.checks[r.id]?.ok) return "";
  return `<button class="ghost block" data-act="check" data-roll="${r.id}">Check this roll</button>`;
}

function shareButtons(r: Roll) {
  const mine = ui.state && r.player.invite === ui.state.friends.code;
  if (!mine || !r.rarity || !["rare", "epic", "legendary"].includes(r.rarity)) return "";
  return `<div class="row-actions"><button class="btn btn-primary" data-act="share" data-channel="x" data-roll="${r.id}">Share on X</button><button class="btn btn-secondary" data-act="share" data-channel="telegram" data-roll="${r.id}">Share on Telegram</button></div>`;
}

function openingScreen() {
  const o = ui.opening!;
  const r = o.roll;
  const big = r.rarity && ["rare", "epic", "legendary"].includes(r.rarity);
  return `<div class="result-head"><h2 class="headline">${r.kind === "daily" ? "Daily chest" : "Rare chest"}</h2>${r.kind === "daily" ? `<span class="label">Day <span class="mono" style="color:var(--text)">${Math.min(7, r.streak)}</span></span>` : ""}</div>
    <div class="reel" aria-hidden="true" data-act="skip"><div class="reel-line"></div><div class="reel-track" id="reel">${o.frames.map((f) => itemFrame(f.rarity, f.label)).join("")}</div></div>
    <div id="result" ${o.played ? "" : "hidden"}>
      <div class="stack">
        ${big ? shareButtons(r) : ""}
        ${receiptHtml(r, { enter: true })}
        ${checkButton(r)}
        ${big ? "" : `<button class="btn btn-primary" data-act="back-hero">Back to hero</button>`}
        ${big ? `<button class="ghost block" data-act="back-hero">Back to hero</button>` : ""}
      </div>
    </div>`;
}

function receiptScreen() {
  const r = ui.receipt;
  if (!r) return `<main class="read">${skeletonPanel()}</main>`;
  return `<main class="read">
    <a class="ghost back" href="#/${ui.session ? "chests" : "home"}">Back</a>
    <h1>${esc(r.player.name)} ${founderChip(r.player.founder)}</h1>
    <p class="small">${kindName(r)} · ${fmtDay(r.at)}</p>
    ${shareButtons(r)}
    ${receiptHtml(r)}
    ${checkButton(r)}
    ${ui.session ? "" : `<a class="btn btn-primary" href="#/home" data-act="signin">Start playing</a>`}
  </main>`;
}

// Reel frames come from the published odds of this chest. The result sits at a fixed
// index; nothing is placed next to it on purpose.
function buildReel(r: Roll) {
  const table = r.kind === "guaranteed" ? ui.season!.odds.guaranteed : ui.season!.odds.daily[Math.min(7, Math.max(1, r.streak)) - 1]!;
  const draw = () => {
    let x = (crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32) * 10_000;
    for (const [rar, w] of table) if ((x -= w) < 0) return rar as Rarity;
    return table[0]![0] as Rarity;
  };
  return Array.from({ length: 40 }, (_, i) => (i === 34 ? { rarity: r.rarity!, label: r.item!.name } : { rarity: draw(), label: "" })).map((f) => ({ ...f, label: f.label || cap(f.rarity) }));
}

function playReel() {
  const track = document.getElementById("reel");
  const result = document.getElementById("result");
  if (!track || !result || !ui.opening) return;
  const done = () => {
    if (!ui.opening || ui.opening.played) return;
    ui.opening.played = true;
    track.classList.remove("go");
    track.style.transform = `translateX(${stop}px)`;
    result.hidden = false;
    const r = ui.opening.roll;
    say(`${cap(r.rarity!)}: ${r.item!.name}`);
  };
  const stop = -(34 * 104 + 48 - track.parentElement!.clientWidth / 2);
  track.style.setProperty("--stop", `${stop}px`);
  if (reduced()) return done();
  track.classList.add("go");
  track.addEventListener("animationend", done, { once: true });
  skipReel = done;
}
let skipReel: (() => void) | null = null;

// ---------- reading screens

function fairScreen() {
  const res = ui.fairResult;
  const days = fairDays;
  return `<main class="read">
    <a class="ghost back" href="#/${ui.session ? "hero" : "home"}">Back</a>
    <h1>How we can't rig it</h1>
    <div class="fair-lines">
      <p>This morning we sealed the day's results in an envelope and showed you the seal.</p>
      <p>You added your own number, so we could not know the outcome in advance.</p>
      <p>Tomorrow the envelope is open, and anyone can check.</p>
    </div>
    ${ui.session ? `<button class="btn btn-primary" data-act="check-yesterday">Check yesterday</button>` : `<button class="btn btn-primary" data-act="signin">Sign in to check your rolls</button>`}
    <div class="check-result" aria-live="polite">${res ? res.note ? alertBox("info", res.note) : res.ok
      ? `<article class="receipt"><span class="stamp${reduced() ? "" : " enter"}">Verified</span><p class="rc-name mono">${res.checked} rolls checked</p><p class="rc-status">Every roll matches the opened seal.</p></article>`
      : alertBox("error", "Mismatch found.", `Rolls ${res.mismatches.map((m) => `#${m}`).join(", ")} do not match.`) : ""}</div>
    <p class="small">The check runs in your browser, not on our server.</p>
    <details><summary>The full scheme</summary>
      <ul>
        <li>Each UTC day has a server secret of 32 random bytes. Its seal is the SHA-256 hash of the secret. The seals of today and tomorrow are public from the start of today.</li>
        <li>Your browser makes your number on your first visit of the day and keeps a copy, with the day's seal.</li>
        <li>Each roll is HMAC-SHA256 with the day's secret as key over <code>your number:kind:n</code>. Daily chests count 1, 2, 3 and on; rare chests count apart; a wave find uses the wave number.</li>
        <li>The first 52 bits give a number from 0 to 1, which picks the rarity from the <a href="#/odds">published odds</a>. The next 32 bits pick the item within that rarity.</li>
        <li>After 00:00 UTC we finish every hero's waves for the day, then open the secret. Your browser checks the seal, your number, that roll numbers have no gaps, and every result.</li>
        <li>Your hero fights for 8 hours after a visit. So every number is set after the seal of any day it is used on, and we cannot pick a secret to fit it.</li>
      </ul>
      ${ui.session ? `<form class="stack" data-form="seed" style="margin-top:12px">
        <label class="field"><span>Set your own number from now on</span><input class="input mono" name="seed" pattern="[0-9a-fA-F]{8,64}" placeholder="8 to 64 characters, 0-9 and a-f" autocomplete="off"></label>
        <button class="btn btn-secondary" data-mut>Use this number</button><div id="seed-msg"></div></form>` : ""}
      <h2>Seals</h2>
      ${days ? `<div class="rc-lines">${days.map((d) => `<div class="rc-line" style="color:var(--text)"><span class="muted">${d.day}</span>&nbsp;${short(d.commit)}<button class="copy dark" data-act="copy" data-text="${d.commit}" aria-label="Copy seal of ${d.day}"></button><span class="small">${d.revealed ? "open" : "sealed"}</span></div>`).join("")}</div>` : ""}
    </details>
  </main>`;
}
let fairDays: { day: string; commit: string; revealed: boolean }[] | null = null;

function oddsScreen() {
  const o = ui.season?.odds;
  const pct = (w: number) => `${(w / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const list = (t: Table) => `<ul>${t.map(([r, w]) => `<li><span class="${r === "none" ? "" : `r-${r}`}">${r === "none" ? "Nothing" : cap(r)}</span>: <span class="mono">${pct(w)}</span></li>`).join("")}</ul>`;
  return `<main class="read">
    <a class="ghost back" href="#/${ui.session ? "chests" : "home"}">Back</a>
    <h1>Odds</h1>
    <p>Every chance in the game is here. Chests are free; you can never pay for a roll.</p>
    ${o ? `<h2>Daily chest</h2><p>Your streak raises rare, epic and legendary by 10% a day, up to day 7. A missed day steps the streak back by one.</p>
      ${[1, 4, 7].map((d) => `<p class="label">Streak day ${d}</p>${list(o.daily[d - 1]!)}`).join("")}
      <h2>Rare chest</h2><p>Comes on your third active day without a rare or better find.</p>${list(o.guaranteed)}
      <h2>Wave find</h2><p>Every 10th wave.</p>${list(o.find)}
      <h2>Items</h2><p>Within a rarity every item has the same chance. Gear power: common 1, uncommon 2, rare 3, epic 4, legendary 5.</p>` : skeletonPanel()}
  </main>`;
}

function prizesScreen() {
  const p = ui.season?.prizes;
  const rows = (list: number[]) => {
    const out: string[] = [];
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] === list[i]) j++;
      out.push(`<li>${i === j ? `${i + 1}${["st", "nd", "rd"][i] ?? "th"}` : `${i + 1}th to ${j + 1}th`}: <span class="mono">$${num(list[i]!)}</span>${i === j ? "" : " each"}</li>`);
      i = j + 1;
    }
    return `<ul>${out.join("")}</ul>`;
  };
  return `<main class="read">
    <a class="ghost back" href="#/season">Back</a>
    <h1>Prizes</h1>
    <p>Prize fund <span class="mono">$5,000</span>. Paid in ETH on Robinhood Chain at the rate of the payout day.</p>
    ${p ? `<h2>Points race, $3,500</h2>${rows(p.points)}<h2>Invite race, $1,500</h2>${rows(p.invites)}` : ""}
    <p>One person, one prize. A player in both races gets the bigger prize; their place in the other race goes to the next player.</p>
  </main>`;
}

function rulesScreen() {
  const s = ui.season;
  return `<main class="read">
    <a class="ghost back" href="#/${ui.session ? "hero" : "home"}">Back</a>
    <h1>Season rules</h1>
    <ul>
      <li>Season One runs 4 weeks${s ? `, from ${fmtDay(s.start)} to ${fmtDay(s.end)}, 00:00 UTC` : ""}. Players must be 18 or older.</li>
      <li>Season points have no money value. They are never exchanged for money or any coin, and no future handout is promised for them. The Founder badge promises nothing either.</li>
      <li>Nothing in the game costs money. Chests are free and their <a href="#/odds">odds</a> are public.</li>
      <li>Points come from waves (10 pts plus gear power each), plus 10% of the points of friends who counted, up to 50,000 pts a season. A friend counts after playing on 3 different days.</li>
      <li>Equal points: the player who joined earlier ranks higher.</li>
      <li>We may correct points when someone used a game bug. Every correction is announced on the Season tab.</li>
      <li>Accounts that look automated are taken off the tables while the team checks them. You see a notice and can dispute it; we answer within 3 business days. An accepted appeal returns every point.</li>
      <li>One person, one prize. Winners are checked by hand for bots, age and country, and payout addresses against sanctions lists.</li>
      <li>After the season: tables freeze; within 7 days the team checks winners while winners confirm country and payout address. A winner who does not confirm within 7 days loses the prize to the next checked player, who has 3 days. Then the list is published with 3 days for objections, and all prizes are paid on one day, no later than 14 days after the end.</li>
      <li>Prizes are set in dollars and paid in ETH from a public 2-of-3 treasury at the rate of the payout day.</li>
      <li>The game is not available in some countries. The list comes from our legal review.</li>
    </ul>
  </main>`;
}

// ---------- sheets

function openSheet(html: string) {
  const prev = document.activeElement as HTMLElement | null;
  $sheet.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const first = $sheet.querySelector<HTMLElement>("input, button:not([disabled]), a");
  first?.focus();
  sheetReturn = prev;
}
let sheetReturn: HTMLElement | null = null;
function closeSheet() {
  $sheet.innerHTML = "";
  sheetReturn?.focus?.();
}

function slotSheet(slot: string) {
  const g = ui.state?.hero.gear.find((x: any) => x.slot === slot);
  if (!g) return;
  openSheet(`<div class="sheet-head"><h2 class="title">${cap(slot)}</h2><button class="close" data-act="close" aria-label="Close">×</button></div>
    ${g.item ? `<div class="rc-top" style="grid-template-columns:96px 1fr">${itemFrame(g.item.rarity, g.item.rarity)}<div><p class="label r-${g.item.rarity}">${cap(g.item.rarity)}</p><p class="title">${esc(g.item.name)}</p><p class="small">Power ${({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 } as Record<string, number>)[g.item.rarity]}</p></div></div>
      <a class="ghost" href="#/receipt/${g.rollId}" data-act="close">See its receipt</a>
      <p class="small">A better item for this slot goes on by itself. Upgrades come in a later season.</p>`
    : `<div class="empty"><b>Nothing here yet.</b><p class="small">Chests and wave finds fill this slot.</p></div>`}`);
}

function disputeSheet(err = "", kind: "appeal" | "objection" = "appeal") {
  openSheet(`<div class="sheet-head"><h2 class="title">${kind === "appeal" ? "Dispute" : "Object to the list"}</h2><button class="close" data-act="close" aria-label="Close">×</button></div>
    <form class="stack" data-form="appeal" data-kind="${kind}">
      <label class="field"><span>Email for our answer</span><input class="input" name="email" type="email" required autocomplete="email"></label>
      <label class="field"><span>What should we know?</span><textarea class="input" name="text" required minlength="10" maxlength="2000"></textarea></label>
      ${err ? `<p class="field-error" role="alert">${esc(err)}</p>` : ""}
      <button class="btn btn-primary" data-mut>${kind === "appeal" ? "Send appeal" : "Send objection"}</button>
    </form>`);
}

function prizeBanner(p: Prize | null) {
  if (!p) return "";
  if (p.status === "excluded") return alertBox("error", "Not on the winners list.", p.reason ?? "");
  if (p.status === "expired") return alertBox("warning", "Your prize passed to the next player.", `It was not confirmed by ${fmtDay(p.deadline)}.`);
  if (p.status === "moved") return "";
  if (p.seasonId !== ui.season?.id && p.status !== "paid") return ""; // last season's prize: only a paid one stays, for the transfer
  const line = p.status === "waiting" ? `Confirm your country and payout address by ${fmtDay(p.deadline)}.`
    : p.status === "paid" ? "Paid. You can transfer it now." : "Confirmed. Payout comes on one day for all winners.";
  return `<section class="panel"><div class="head"><h2 class="title">You won a prize</h2><span class="label">${esc(boardName(p.board))} · ${p.place}</span></div>
    <p class="clock">${usd(p.prize)}<span class="small">${eth(p.eth)}</span></p><p class="small" style="margin:6px 0 12px">${esc(line)}</p>
    <a class="btn btn-primary" href="#/prize">Open prize</a></section>`;
}

function prizeScreen() {
  const p = ui.state?.prize as Prize | null;
  const back = `<a class="ghost back" href="#/hero">Back</a>`;
  if (!p) return `<main class="read">${back}<h1>Your prize</h1><p>No prize this season.</p></main>`;
  const head = `${back}<h1>Your prize</h1>
    <p class="clock">${usd(p.prize)}<span class="small">${eth(p.eth)}</span></p>
    <p class="small">${cap(boardName(p.board))}, place ${p.place}. Paid in ETH on Robinhood Chain at the rate of the payout day.</p>`;
  if (p.status === "excluded") return `<main class="read">${head}${alertBox("error", "Not on the winners list.", p.reason ?? "")}${objectButton()}</main>`;
  if (p.status === "expired") return `<main class="read">${head}${alertBox("warning", "Your prize passed to the next player.", `It was not confirmed by ${fmtDay(p.deadline)}.`)}</main>`;
  if (p.status === "waiting") {
    return `<main class="read">${head}
      <p>Confirm by <b>${fmtDay(p.deadline)}, ${new Date(p.deadline).toISOString().slice(11, 16)} UTC</b>. Without it, the prize goes to the next player.</p>
      ${p.wallet ? `<form class="stack" data-form="confirm">
        <label class="field"><span>Country you live in</span><input class="input" name="country" required autocomplete="country-name" maxlength="64"></label>
        <label class="field"><span>Payout address</span><input class="input mono" name="address" required value="${esc(p.wallet)}" autocomplete="off" spellcheck="false"></label>
        <p class="small">It must accept ETH on Robinhood Chain. Your sign-in wallet is filled in; the prize then lands there and you can transfer it.</p>
        <p class="small">Your wallet signs the country and address. It is free and sends no transaction.</p>
        <div id="confirm-msg"></div>
        <button class="btn btn-primary" data-mut>Sign and confirm</button></form>`
      : alertBox("warning", "Sign in with a wallet to confirm.", "Your account has no wallet to sign with. Write to the team through Dispute.")}
    </main>`;
  }
  const tx = p.txHash ? explorerLink("tx", p.txHash) : null;
  return `<main class="read">${head}
    ${p.status === "paid" ? alertBox("ok", "Paid.", "The prize is in your payout address.") : alertBox("ok", "Confirmed.", `Payout on one day for all winners, no later than ${fmtDay(ui.season!.payBy)}.`)}
    <div class="rc-lines"><div class="rc-line"><span class="muted">Country</span>&nbsp;${esc(p.country)}</div>
      <div class="rc-line"><span class="muted">Payout address</span>&nbsp;${esc(short(p.address ?? ""))}<button class="copy dark" data-act="copy" data-text="${esc(p.address)}" aria-label="Copy payout address"></button></div>
      ${p.txHash ? `<div class="rc-line"><span class="muted">Transaction</span>&nbsp;${tx ? `<a href="${esc(tx)}" target="_blank" rel="noopener">${short(p.txHash)}</a>` : short(p.txHash)}</div>` : ""}</div>
    ${p.status === "paid" && p.address && p.wallet && p.address.toLowerCase() === p.wallet.toLowerCase() ? `<button class="btn btn-primary" data-act="transfer" data-mut>Transfer</button>` : ""}
  </main>`;
}

function objectButton() {
  const s = ui.season;
  return s?.objectionsUntil && clock() < s.objectionsUntil && ui.session ? `<button class="btn btn-secondary" data-act="object" data-mut>Object to the list</button>` : "";
}

function winnersScreen() {
  const list = winnersList;
  const s = ui.season;
  const group = (b: "points" | "invites") => {
    const rows = (list ?? []).filter((w) => w.board === b);
    if (!rows.length) return `<p class="small">No winners in the ${boardName(b)}.</p>`;
    return rows.map((w) => {
      const tx = w.txHash ? explorerLink("tx", w.txHash) : null;
      return `<div class="lb-row"><span class="lb-rank mono">${w.place}</span><span class="lb-name"><span class="n">${esc(w.name)}</span></span><span class="lb-pts mono">${usd(w.prize)}${w.txHash ? ` · ${tx ? `<a href="${esc(tx)}" target="_blank" rel="noopener">tx</a>` : "paid"}` : ""}</span></div>`;
    }).join("");
  };
  return `<main class="read">
    <a class="ghost back" href="#/season">Back</a>
    <h1>Winners</h1>
    ${list === null ? `<p>The list is published after the team checks every winner.</p>` : `
      ${s?.objectionsUntil && clock() < s.objectionsUntil ? `<p>Objections until <b>${fmtDay(s.objectionsUntil)}</b>. Every objection is answered before payout.</p>${objectButton()}` : ""}
      <h2>Points race</h2>${group("points")}<h2>Invite race</h2>${group("invites")}
      ${s?.ethRate ? `<p class="small">ETH rate of the payout day: ${usd(s.ethRate)} per ETH.</p>` : ""}`}
  </main>`;
}
let winnersList: { board: string; place: number; prize: number; name: string; txHash: string | null; eth: number | null }[] | null = null;

async function transferSheet() {
  const s = ui.season!;
  const exchanges = s.exchanges.length
    ? `<ul>${s.exchanges.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)}</li>`).join("")}</ul>`
    : `<p class="small">The list of exchanges that take ETH on Robinhood Chain is published here before payouts.</p>`;
  openSheet(`<div class="sheet-head"><h2 class="title">Transfer ETH</h2><button class="close" data-act="close" aria-label="Close">×</button></div>
    <ol class="stack small" style="padding-left:20px">
      <li>On your exchange, open the deposit page for ETH and pick the Robinhood Chain network.</li>
      <li>Copy the deposit address and paste it below. Check the first and last characters.</li>
      <li>Send. Selling ETH for money happens on the exchange, not in the game.</li>
    </ol>
    <p class="label">Exchanges that take ETH on Robinhood Chain</p>${exchanges}
    <form class="stack" data-form="transfer">
      <label class="field"><span>Address to send to</span><input class="input mono" name="to" required autocomplete="off" spellcheck="false" placeholder="0x…"></label>
      <p class="small">It must accept ETH on Robinhood Chain. ETH sent to a wrong network can be lost.</p>
      <div id="transfer-amount" class="rc-lines"><span class="skel" style="width:60%"></span></div>
      <p><b>This transfer cannot be undone.</b> Check the address before you send.</p>
      <div id="transfer-msg" aria-live="polite"></div>
      <button class="btn btn-primary" id="transfer-send" disabled data-mut>Send</button>
    </form>`);
  try {
    const t = await transferQuote();
    document.getElementById("transfer-amount")!.innerHTML = `<div class="rc-line" style="color:var(--text)"><span class="muted">In your wallet</span>&nbsp;${formatEth(t.balance)} ETH</div>
      <div class="rc-line" style="color:var(--text)"><span class="muted">Network fee</span>&nbsp;${formatEth(t.fee, 8)} ETH</div>
      <div class="rc-line" style="color:var(--text)"><span class="muted">You send</span>&nbsp;<b>${formatEth(t.value)} ETH</b></div>`;
    const btn = document.getElementById("transfer-send") as HTMLButtonElement;
    btn.textContent = `Send ${formatEth(t.value)} ETH`;
    btn.disabled = t.value === 0n;
    if (t.value === 0n) document.getElementById("transfer-msg")!.innerHTML = alertBox("warning", "Not enough ETH to pay the network fee.");
  } catch (e: any) {
    document.getElementById("transfer-amount")!.innerHTML = alertBox("error", "Transfer not ready.", e?.message ?? "");
  }
}

// Whole balance minus the exact fee of a plain transfer at a fixed gas price.
async function transferQuote() {
  const w = await wallet();
  const chainId = ui.season!.chainId;
  if (!chainId) throw new Error("Transfers open once the game's network is set.");
  if (Number(await w.request({ method: "eth_chainId" })) !== chainId) throw new Error("Switch your wallet to Robinhood Chain.");
  const [from] = await w.request({ method: "eth_requestAccounts" });
  const balance = BigInt(await w.request({ method: "eth_getBalance", params: [from, "latest"] }));
  const gasPrice = BigInt(await w.request({ method: "eth_gasPrice" }));
  return { w, from: from as string, balance, gasPrice, ...amountAfterGas(balance, gasPrice) };
}

// ---------- render

function render() {
  const r = route();
  const offlineBanner = offline ? alertBox("warning", `Offline. Showing data from ${lastOk ? new Date(lastOk).toTimeString().slice(0, 5) : "earlier"}.`, "Actions wait until you are back online.") : "";
  if (["rules", "odds", "prizes", "fair", "receipt", "prize", "winners"].includes(r.name)) {
    const screen = { rules: rulesScreen, odds: oddsScreen, prizes: prizesScreen, fair: fairScreen, receipt: receiptScreen, prize: prizeScreen, winners: winnersScreen }[r.name as "rules"]!;
    $app.innerHTML = `${ui.session && ui.state ? bar() : ""}${offlineBanner}${ui.error || notice ? `<div class="read" style="padding-bottom:0">${ui.error ? alertBox("error", ui.error) : notice}</div>` : ""}${screen()}`;
    return;
  }
  if (!ui.session) {
    $app.innerHTML = offlineBanner + home();
    return;
  }
  if (ui.session.needsName) {
    $app.innerHTML = nameScreen(ui.error);
    return;
  }
  let body: string;
  if (ui.opening) body = openingScreen();
  else body = ({ hero: heroTab, chests: chestsTab, season: seasonTab, friends: friendsTab } as Record<string, () => string>)[r.name]?.() ?? heroTab();
  const side = desktop()
    ? `<aside class="side">${r.name === "season" ? "" : `<section class="panel"><div class="head"><h2 class="title">Leaderboard</h2><span class="label">${ui.board.points ? `${num(ui.board.points.total)} players` : ""}</span></div>${boardRows("points", 5, true)}</section>`}
       <section class="panel">${feedSection(r.name === "season" ? 10 : 6, false)}</section></aside>`
    : "";
  $app.innerHTML = `<div class="shell">
    <header class="deskhead"><span class="brand">Season One</span>${tabs("desk-tabs")}${bar()}</header>
    <div class="phone-bar">${bar().replace('class="seasonbar"', 'class="seasonbar phone"')}</div>
    <div class="desk-main"><main class="main" id="main">${offlineBanner}${ui.error ? alertBox("error", ui.error) : notice}${body}</main>${side}</div>
    ${tabs("tabbar")}
  </div>`;
  if (ui.opening && !ui.opening.played) requestAnimationFrame(playReel);
  else if (ui.opening) {
    const track = document.getElementById("reel");
    if (track) track.style.transform = `translateX(${-(34 * 104 + 48 - track.parentElement!.clientWidth / 2)}px)`;
  }
}

// ---------- loading

async function loadSeason() {
  ui.season = await api<Season>("/api/season");
  skew = ui.season.now - Date.now();
}
async function loadBoard(kind: "points" | "invites") {
  ui.board[kind] = await api(`/api/leaderboard?board=${kind}`);
}
async function loadFeed() {
  const list = await api<Roll[]>("/api/feed");
  const known = new Set([...ui.shownFeed, ...ui.feedQueue].map((r) => r.id));
  const top = ui.shownFeed[0]?.at ?? 0;
  const fresh = list.filter((r) => !known.has(r.id));
  if (ui.feed === null) ui.shownFeed = list;
  else {
    // A late wave find is older than the top row: it joins in place, without motion.
    ui.feedQueue.push(...fresh.filter((r) => r.at > top).reverse());
    ui.shownFeed = [...ui.shownFeed, ...fresh.filter((r) => r.at <= top)].sort((a, b) => b.at - a.at || b.id - a.id).slice(0, 20);
  }
  ui.feed = list;
}
async function loadState() {
  const today = dayKey(clock());
  const rec = records()[today];
  const candidate = rec?.seeds?.[rec.seeds.length - 1] ?? randHex(16);
  ui.state = await api("/api/visit", { seed: candidate, device });
  remember(ui.state.day, ui.state.today.commit, ui.state.today.seed);
}
async function loadRolls() {
  ui.rolls = await api<Roll[]>("/api/rolls");
}

async function refreshAll() {
  const jobs: Promise<unknown>[] = [loadBoard("points"), loadFeed(), loadSeason()];
  if (ui.session && !ui.session.needsName) jobs.push(loadState().catch(showError), api("/api/announcements").then((a) => (ui.announcements = a)));
  await Promise.allSettled(jobs);
  render();
}

let notice = "";
function showDone(strong: string, text: string) {
  notice = alertBox("ok", strong, text);
  say(strong);
  setTimeout(() => {
    notice = "";
    render();
  }, 6000);
}

function showError(e: unknown) {
  ui.error = e instanceof Error ? e.message : String(e);
  render();
  setTimeout(() => {
    ui.error = "";
    render();
  }, 6000);
}

// One new feed row at most every 5 seconds; the rest wait in the queue.
setInterval(() => {
  const next = ui.feedQueue.shift();
  if (!next) return;
  ui.shownFeed = [next, ...ui.shownFeed].slice(0, 20);
  document.querySelectorAll<HTMLElement>("[data-feed]").forEach((el) => (el.innerHTML = feedRows(ui.shownFeed, Number(el.dataset.feed), next.id)));
}, 5000);
setInterval(() => void Promise.allSettled([loadFeed(), loadBoard(ui.boardKind === "invites" ? "invites" : "points")]).then(() => !ui.opening && !$sheet.innerHTML && !isTyping() && render()), 15_000);
const isTyping = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");

// Countdowns: every minute, every second on the final day.
setInterval(() => {
  const fin = (ui.state?.season.phase ?? ui.season?.phase) === "final_day";
  if (!fin && new Date().getSeconds() !== 0) return;
  document.querySelectorAll(".seasonbar").forEach((b) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = bar();
    const fresh = tmp.firstElementChild!;
    b.innerHTML = fresh.innerHTML;
    b.setAttribute("aria-label", fresh.getAttribute("aria-label")!);
  });
  const s = ui.season;
  document.querySelectorAll<HTMLElement>("[data-clock]").forEach((el) => {
    const k = el.dataset.clock;
    if (k === "next" && ui.state) el.textContent = left(ui.state.chests.nextDailyAt - clock());
    if (k === "landing" && s) el.textContent = s.phase === "upcoming" ? left(s.start - clock()) : left(s.end - clock());
  });
}, 1000);

// ---------- actions

async function signInWallet() {
  const out = document.getElementById("signin-error")!;
  try {
    const eth = await wallet();
    const [address] = await eth.request({ method: "eth_requestAccounts" });
    const { message } = await api("/api/auth/siwe/message", { address });
    const hex = `0x${toHex(new TextEncoder().encode(message))}`;
    const signature = await eth.request({ method: "personal_sign", params: [hex, address] });
    const res = await api("/api/auth/siwe/verify", { message, signature, accept: true, device });
    await afterSignIn(res.player);
  } catch (e: any) {
    out.innerHTML = alertBox("error", "Not signed in.", e?.message ?? "The wallet did not sign.");
  }
}

async function afterSignIn(player: { id: number; name: string | null; needsName: boolean }) {
  ui.session = player;
  ui.signedOut = false;
  closeSheet();
  if (!player.needsName) {
    await refreshAll();
    go("hero");
  } else render();
}

async function openChest(kind: string) {
  try {
    const res = await api("/api/chest/open", { kind });
    ui.state = res.state;
    ui.opening = { roll: res.roll, frames: buildReel(res.roll), played: false };
    ui.rolls = null;
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    showError(e);
  }
}

async function checkDay(day: string): Promise<{ ok: boolean; checked: number; mismatches: number[]; note?: string }> {
  const d = await api(`/api/fair/check/${day}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return { secret: "", rolls: [] };
    throw e;
  });
  if (!d.secret && !d.rolls.length) return { ok: false, checked: 0, mismatches: [], note: "No rolls on that day." };
  if (!d.secret) return { ok: false, checked: 0, mismatches: [], note: "This day's seal opens a minute after 00:00 UTC." };
  if (!d.rolls.length) return { ok: false, checked: 0, mismatches: [], note: "No rolls on that day." };
  return verifyDay(d.secret, d.rolls as CheckRoll[], records()[day]);
}

async function share(rollId: number, channel: "x" | "telegram") {
  const r = [ui.opening?.roll, ui.receipt].find((x) => x?.id === rollId);
  if (!r) return;
  const url = `${location.origin}/r/${r.id}`;
  const text = `Found ${r.item!.name} (${cap(r.rarity!)}) in Season One. Free daily chest, provably fair.`;
  const href = channel === "x"
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
    : `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  window.open(href, "_blank", "noopener");
  api("/api/share", { rollId, channel }).catch(() => {});
}

async function copy(btn: HTMLElement) {
  const text = btn.dataset.text ?? "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return showError(new Error("Copy did not work. Select the text and copy it by hand."));
  }
  say("Copied");
  if (btn.dataset.copyLabel) {
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = btn.dataset.copyLabel!), 2000);
  }
}

document.addEventListener("click", async (ev) => {
  const t = ev.target as HTMLElement;
  const el = t.closest<HTMLElement>("[data-act],[data-go],[data-receipt]");
  if (!el) return;
  if (el.dataset.go) {
    ev.preventDefault();
    if (ui.opening) ui.opening = null;
    return go(el.dataset.go);
  }
  if (el.dataset.receipt) {
    ev.preventDefault();
    return go(`receipt/${el.dataset.receipt}`);
  }
  const act = el.dataset.act!;
  if (act === "scrim" && t === el) return closeSheet();
  if (act === "close") return closeSheet();
  if (act === "signin") {
    ev.preventDefault();
    return signInSheet();
  }
  if (act === "email") {
    document.getElementById("signin-error")!.innerHTML = alertBox("warning", "Email sign-in is not open yet.", "Use a wallet for now. Email sign-in opens before the season starts.");
    return;
  }
  if (act === "wallet") return signInWallet();
  if (act === "dev") {
    const name = (document.getElementById("dev-name") as HTMLInputElement).value.trim();
    try {
      const mockAddr = ui.season?.mockChain ? (await (await mockWallet()).request({ method: "eth_accounts" }))[0] : undefined;
      const res = await api("/api/auth/dev", { name, accept: true, device, wallet: mockAddr });
      await afterSignIn(res.player);
    } catch (e: any) {
      document.getElementById("signin-error")!.innerHTML = alertBox("error", "Not signed in.", e.message);
    }
    return;
  }
  if (act === "open") return openChest(el.dataset.kind!);
  if (act === "skip") return skipReel?.();
  if (act === "back-hero") {
    ui.opening = null;
    go("hero");
    return render();
  }
  if (act === "share") return share(Number(el.dataset.roll), el.dataset.channel as "x");
  if (act === "copy") return copy(el);
  if (act === "slot") return slotSheet(el.dataset.slot!);
  if (act === "dispute") return disputeSheet();
  if (act === "object") return disputeSheet("", "objection");
  if (act === "transfer") return transferSheet();
  if (act === "board") {
    ui.boardKind = el.dataset.kind as "points";
    if (!ui.board[ui.boardKind]) await loadBoard(ui.boardKind).catch(showError);
    return render();
  }
  if (act === "board-invites") {
    ui.boardKind = "invites";
    await loadBoard("invites").catch(showError);
    return;
  }
  if (act === "logout") {
    await api("/api/auth/logout", {}).catch(() => {});
    ui.session = null;
    ui.state = null;
    go("home");
    return;
  }
  if (act === "check") {
    const id = Number(el.dataset.roll);
    const r = [ui.opening?.roll, ui.receipt].find((x) => x?.id === id)!;
    el.setAttribute("disabled", "");
    try {
      const res = await checkDay(r.day);
      if (res.note) return showError(new Error(res.note));
      const bad = res.mismatches.includes(id);
      ui.checks[id] = { ok: !bad && res.ok, mismatch: bad || !res.ok, note: res.ok ? undefined : `Rolls ${res.mismatches.map((m) => `#${m}`).join(", ")} on ${r.day} do not match.` };
      say(ui.checks[id]!.ok ? "Verified" : "Mismatch found");
      render();
      if (ui.checks[id]!.ok && "vibrate" in navigator && !reduced()) navigator.vibrate(15);
    } catch (e) {
      showError(e);
    }
    return;
  }
  if (act === "check-yesterday") {
    el.setAttribute("disabled", "");
    try {
      ui.fairResult = await checkDay(dayKey(clock() - DAY));
      say(ui.fairResult.note ?? (ui.fairResult.ok ? `Verified, ${ui.fairResult.checked} rolls checked` : "Mismatch found"));
    } catch (e) {
      showError(e);
    }
    return render();
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset.act === "hidden") {
    try {
      await api("/api/settings", { hidden: t.checked });
      ui.state.player.hidden = t.checked;
    } catch (e) {
      t.checked = !t.checked;
      showError(e);
    }
  }
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target as HTMLFormElement;
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(f)) as Record<string, string>;
  if (f.dataset.form === "name") {
    try {
      await api("/api/name", { name: data.name });
      ui.session!.needsName = false;
      ui.error = "";
      await refreshAll();
      go("hero");
    } catch (e: any) {
      ui.error = e.message;
      render();
    }
  }
  if (f.dataset.form === "appeal") {
    try {
      const kind = f.dataset.kind === "objection" ? "objection" : "appeal";
      await api("/api/appeal", { email: data.email, text: data.text, kind });
      closeSheet();
      if (kind === "objection") showDone("Objection sent.", "The team answers before any payout.");
      await loadState();
      render();
    } catch (e: any) {
      disputeSheet(e.message, f.dataset.kind === "objection" ? "objection" : "appeal");
    }
  }
  if (f.dataset.form === "confirm") {
    const msg = document.getElementById("confirm-msg")!;
    const p = ui.state.prize as Prize;
    try {
      const country = data.country!.trim(), address = data.address!.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("That payout address is not valid.");
      const { getAddress } = await import("viem");
      const message = payoutMessage({ seasonId: p.seasonId, playerId: p.playerId, name: p.name, country, address: getAddress(address) });
      const w = await wallet();
      const [from] = await w.request({ method: "eth_requestAccounts" });
      if (from.toLowerCase() !== p.wallet!.toLowerCase()) throw new Error("Switch your wallet to the account you signed in with.");
      const signature = await w.request({ method: "personal_sign", params: [utf8Hex(message), from] });
      ui.state.prize = await api("/api/prize/confirm", { country, address, signature });
      render();
    } catch (e: any) {
      msg.innerHTML = alertBox("error", "Not confirmed.", e?.message ?? "");
    }
  }
  if (f.dataset.form === "transfer") {
    const msg = document.getElementById("transfer-msg")!;
    const btn = document.getElementById("transfer-send") as HTMLButtonElement;
    try {
      const to = data.to!.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("That address is not valid.");
      btn.disabled = true;
      btn.textContent = "Sending…";
      const t = await transferQuote();
      if (t.value === 0n) throw new Error("Not enough ETH to pay the network fee.");
      const hash = await t.w.request({
        method: "eth_sendTransaction",
        params: [{ from: t.from, to, value: `0x${t.value.toString(16)}`, gas: `0x${TRANSFER_GAS.toString(16)}`, gasPrice: `0x${t.gasPrice.toString(16)}` }],
      });
      const link = explorerLink("tx", hash);
      f.innerHTML = `${alertBox("ok", "Sent.", `${formatEth(t.value)} ETH is on its way.`)}${link ? `<a class="btn btn-secondary" href="${esc(link)}" target="_blank" rel="noopener">See transaction</a>` : `<p class="mono small">${esc(hash)}</p>`}`;
      say("Sent");
    } catch (e: any) {
      msg.innerHTML = alertBox("error", "Transfer failed. Your ETH is still here.", e?.message ?? "");
      btn.disabled = false;
      btn.textContent = "Try again";
    }
  }
  if (f.dataset.form === "seed") {
    const msg = document.getElementById("seed-msg")!;
    try {
      const { seed } = await api("/api/seed", { seed: data.seed });
      remember(dayKey(clock()), null, seed);
      msg.innerHTML = alertBox("ok", "Number set.", "It applies to your next rolls.");
    } catch (e: any) {
      msg.innerHTML = alertBox("error", "Number not set.", e.message);
    }
  }
});

// Arrow keys move between tabs.
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && $sheet.innerHTML) return closeSheet();
  const tab = (ev.target as HTMLElement).closest?.(".tab");
  if (!tab || (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft")) return;
  const i = TABS.indexOf(route().name as any);
  const next = TABS[(i + (ev.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
  go(next);
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`.${desktop() ? "desk-tabs" : "tabbar"} [data-go=${next}]`)?.focus());
});

window.addEventListener("hashchange", async () => {
  const r = route();
  closeSheet();
  if (r.name !== "hero" && r.name !== "chests") ui.opening = null;
  if (r.name === "receipt") {
    ui.receipt = null;
    render();
    ui.receipt = await api<Roll>(`/api/roll/${r.arg}`).catch((e) => (showError(e), null));
  }
  if (r.name === "chests" && ui.session) await loadRolls().catch(showError);
  if (r.name === "season" && ui.session) await api("/api/announcements").then((a) => (ui.announcements = a)).catch(() => {});
  if (r.name === "fair") fairDays = await api("/api/fair/days").catch(() => null);
  if (r.name === "winners" || r.name === "prize") await loadSeason().catch(() => {});
  if (r.name === "winners") winnersList = await api("/api/winners").catch(() => null);
  render();
  window.scrollTo(0, 0);
});
matchMedia("(min-width: 1024px)").addEventListener("change", render);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && ui.session && !ui.session.needsName && refreshAll());

// ---------- start

(async () => {
  render();
  try {
    await loadSeason();
    const s = await api("/api/session");
    ui.session = s.player;
  } catch (e) {
    showError(e);
  }
  await refreshAll();
  window.dispatchEvent(new HashChangeEvent("hashchange"));
})();
