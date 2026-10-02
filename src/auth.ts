import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import * as C from "./config";
import { GameError } from "./game";

export const SESSION_MS = 30 * 86_400_000;
const NONCE_MS = 5 * 60_000;

export function createSession(db: Database, playerId: number, now: number) {
  const token = randomBytes(32).toString("hex");
  db.query("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.query("INSERT INTO sessions (token, player_id, expires_at) VALUES (?, ?, ?)").run(token, playerId, now + SESSION_MS);
  return token;
}

export const sessionPlayer = (db: Database, token: string | undefined, now: number) =>
  token
    ? (db.query<{ player_id: number }, [string, number]>("SELECT player_id FROM sessions WHERE token = ? AND expires_at > ?").get(token, now)
        ?.player_id ?? null)
    : null;

export const endSession = (db: Database, token: string) => db.query("DELETE FROM sessions WHERE token = ?").run(token);

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const inviteCode = () => Array.from(randomBytes(8), (b) => INVITE_ALPHABET[b % 32]).join("");

export type NewPlayer = { wallet?: string; email?: string; name?: string; invite?: string };

// First sign-in creates the player. The referrer comes from the invite cookie, never self.
export function findOrCreate(db: Database, who: NewPlayer, now: number): number {
  const found = who.wallet
    ? db.query<{ id: number }, [string]>("SELECT id FROM players WHERE wallet = ?").get(who.wallet)
    : who.email
      ? db.query<{ id: number }, [string]>("SELECT id FROM players WHERE email = ?").get(who.email)
      : // Test sign-in only (DEV_LOGIN=1): the name is the account, even after the test wallet is attached.
        db.query<{ id: number }, [string]>("SELECT id FROM players WHERE name = ?").get(who.name ?? "");
  if (found) return found.id;
  const ref = who.invite
    ? db.query<{ id: number }, [string]>("SELECT id FROM players WHERE invite_code = ?").get(who.invite)?.id ?? null
    : null;
  return db
    .query<{ id: number }, any[]>(
      `INSERT INTO players (name, wallet, email, referrer_id, invite_code, accepted_at, created_at, last_tick, rest_at, last_visit, away_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(who.name ?? null, who.wallet ?? null, who.email ?? null, ref, inviteCode(), now, now, now, now + C.OFFLINE_CAP_SECONDS * 1000, now, now)!.id;
}

export function siweMessage(db: Database, address: string, origin: string, now: number) {
  let addr: `0x${string}`;
  try {
    addr = getAddress(address);
  } catch {
    throw new GameError("That wallet address is not valid.");
  }
  const nonce = generateSiweNonce();
  db.query("DELETE FROM siwe_nonces WHERE expires_at < ?").run(now);
  db.query("INSERT INTO siwe_nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, now + NONCE_MS);
  const url = new URL(origin);
  return createSiweMessage({
    address: addr, chainId: 1, domain: url.host, uri: url.origin, nonce, version: "1",
    statement: "Sign in to Season One. This is free and sends no transaction.",
    issuedAt: new Date(now), expirationTime: new Date(now + NONCE_MS),
  });
}

export async function siweVerify(db: Database, message: string, signature: string, origin: string, now: number) {
  const fields = parseSiweMessage(message);
  const url = new URL(origin);
  const nonceRow = fields.nonce
    ? db.query("DELETE FROM siwe_nonces WHERE nonce = ? AND expires_at > ? RETURNING nonce").get(fields.nonce, now)
    : null;
  if (!nonceRow || !fields.address || fields.uri !== url.origin || fields.chainId !== 1 || !validateSiweMessage({ message: fields, domain: url.host, time: new Date(now) })) {
    throw new GameError("Sign-in expired. Try again.", 401);
  }
  const ok = await verifyMessage({ address: fields.address, message, signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new GameError("Signature does not match the wallet.", 401);
  return getAddress(fields.address);
}

export const ipHash = (salt: string, ip: string) => createHash("sha256").update(salt + ip).digest("hex").slice(0, 32);

export function recordSignal(db: Database, playerId: number, ip: string, device: string, now: number) {
  db.query("INSERT OR IGNORE INTO signals (player_id, ip_hash, device, at) VALUES (?, ?, ?, ?)").run(playerId, ip, device.slice(0, 64) || "none", now);
}

// In-memory sliding window per key. ponytail: per-process, move to the DB if the game runs on several processes.
const hits = new Map<string, number[]>();
const HOUR_MS = 3_600_000; // longest window in use is 10 minutes
export function rateLimit(key: string, max: number, windowMs: number, now: number) {
  if (hits.size > 10_000) for (const [k, list] of hits) if (list.at(-1)! < now - HOUR_MS) hits.delete(k);
  const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length >= max) throw new GameError("Too many tries. Wait a few minutes.", 429);
  list.push(now);
  hits.set(key, list);
}
