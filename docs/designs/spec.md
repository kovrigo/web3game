# Spec: Season One, first version build (milestones 1 to 4)

Source of truth: `docs/designs/plan.md` (the Plan), `docs/designs/web3-game-brief.md` (the Brief, section "Дизайн" wins over the mockup), `docs/designs/stories.md`, `DESIGN.md`. Mockup option C "Scoreboard" is the visual reference, read only, never copied as is.

## Context

Greenfield browser idle game. Server holds all game state. Chain is touched only by prize payouts (team, Safe UI) and winner transfers (player wallet). This spec covers Plan milestones 1 to 4: core loop, competition and growth, protection and metrics, season end. Milestone 5 (Privy email sign-in, country check) waits for the Privy key and the closed-country list.

## Current state

Repo holds docs only (`DESIGN.md`, `CLAUDE.md`, `docs/designs/*`). No code, no `package.json`. Verified 2026-10-02.

## Stack

- Bun runtime only: `bun install`, `bun run`, `bun test`. No npm, no npx.
- Server: `Bun.serve` with `routes`, HTML import for the client bundle. No framework.
- DB: `bun:sqlite`, one file, WAL mode. Path from `DB_PATH` (default `data/game.sqlite`), `:memory:` in tests.
- Client: plain TS module bundled by Bun from `web/index.html`. No framework.
- Dependencies: `viem` (SIWE message parse and signature verify), `@resvg/resvg-js` (share card PNG). Nothing else.
- Dev server only through `paneweb up` (`.paneweb.json` runs `bun run dev`, reads `$PORT`).

## Files

- `package.json`: scripts `dev` (`bun --hot src/server.ts`), `start`, `test`.
- `.paneweb.json`: `{"service":{"cmd":"bun run dev","url_path":"/"}}`.
- `.gitignore`: `node_modules/`, `data/`, `tmp/`.
- `src/config.ts`: every tunable number (wave seconds, offline cap, odds tables, item power, referral share and cap, prize split, season dates from env).
- `src/fair.ts`: isomorphic roll math (WebCrypto only). Imported by server and client.
- `src/items.ts`: item catalog (name, slot, rarity). 4 slots x 5 rarities x 3 names = 60 items.
- `src/db.ts`: schema, open, migrations by `user_version`.
- `src/game.ts`: wave settlement, chests, streak, guarantee meter, gear, state builder.
- `src/social.ts`: leaderboards, feed, referrals, founder badge, names.
- `src/auth.ts`: sessions, SIWE, dev sign-in, rate limit.
- `src/admin.ts`: review queue, review status, appeals, corrections, announcements, metrics.
- `src/card.ts`: share card SVG and PNG.
- `src/server.ts`: routes, cookies, JSON errors.
- `web/index.html`, `web/app.ts`, `web/styles.css`: game and landing.
- `web/admin.html`, `web/admin.ts`: team page.
- `test/*.test.ts`.

## Fairness

- Day key: UTC date `YYYY-MM-DD`. `fair_days(day, secret, commit, revealed_at)`. Secret is 32 random bytes hex; commit is `sha256(secret)` hex. `ensureDays(now)` creates today and tomorrow. A day's secret is served only when `revealed_at` is set. A one-minute timer: after 00:00 UTC it runs `settleAll(dayEnd)` (every player's waves up to the boundary) and then sets `revealed_at` on the finished day. At `season.end` the same timer runs `settleAll(season.end)` once.
- Player seed: append-only `player_seeds(player_id, seed, set_at)`. Client creates one on its first visit of a UTC day (random 16 bytes hex) and stores it with the day's commit in localStorage; the expert form sets one any time. A new seed applies from `set_at` on. A roll uses the seed in effect at its time: latest row with `set_at <= roll time`. Tomorrow's commit exists from the start of today, and waves run at most 8 hours after a visit, so every seed post-dates the commit of any day it is used on.
- Roll message: `${seed}:${kind}:${n}`. Kinds and their counters (no shared counter, so the server cannot burn a chest nonce with a wave roll):
  - `daily`: n = player's daily-chest count, 1, 2, 3, ...
  - `guaranteed`: n = player's guaranteed-chest count.
  - `find`: n = absolute wave number (10, 20, 30, ...).
- `h = HMAC-SHA256(key = secret bytes, msg)`. Server computes it with sync `node:crypto` so a chest open has no `await` inside its transaction; the browser uses WebCrypto. Both feed the same `pick()`. `r = first 52 bits / 2^52`. Rarity: walk cumulative weights of the roll's table in order common, uncommon, rare, epic, legendary (`find` table starts with `none`). Item: `next 32 bits mod count(items of that rarity)`, items of a rarity sorted by id.
- `verifyDay(secret, rolls, local)` returns `{ok, checked, mismatches:[rollId]}`. Mismatch when `sha256(secret)` differs from the roll's commit or the locally saved commit, the roll's seed is not one the browser saved (when it has a record for that day), `n` values of `daily` and `guaranteed` are not consecutive, or recomputed rarity or item differ.
- Odds tables live in `config.ts` and are rendered on the odds page from the same object.

## Game rules (numbers in `config.ts`)

- Waves: one per `WAVE_SECONDS = 60`. Each player has `last_tick` and `rest_at`. Settlement window: `from = max(last_tick, season.start)`, `to = min(now, season.end, rest_at)`. `waves = floor((to - from) / 60s)`, `last_tick = from + waves * 60s` (keeps the partial wave). A visit settles first, then sets `rest_at = now + OFFLINE_CAP_SECONDS` (28800): the hero fights 8 hours after the last visit, then rests. `settleAll` never moves `rest_at`. Points per wave `10 + gearPower` (power at settlement start). Every wave number divisible by 10 rolls `find` with the secret of the UTC day the wave happened and the player seed in effect at the wave time (latest `player_seeds.set_at <= wave time`). A wave whose day has no secret (server was down that whole day) rolls nothing; logged.
- Daily chest: one per UTC day while season is live. Streak: on open day d with previous open day p: `streak = min(7, max(0, streak - (d - p - 1)) + 1)`; first open = 1. Odds: rare, epic, legendary weights times `1 + 0.1 * (streak - 1)`, common reduced by the same total.
- Guarantee meter: `dry_days` counts active days with no rare-or-better result. On the visit that makes it 3, add a waiting `guaranteed` chest and reset to 0. Any rare-or-better roll of any kind resets it to 0.
- Gear: 4 slots (weapon, armor, charm, boots). Power per rarity 1 to 5. New item auto-equips when its power is higher than the equipped one in that slot.
- Active day: first authenticated `POST /api/visit` of a UTC day inserts `active_days(player_id, day)`.
- Referral: invite code (8 chars, base32) per player. `/i/:code` sets cookie `inv` for 30 days. On account creation, `referrer_id` is taken from it, never self. Friend counts at 3 active days and not under review. Referral points = `min(50000, floor(0.1 * sum(counted friends' wave points)))`. Invite race rank by counted friends, ties by earlier sign-up.
- Founder: 3 active days within season 1 dates.
- Season phases from `SEASON_START` (env ISO, default 2026-10-06T00:00Z), end = start + 28 days: `upcoming`, `live`, `final_day` (last 24h), `ended` (7 days), `published` (3 days), `paid` (after). Phases after `ended` are set by the team page in milestone 4; this build computes `upcoming`, `live`, `final_day`, `ended`.
- Total points = wave points + referral points + corrections. Leaderboard excludes players under review. Ties by earlier sign-up (stated in the rules). Cached 10 s.
- Names: `/^[A-Za-z0-9_.-]{3,20}$/`, unique `COLLATE NOCASE`, blocked word list substring check.

## Auth

- Concurrency: every mutating handler runs one `db.transaction(...).immediate()` with no `await` inside. `UNIQUE(player_id, kind, n)` on rolls. Test: two parallel visits credit waves once.
- Session: 32 random bytes, cookie `sid`, HttpOnly, SameSite=Lax, Secure when `https`, 30 days.
- 18+ and rules acceptance: required boolean `accept` on every sign-in call; stored `accepted_at`.
- SIWE: `POST /api/auth/siwe/message {address}` returns the EIP-4361 text with a server nonce (5 min, single use). `POST /api/auth/siwe/verify {message, signature, accept}` checks nonce, domain, URI, chain ID 1, expiry, signature (`viem` `verifyMessage`). Creates the player on first sign-in.
- Dev sign-in: `POST /api/auth/dev {name, accept}` exists only when `DEV_LOGIN=1`; otherwise 404.
- Rate limit: in-memory, per 10 minutes: 20 sign-in calls and 20 wrong team keys per IP; per player 60 chest opens, 120 visits, 20 seed changes, 30 shares. 429 with message. With `TRUST_PROXY=1` the IP is the last `x-forwarded-for` entry.
- Boot checks on a real server (`DEV_LOGIN` unset): `PUBLIC_ORIGIN` and `IP_SALT` set; every team key in `ADMIN_TOKENS` at least 24 characters. `DEV_LOGIN=1` starts only with a `DB_PATH` containing `dev`, never with `CHAIN_ID` or `TREASURY_ADDRESS`. Request bodies: a JSON object, at most 64 KB.
- Sign-in signals: `signals(player_id, ip_hash, device)` where `ip_hash = sha256(IP_SALT + ip)`, device from header `x-device` (client random id in localStorage).

## API (JSON, errors `{error: "<sentence shown to the player>"}`)

- `GET /api/season` public: phase, start, end, now, treasury address and explorer URL, prize list.
- `GET /api/session`: `{player: {id, name, needsName} | null}`.
- `POST /api/name {name}`.
- `POST /api/visit {seed}`: marks active day, stores seed, settles waves, returns `State`.
- `State`: `{now, day, season:{phase,start,end,rank,points,underReview}, player:{name,hidden,founder,activeDays}, away:{waves,points,finds:[Roll]}, hero:{wave,power,gear:[{slot,item:Item|null}]}, chests:{dailyOpen:boolean,nextDailyAt,waiting:[{id,kind}]}, streak:{value}, guarantee:{days,need}, friends:{code,list:[{name,days,counted}],refPoints,cap}, today:{commit,seed}, review:{status,appeal:{status}|null}}`.
- `POST /api/chest/open {kind: "daily" | "guaranteed"}` returns `{roll: Roll, state: State}`. The browser builds the reel frames from the published odds of that chest with `crypto.getRandomValues`, result at a fixed index; nothing is placed next to the result on purpose.
- `Roll`: `{id, kind, n, day, seed, commit, rarity, item, sealed, createdAt, player:{name|"Hidden player", founder}}`.
- `GET /api/rolls?day=YYYY-MM-DD`: own rolls of that day; default newest 50.
- `GET /api/roll/:id` public receipt.
- `GET /api/fair/day/:day` public `{day, commit, secret|null}`; `GET /api/fair/check/:day` own rolls plus secret for in-browser check.
- `POST /api/seed {seed}`: 400 when a roll exists today.
- `GET /api/leaderboard?board=points|invites` top 50, own row with gap to prize line.
- `GET /api/feed`: last 20 rare-or-better rolls of players not under review.
- `POST /api/settings {hidden}`, `POST /api/share {rollId, channel}`, `POST /api/appeal {email, text}`, `GET /api/announcements`, `POST /api/auth/logout`.
- `GET /i/:code`, `GET /r/:id` (share page, og tags), `GET /card/:id.png`.
- Admin, header `authorization: Bearer <token>`. `ADMIN_TOKENS` env is `name:token,name:token`; each action writes `admin_log(admin, action, payload, at)`. 401 on bad token, 404 when `ADMIN_TOKENS` unset: `GET /api/admin/queue`, `POST /api/admin/review {playerId, status, reason}`, `GET /api/admin/appeals`, `POST /api/admin/appeal {id, status, answer}`, `POST /api/admin/correction {playerId, delta, reason}`, `GET /api/admin/metrics`.

## UI

Follow Brief section "Дизайн" item by item and `DESIGN.md` tokens. Key rules: season bar 48 px pinned, tab bar 60 px, one dominant panel per tab, receipt Sealed until reveal, share buttons on rare and up only, live feed label "Live" without dot, rarity always in words, item art as labelled empty frames, reduced motion support, 44 px tap targets.

## Acceptance criteria

- `bun test` (touched files) passes.
- A player signs in (dev or SIWE), picks a name, opens the daily chest once, sees the reel and a Sealed receipt; a second open the same day is refused.
- After a day's reveal, "Check yesterday" reports `N rolls checked` and Verified; a tampered roll in the DB reports its number.
- Leaderboard and feed hide players under review; an accepted appeal brings them back with all points.
- Invite link counts a friend only after 3 active days; referral points stop at the cap.
- Season bar shows rank, points and countdown on every game screen; at 320 px it does not wrap.

## Testing plan

- Unit: `test/fair.test.ts`, `test/game.test.ts`, `test/social.test.ts`.
- API: `test/api.test.ts` against `Bun.serve` on port 0 with `:memory:` DB and `DEV_LOGIN=1`.
- Visual: screenshots through `paneweb` at 390, 320, 1280 px.
- Test data: `bun run seed:dev` fills `data/dev.sqlite` with 12 players who played today. Refuses without `DEV_LOGIN=1`.

## Rollback

New app, no users. Rollback is not deploying. DB schema versioned with `user_version`.

## Milestone 4: season end

- Schema version 2: `seasons` (dates, `snapshot_at`, `published_at`, `paid_at`, `eth_rate`), `snapshots`, `winners`, `outbox`; `corrections.season_id`, `appeals.kind` (appeal | objection). `initSeason` inserts season 1 from `SEASON_START` once; the server reads the current season per request.
- `src/prize.ts` `seasonTick` every minute: day reveal, then at the end `settleAll(end)` and `snapshot`; then expire unconfirmed rows past `deadline` and `syncWinners`.
- `src/payout.ts` (shared with the browser): `assignPrizes` (one person one prize, bigger prize kept, points race on a tie, reserve of 10), `payoutMessage`, `amountAfterGas` (21,000 gas at a fixed gas price), `formatEth`.
- Winner rows follow the player: a re-rank updates place and prize, keeps confirmation. First rows: deadline end + 7 days; later entrants: now + 3 days. Excluded and expired players stay out.
- Confirmation: winner signs `payoutMessage` with the sign-in wallet; server verifies with `viem` and stores message and signature.
- Team: check ok or exclude with reason, sanctions checked, ETH rate (fixed once a payout exists), publish (all rows confirmed, ok, sanctions checked), payout hash (after objections close, no open objection, rate set), next season (after paid; resets wave points, streaks, guarantee; items and roll numbers stay). Every action in `admin_log`.
- Letters: winners with an email get a row in `outbox`, shown on the team page; Send stays disabled until an email service is chosen.
- Routes: `GET /api/prize`, `POST /api/prize/confirm`, `GET /api/winners` (null until published), `POST /api/appeal {kind: "objection"}` only while objections are open, team routes `/api/admin/winners|winner-check|sanctions|rate|publish|payout|next-season`.
- Transfer: browser wallet only; checks `CHAIN_ID`; sends balance minus exact fee. `EXCHANGES` env `Name|url,...`; empty list is stated on screen.
- Test server (`DEV_LOGIN=1 MOCK_CHAIN=1`): in-memory mock chain (`src/devchain.ts`, `/api/dev/chain`, `/dev/explorer`), throwaway browser wallet, seeded players on the public Hardhat test mnemonic, team shortcuts (`/api/admin/dev`: end-now, prepare-test-winners, close-objections, pay-all). All 404 elsewhere.

## Out of scope

Plan milestone 5, item upgrades, websockets, automatic sanctions screening, deploy.
