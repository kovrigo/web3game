# Changelog

## 2026-10-03: Season One, first release

The first complete build of Season One: a free, 28-day season with a $5,000 prize fund, paid in ETH on Robinhood Chain.

### For players

- Sign in with a wallet: one free signature, no transaction, no gas. An 18+ tick and the season rules come first.
- Your hero fights one wave a minute, for up to 8 hours after each visit. Each wave gives 10 points plus gear power. Every 10th wave can bring a find, and better gear goes on by itself.
- Open a free daily chest. A streak of days raises the odds of rare and better, up to day 7. A rare chest arrives on your third active day without a rare find.
- Check any day's rolls yourself. The day is sealed in advance, your browser adds its own number, and "Check yesterday" recomputes every roll in your browser. See [Fairness and season design](docs/explanation-fairness-and-season.md).
- Invite friends with your link. A friend counts after 3 days of play and brings you 10% of their wave points, up to 50,000 a season.
- Race in two tables: points (20 prizes, $3,500) and invites (10 prizes, $1,500). One person, one prize.
- Share a find on X or Telegram with a picture of the item and your invite.
- Hide your name from the tables, the live feed and share cards. The winners list still shows real names.
- After the season, winners see a banner, confirm a country and payout address with a wallet signature, and, when paid to the sign-in wallet, send the ETH on to any wallet or exchange.
- Accounts taken off the tables for a check see why and can dispute it. Placed players can object to the winners list for 3 days.
- Play on 3 days in Season One to get the Founder badge.

### For the team

- The team page at `/admin`: accounts under review, appeals and objections, point corrections with public notices, season numbers.
- Season end runs on its own: tables freeze, winners and a reserve of 10 per race are listed. Then the team checks, publishes, sets the ETH rate and records each payout. See [How to run Season One](docs/how-to-run-the-season.md).
- Every team action is logged with the person's name. Each person has their own key.
- Test server: sign-in by name, a mock chain with a throwaway wallet, and buttons that walk the whole season end in minutes.

### Fixed before release

- A player with zero points can no longer take a points-race prize.
- A score correction notice keeps a hidden name hidden.
- "Object to the list" shows only to players who may object.
- "Near you" hides until you have points, matching "Unranked" in the season bar.
- Pages load faster on phones: wallet code loads only when a wallet action starts.

### Not in this release

- Email sign-in: waits for the Privy key.
- The country check: waits for the list of closed countries.
- Letters to winners: an email service is not chosen yet. Letters wait on the team page.
- Continuous database backup: the tool is not chosen yet.

### For contributors

- Docs: a first-day walk-through, team how-tos, a rules and server reference, and the fairness and season design.
