# How to run Season One

Tasks for the team, one per section. Every setting named here is listed in [Game rules and server reference](reference-game-and-server.md).

## Run the game on your machine

1. Install dependencies: `bun install`.
2. Start the test server.
   - On the board host: `paneweb up` in the worktree. It picks the port and runs the `dev` script.
   - Elsewhere: `PORT=3000 bun run dev`.
3. Optional: fill the test database with 12 players who played today: `bun run seed:dev`.
4. Run the tests: `bun test`.

The `dev` script turns on test sign-in by name, the mock chain and the team key `season-one-dev`. It uses `data/dev.sqlite` and a season that started on 29 Sep 2026. The server refuses test sign-in on any database whose path lacks `dev`, or next to a real chain or treasury.

## Use the team page

1. Open `/admin` on the game's address.
2. Enter your team key and press "Open".

Each person has their own key, set in `ADMIN_TOKENS`. Every action is written to the team log with that person's name. After twenty wrong keys in 10 minutes, further wrong keys from that address are refused.

What the page holds:

- Season end: dates, ETH rate, publication, the next season. Winners show up here after the end.
- Season numbers: players in the tables, share under review, share who came by counted invite, counted friends per 10 players, players back on day 1 and day 7, share who shared a find.
- Appeals: disputes of a review and objections to the winners list. Accept or reject each with an answer.
- Accounts: sorted with accounts under review first, then open appeals, then the most shared connections and devices.

### Put an account under review

1. Find the account under Accounts.
2. Type the general reason the player will see. Never name the exact signs: bots would adapt.
3. Press "Put under review".

The account leaves the tables and the live feed. The player sees a notice and a "Dispute" button. Points are kept. "Back to tables", or an accepted appeal, returns the account with every point.

### Correct a player's points

1. Find the account under Accounts.
2. Type the change, plus or minus, and the reason.
3. Press "Correct".

The correction is announced on the Season tab. A hidden player shows as "Hidden player" in the notice.

## End the season and pay the prizes

The server ends the season by itself at the end time. It counts every hero's waves up to the end, freezes both tables and builds the winners list: 20 places in the points race, 10 in the invite race. Each winner sees a prize banner in the game.

Then, in this order:

1. Check each winner. On the winner's card press "Checked ok", or type a reason and press "Exclude". An excluded winner sees the reason; the next player from the reserve takes the place and has 3 days to confirm.
2. Wait for winners to confirm. A winner enters a country and a payout address and signs them with the sign-in wallet. Winners have 7 days from the season end. A winner who misses it loses the place to the next player.
3. Check each confirmed address against sanctions lists by hand. Then press "Address passed sanctions check".
4. Send the letters. "Letters to winners" holds one letter for each winner who gave an email. No email service is connected yet, so nothing is sent from the page.
5. Press "Publish winners list". It works only when every winner is confirmed, checked ok and sanctions checked. Objections stay open for 3 days.
6. Answer every objection under Appeals. Payouts stay locked until objections close and none is open.
7. On payout day, enter the dollars per 1 ETH and press "Set ETH rate". The rate is locked after the first payout.
8. Pay each prize from the treasury Safe; it needs two of three keys. Before signing, compare the payout address with the signed confirmation on the winner's card.
9. For each winner, paste the transaction hash and press "Record payout". Have a second person check the transaction in the explorer first: the server does not check it against the chain.
10. When every prize is recorded the season shows as paid. Enter the start of the next season in UTC and press "Start next season".

Pay every prize within 14 days of the season end. The page shows this date as "Pay by".

The next season starts points, streaks and counted friends from zero. Items and gear stay.

### Walk the season end on the test server

The test server shows extra buttons under "Test server only":

1. "End season now" ends the season at once. This step is one-way. Copy the test database first: see the backup section below.
2. "Confirm and check test players" confirms, checks and sanctions-checks every seeded test winner.
3. Publish the list, then "Close objections now".
4. Set an ETH rate, then "Pay all on mock chain".

## Back up and restore the database

The game keeps everything in one SQLite file, named by `DB_PATH`. The file holds the secrets of today and tomorrow and every session key. Keep copies only where the team can reach them, and encrypt them.

No continuous backup is chosen yet. The Plan asks for a continuous copy to another disk before launch: see "Open questions" in [the Plan](designs/plan.md).

To take a copy by hand while the server runs:

```sh
bun -e 'import { Database } from "bun:sqlite"; new Database("data/game.sqlite").run("VACUUM INTO ?", ["backup/game-2026-10-03.sqlite"])'
```

The target folder must exist first, and the target file must not.

To restore a copy:

1. Stop the server. On the board host: `paneweb down`.
2. Move the broken file aside. Never delete it before the restore works.
3. Copy the backup to the `DB_PATH` file.
4. Delete the `-wal` and `-shm` files next to it, for example `rm -f data/game.sqlite-wal data/game.sqlite-shm`.
5. Start the server. On the board host: `paneweb up`.

An old copy loses every roll made after it. Players keep receipts for those rolls. If the copy is older than a day's secret, the server makes a new secret for that day. Then players who saved the old seal see "Mismatch found" for that day. Tell players in an announcement before they check.

## Set the launch settings

Set these on the real server before the season starts. All are environment settings.

1. `PORT`: the port to listen on. The server refuses to start without it.
2. `PUBLIC_ORIGIN`: the game's address, starting with `https://`. The server refuses to start without it.
3. `IP_SALT`: a long random string. The server refuses to start without it.
4. `ADMIN_TOKENS`: one `name:key` pair per team member, comma separated. Each key needs 24 characters or more.
5. `SEASON_START`: the first season's start, for example `2026-10-06T00:00:00Z`. It is read once, on the first start with an empty database.
6. `TREASURY_ADDRESS`: the treasury Safe address. The landing page links to it when `EXPLORER_URL` is set too.
7. `CHAIN_ID` and `EXPLORER_URL`: Robinhood Chain's chain number and explorer address. The explorer builds links of the form `<EXPLORER_URL>/tx/<hash>`.
8. `EXCHANGES`: exchanges that take ETH straight from Robinhood Chain, as `Name|link,Name|link`. While it is empty, the transfer screen says: "The list of exchanges that take ETH on Robinhood Chain is published here before payouts."
9. `TRUST_PROXY=1` when the server runs behind a proxy. Without it every player looks like one address, and the sign-in limit becomes shared by all players.
10. Never set `DEV_LOGIN` or `MOCK_CHAIN` on the real server.

Start the server with `bun run start`.

Set these on the proxy in front of the server, not in the game: response compression, and the headers that forbid framing and require https.

Still waiting before launch:

- Email sign-in through Privy is not built. It needs the Privy app key, and a check that Privy works on Robinhood Chain.
- The country check is not built. It needs the list of closed countries from the legal review.
- No email service is chosen for letters to winners. It is needed before the season ends, not before launch.
- The exchange list and the treasury address need the team's answers.
