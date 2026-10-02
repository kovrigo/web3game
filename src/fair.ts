// Roll math shared by the server and the player's browser.
//
//   secret (day) ──┐
//   seed (player) ─┼─> HMAC-SHA256(secret, "seed:kind:n") ─> first 52 bits ─> rarity by table
//   kind, n ───────┘                                       └─> next 32 bits ─> item in rarity
//
// The server hashes with node:crypto (sync, inside a DB transaction); the browser
// with WebCrypto. Both call pick(), so the two can never disagree on the rules.
import { tableFor, TOTAL, type Rarity, type RollKind } from "./config";
import { byRarity } from "./items";

export const rollMessage = (seed: string, kind: RollKind, n: number) => `${seed}:${kind}:${n}`;

export function pick(h: Uint8Array, kind: RollKind, streak: number): { rarity: Rarity | null; itemId: number | null } {
  let x = 0;
  for (let i = 0; i < 6; i++) x = x * 256 + h[i]!;
  x = x * 16 + (h[6]! >> 4); // 52 bits
  const target = (x / 2 ** 52) * TOTAL;
  const table = tableFor(kind, streak);
  let acc = 0;
  let rarity = table[table.length - 1]![0];
  for (const [r, w] of table) {
    acc += w;
    if (target < acc) {
      rarity = r;
      break;
    }
  }
  if (rarity === "none") return { rarity: null, itemId: null };
  const u = ((h[7]! << 24) >>> 0) + (h[8]! << 16) + (h[9]! << 8) + h[10]!;
  const list = byRarity(rarity);
  return { rarity, itemId: list[u % list.length]!.id };
}

export const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
export const toHex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

export async function hmacWeb(secretHex: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", fromHex(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

export const sha256Web = async (hex: string) => toHex(await crypto.subtle.digest("SHA-256", fromHex(hex)));

export type CheckRoll = {
  id: number;
  kind: RollKind;
  n: number;
  seed: string;
  commit: string;
  streak: number;
  rarity: Rarity | null;
  itemId: number | null;
};

// What the browser saved for that day before any reveal.
export type LocalRecord = { commit?: string; seeds?: string[] };

export async function verifyDay(secret: string, rolls: CheckRoll[], local: LocalRecord = {}) {
  const commit = await sha256Web(secret);
  const bad = new Set<number>();
  if (local.commit && local.commit !== commit) rolls.forEach((r) => bad.add(r.id));
  // Numbers run without gaps: a hidden roll shows up as a gap.
  for (const [kind, step] of [["daily", 1], ["guaranteed", 1], ["find", 10]] as const) {
    const ns = rolls.filter((r) => r.kind === kind).sort((a, b) => a.n - b.n);
    ns.forEach((r, i) => i > 0 && r.n !== ns[i - 1]!.n + step && bad.add(r.id));
  }
  for (const r of rolls) {
    if (r.commit !== commit) bad.add(r.id);
    if (local.seeds?.length && !local.seeds.includes(r.seed)) bad.add(r.id);
    if (r.kind === "find" && r.n % 10 !== 0) bad.add(r.id);
    const got = pick(await hmacWeb(secret, rollMessage(r.seed, r.kind, r.n)), r.kind, r.streak);
    if (got.rarity !== r.rarity || got.itemId !== r.itemId) bad.add(r.id);
  }
  return { ok: bad.size === 0, checked: rolls.length, mismatches: [...bad].sort((a, b) => a - b) };
}
