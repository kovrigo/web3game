# Fairness and season design

Why chests can be checked by anyone, and why the season works the way it does. The full reasoning, with the options turned down, is in [the Brief](designs/web3-game-brief.md) and [the Plan](designs/plan.md). Both are in Russian.

## The problem fairness solves

The game gives away real money and runs its own dice. A player has every reason to ask: did the server pick a bad item for me on purpose? Saying "trust us" does not answer that. The answer has to be something a player can check without trusting the server.

## Seal, number, open: the commit-reveal scheme

The scheme has three parts. In the game they are called the seal, your number and the opened envelope.

1. The seal. At the start of each UTC day the server has a secret of 32 random bytes for today and one for tomorrow. It publishes the SHA-256 hash of each one. The hash is the seal: it fixes the secret, but nobody can work the secret back out of it.
2. Your number. On your first visit of the day your browser makes a random number and keeps a copy, together with the day's seal. You may set your own number on the fairness page.
3. The roll. Every roll is an HMAC-SHA256 of `your number:kind:n`, keyed with the day's secret. Its first 52 bits pick the rarity from the published odds. The next 32 bits pick the item.
4. The opening. After 00:00 UTC the server finishes every hero's waves for the past day, then reveals that day's secret.
5. The check. Your browser hashes the secret and compares it with the seal it saved. It recomputes every roll of the day and compares the results.

Why this holds:

- The server cannot change the secret after the seal is out: the hash would no longer match the saved seal.
- The server cannot pick a secret to fit your number. The seal of a day is public before any number used on that day exists.
- You cannot pick a number to fit the secret, because the secret stays hidden until the day is over.
- Roll numbers run without gaps: daily chests 1, 2, 3; rare chests counted apart; wave finds use the wave number. A roll the server hid or rerolled shows up as a gap.
- The server and the browser run the same code, `src/fair.ts`, so the two cannot read the rules differently.

### Why the hero stops after 8 hours

Wave finds are rolled when the server counts the waves, often hours after they happened. That could open a gap: the server would know today's secret while it counts yesterday's waves. The 8-hour limit closes it. Every number a find uses was set during a visit, and that visit came after the seal of every day the hero fights on. Tomorrow's seal is out from the start of today for the same reason.

### What the scheme does not cover

- Seals live in the game and in each player's browser, not on a chain. A player who never opened the game that day has no saved seal to compare with. Writing seals to the chain each day would cost gas every day; the Brief allows the chain only for payouts.
- Anyone who reads the database file knows today's secret early. That is why copies of the file must stay private and encrypted.

## The season design

### One season, free to play

The season is 28 days with a $5,000 prize fund. Nothing costs money: chests are free and their odds are public. Season points have no money value and promise no token. The Brief turned down a full in-game economy and any hint of a future token. A token hint would speed growth, but it brings legal risk and the let-down of games that promised one.

### Why waves, chests and a streak

- Waves reward coming back, not sitting at the screen. The hero fights alone, but only for 8 hours after a visit. A player who never visits gains nothing. One visit gives 8 hours of waves; about three visits a day keep the hero fighting all day.
- The daily chest and the streak make each day feel like a small draw. The streak raises rare odds up to day 7, so a run of days pays off.
- The rare chest guarantees a rare or better item within 3 active days. Bad luck never lasts long.
- Gear power adds to every wave. A lucky find helps, but it adds at most 20 points a wave to the base 10. Showing up every day matters more than luck.

### Why two races

- The points race rewards play. It takes 70% of the fund.
- The invite race rewards bringing people. It takes 30% of the fund. A friend counts only after 3 days of play, so a pile of empty accounts earns nothing.
- Friends also give 10% of their wave points to the inviter, capped at 50,000 a season, so one big referral network cannot buy the points race.
- One person, one prize. A player in both races keeps the bigger prize, and the next player moves up in the other race.

### Why winners are checked by hand

Bots and account farms are the main threat to the fund. The game only shows signs: shared connections and devices, invite chains. Then the team decides. Every winner is checked by a person before payout. A reserve player is checked on moving up to a prize place. An account under review is told so, keeps its points and can dispute. A real person mistaken for a bot should get a fair hearing, not quietly disappear.

### Why the season end is slow

The end runs on fixed steps: 7 days to check and confirm, publication, 3 days for objections, payout within 14 days. Each step leaves something the players can see:

- Winners sign their country and payout address with the wallet they signed in with. The treasury key holders compare the signed text before paying, so a changed address in the database would show.
- The treasury is a 2-of-3 Safe at a public address. Anyone can see the fund is there; no single lost key can take it.
- Transaction links appear next to the winners list once paid.
- The game server holds no keys and sends no transactions.

### What carries over

The next season starts points, streaks and counted friends from zero, so new players have a real chance. Items and gear stay, so time spent is not lost. The Founder badge stays with Season One.
