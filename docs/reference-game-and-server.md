# Game rules and server reference

Game numbers live in `src/config.ts`, season-end deadlines in `src/prize.ts`, the reserve size in `src/payout.ts`, limits in `src/server.ts` and the session length in `src/auth.ts`. Change a number there, and nowhere else.

## Season

- A season lasts 28 days. The first one starts at `SEASON_START`; the team starts each later one.
- Days are UTC days. Daily chests and day secrets turn over at 00:00 UTC.
- Phases, in order:
  - upcoming: before the start;
  - live;
  - final day: the last 24 hours;
  - ended: tables frozen, winners confirm, the team checks;
  - published: winners list public, objections open for 3 days;
  - paid: every prize has a payout record.

## Points

- The hero fights one wave every 60 seconds.
- Each wave gives 10 points plus gear power.
- Gear power is the sum over the four slots: common 1, uncommon 2, rare 3, epic 4, legendary 5. The most is 20.
- The hero fights for 8 hours after each visit, then rests until the next visit.
- Waves stop at the season end.
- Friends: 10% of the wave points of each counted friend, at most 50,000 points a season.
- Team corrections add or remove points; each one is announced.
- Ties: the player who signed up earlier ranks higher.
- Points have no money value.

## Chests and finds

Every roll picks a rarity from a table of 10,000 weights, then one item within that rarity. All items of one rarity have the same chance.

Wave find, on every 10th wave:

- nothing: 80%
- common: 12%
- uncommon: 5.5%
- rare: 2%
- epic: 0.4%
- legendary: 0.1%

Daily chest, once per UTC day, at streak day 1:

- common: 55%
- uncommon: 30%
- rare: 11%
- epic: 3.5%
- legendary: 0.5%

Each streak step adds 10% to rare, epic and legendary, taken from common. The streak tops out at 7. At day 7: common 46%, uncommon 30%, rare 17.6%, epic 5.6%, legendary 0.8%. Each missed day costs one step.

Rare chest:

- It waits on the player's third active day without a rare or better roll. Any rare or better roll resets the count to zero.
- Odds: rare 85%, epic 13%, legendary 2%.

## Items

- 60 items: four slots (weapon, armor, charm, boots), five rarities, three items each. The list is in `src/items.ts`.
- An item's id is its place in that list. Never reorder or remove items: old rolls point at these ids.
- A new item goes on only when it is stronger than the item in its slot.
- Items and gear carry over to the next season.

## Invites and the Founder badge

- An invite link is `/i/<code>`. The code is kept in the browser for 30 days and binds the friend at first sign-in.
- A friend counts after 3 active days in the season, while not under review.
- The invite race ranks players by counted friends.
- The Founder badge: 3 active days during the first season. Later seasons never give it.

## Prizes

- Fund: $5,000. Points race $3,500, invite race $1,500.
- Points race, 20 places: $700, $450, $300, $200, $200, then $120 for places 6 to 10, then $105 for places 11 to 20.
- Invite race, 10 places: $400, $250, $150, then $100 for places 4 to 10.
- One person, one prize. A player in both races keeps the bigger prize; on equal prizes, the points race. The other place goes to the next player.
- A player with zero points takes no points-race prize.
- The reserve is the next 10 players of each race.
- Prizes are set in dollars and paid in ETH at the rate of the payout day.
- Deadlines, counted from the season end unless stated:
  - winners confirm within 7 days;
  - a replacement winner has 3 days from moving up;
  - objections stay open 3 days from publication;
  - payout no later than 14 days.

## Players

- Names: 3 to 20 characters: letters, digits, dot, dash, underscore. A short list of rude and staff-like words is refused.
- A player's own number for rolls: 8 to 64 characters, 0-9 and a-f. The browser makes one each day; a player may set their own on the fairness page.
- Sessions last 30 days.
- A hidden name shows as "Hidden player" to everyone else in the tables, live feed, share cards and correction notices. The winners list always shows real names.

## Limits

Each limit counts within 10 minutes.

- Sign-in: 20 tries per address.
- Visits: 120 per player.
- Chest openings: 60 per player.
- Setting your own number: 20 per player.
- Shares: 30 per player.
- Share card pictures: 300 new renders per address.
- Wrong team keys: 20 per address.
- Request body: 64 KB at most.

## Settings

Real server, required:

- `PORT`: port to listen on.
- `PUBLIC_ORIGIN`: the game's https address. Cookies, sign-in messages and share links use it.
- `IP_SALT`: secret salt for the connection fingerprints the team sees.

Real server, optional:

- `HOST`: address to listen on.
- `DB_PATH`: database file. Default `data/game.sqlite`.
- `SEASON_START`: first season start, ISO date. Default `2026-10-06T00:00:00Z`. Read once.
- `ADMIN_TOKENS`: `name:key` pairs, comma separated, each key 24 characters or more. Without it every team call answers "Not found."
- `TREASURY_ADDRESS`: treasury address shown on the landing page.
- `CHAIN_ID`: chain number the transfer screen expects in the wallet.
- `EXPLORER_URL`: explorer base for `/tx/<hash>` and `/address/<address>` links.
- `EXCHANGES`: `Name|link` pairs, comma separated.
- `TRUST_PROXY`: `1` to take the player's address from the proxy's last `x-forwarded-for` entry.

Test server only:

- `DEV_LOGIN=1`: test sign-in by name and the seed script. Refused next to `CHAIN_ID` or `TREASURY_ADDRESS`, or when `DB_PATH` lacks `dev`.
- `MOCK_CHAIN=1`: mock chain, throwaway browser wallet and test buttons on the team page. Works only with `DEV_LOGIN=1`.

## Team page

The page is `/admin`. Every team call sends `Authorization: Bearer <key>`.

- Season end: ETH rate, publish, next season. On the test server: "End season now", "Confirm and check test players", "Close objections now", "Pay all on mock chain".
- Winners: "Checked ok", "Exclude" with a reason, "Address passed sanctions check", "Record payout" with a transaction hash. Each card shows the signed confirmation.
- Off the list: winners who were excluded, ran out of time or moved.
- Letters to winners: waiting letters; no email service yet.
- Season numbers.
- Appeals: accept or reject with an answer.
- Accounts: "Put under review", "Back to tables", "Correct".

## API routes

Every route answers JSON. Errors come as `{ "error": "<sentence the player sees>" }`. A POST from another site's page is refused.

Public:

- `GET /api/season`: dates, phase, prizes, odds, treasury, chain and exchange settings.
- `GET /api/session`: the signed-in player, or null.
- `GET /api/leaderboard?board=points|invites`: top 50 and the caller's own row.
- `GET /api/feed`: the latest 20 rare or better rolls. Cached 5 seconds.
- `GET /api/announcements`: the latest 20 notices.
- `GET /api/roll/:id`: one roll's receipt.
- `GET /api/fair/days`: seals of the latest 8 days.
- `GET /api/winners`: the winners list once published, else null.

Sign-in:

- `POST /api/auth/siwe/message`: a sign-in message for a wallet address.
- `POST /api/auth/siwe/verify`: checks the signature and signs in. Needs `accept: true`.
- `POST /api/auth/dev`: test sign-in by name. Test server only.
- `POST /api/auth/logout`.
- `POST /api/name`: set the name once.

Player, signed in with a name:

- `POST /api/visit`: count waves, mark the day, return the player's state.
- `POST /api/chest/open`: `kind` is `daily` or `guaranteed`.
- `POST /api/seed`: set your own number.
- `GET /api/rolls`: your latest 50 rolls with an item.
- `GET /api/fair/check/:day`: your rolls of a day, with the secret once revealed.
- `POST /api/settings`: `hidden` true or false.
- `POST /api/share`: record a share of your roll `rollId`; `channel` is `x` or `telegram`.
- `POST /api/appeal`: `kind` is `appeal` or `objection`, with `email` and `text`.
- `GET /api/prize`, `POST /api/prize/confirm`: see and confirm your prize.

Team:

- `GET /api/admin/queue`, `/api/admin/appeals`, `/api/admin/metrics`, `/api/admin/winners`.
- `POST /api/admin/review`, `/api/admin/appeal`, `/api/admin/correction`.
- `POST /api/admin/winner-check`, `/api/admin/sanctions`, `/api/admin/rate`, `/api/admin/publish`, `/api/admin/payout`, `/api/admin/next-season`.
- `POST /api/admin/dev`: test actions. Test server only.

Pages and pictures:

- `/i/:code`: invite link; sets the invite and opens the game.
- `/r/:id`: share page of a find, with its picture for social networks.
- `/card/:id.png`: the 1200 by 630 share picture. Cached 5 minutes.
- `/wallet.js`: wallet code, loaded only when a wallet action starts.
- `/api/dev/chain` and `/dev/explorer/:kind/:id`: mock chain. Test server only.

## Database

- One SQLite file in WAL mode. The schema and its upgrades are in `src/db.ts`, versioned with `user_version`.
- Waves and chest openings each run in one immediate transaction.
- A background step runs every minute: it reveals finished days, ends the season and moves winners along.
