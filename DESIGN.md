---
# gstack: design-md-format=spec
name: Season One (working name)
description: Warm dark game table, hot pink actions, a paper receipt behind every roll. Playful, tactile, provably fair.
colors:
  ground: "#14110F"
  surface: "#211C18"
  surface-raised: "#2C2520"
  border: "#3D342D"
  shadow: "#0A0807"
  text: "#F4EDE4"
  text-muted: "#A89C90"
  primary: "#FF4D8D"
  primary-hover: "#FF6FA3"
  primary-pressed: "#E63A78"
  on-primary: "#1F0A12"
  paper: "#F3E9D2"
  on-paper: "#2A211B"
  paper-ink-muted: "#6A5B4A"
  paper-ink-verified: "#1A6B47"
  paper-ink-common: "#655C55"
  paper-ink-uncommon: "#3A7020"
  paper-ink-rare: "#2A60A8"
  paper-ink-epic: "#6A35BE"
  paper-ink-legendary: "#9A4A00"
  verified: "#3DDC97"
  warning: "#FFC93C"
  error: "#F0443A"
  rarity-common: "#A39A92"
  rarity-uncommon: "#7BC74D"
  rarity-rare: "#4C9BFF"
  rarity-epic: "#A970FF"
  rarity-legendary: "#FF9A1F"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontWeight: 800
    fontSize: clamp(2.5rem, 7vw, 4.5rem)
    lineHeight: 0.95
    letterSpacing: -0.03em
  headline:
    fontFamily: Bricolage Grotesque
    fontWeight: 800
    fontSize: 2rem
    lineHeight: 1.05
    letterSpacing: -0.02em
  title:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: 1.25rem
    lineHeight: 1.2
  body:
    fontFamily: Instrument Sans
    fontWeight: 400
    fontSize: 1rem
    lineHeight: 1.5
  body-strong:
    fontFamily: Instrument Sans
    fontWeight: 600
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Instrument Sans
    fontWeight: 600
    fontSize: 0.75rem
    letterSpacing: 0.06em
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 1rem
    fontFeature: tnum
  mono-score:
    fontFamily: JetBrains Mono
    fontWeight: 700
    fontSize: 1.5rem
    fontFeature: tnum
rounded:
  sm: 6px
  md: 10px
  lg: 16px
  xl: 24px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 56px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    typography: "{typography.body-strong}"
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    height: 48px
  button-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    borderColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    height: 48px
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  receipt:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.on-paper}"
    rounded: "{rounded.sm}"
    padding: "{spacing.lg}"
  chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
  chip-founder:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.on-paper}"
    rounded: "{rounded.full}"
  meter:
    backgroundColor: "{colors.surface-raised}"
    fillColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 12px
  item-frame:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    borderWidth: 3px
  nav-tab:
    textColor: "{colors.text-muted}"
    activeTextColor: "{colors.text}"
    typography: "{typography.label}"
  tab-bar:
    backgroundColor: "{colors.surface}"
    height: 60px
  season-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    height: 48px
---

# Season One (working name)

## Overview

**Creative North Star:** "Luck you can check." A warm, dark game table where every chest roll leaves a paper receipt the player can verify and share.

**Product context:**

- Browser idle game. Hero fights waves while the player is away; sessions last 1 to 3 minutes.
- 4-week points season, prizes paid in ETH, on Robinhood Chain.
- Free chance only: daily chest with streak, rare-chest guarantee meter, chest reel, live feed of rare drops.
- Viral loop: invite link, invite race, share card, founder badge.
- Players: crypto-native players from Hood Siege and Pons, plus newcomers who sign in by email. UI copy is English.
- Peers: Hood Siege is the market anchor. We share its crypto-native, gamified, dark register, not its look.

**Mode per surface:**

- Game screens (hero, chests, season, friends): Operate. Fast, thumb-first, numbers readable at a glance.
- Chest opening and fairness check: Experience. The one place with authored motion.
- Landing and share card: Persuade. Big display type, one action.
- Fairness explainer, season rules, appeal form: Read. Body text, generous line length limits.

**Reference sites:** hoodsiege.com (dark green-black ground, neon green pill buttons, Bungee display with offset shadow, pixel labels, pixel-art cards).

**Key characteristics:**

- Warm near-black ground, not green-black and not blue-black.
- Hot pink owns every primary action. Nothing else is pink.
- Cream paper receipts sit on the dark table: roll result, fairness check, share card, founder badge.
- Numbers, hashes and timers are always monospace.
- Hard offset shadows make buttons feel like pressable game pieces. No glow anywhere.

## Colors

**Strategy:** Full palette. Rarity tiers and states need their own colors, so the system names every hue once and gives each a single job.

**Light or dark:** Dark. Players open the game on a phone, in the evening or between tasks, for 1 to 3 minutes. The crypto game audience expects it. The paper receipt gives the light moment.

Rules:

- `primary` is interaction only: buttons, active meter fill, streak days earned, focus ring. Never decoration, never text on the dark ground.
- Robinhood green is not used. It belongs to the chain and to Hood Siege.
- `verified` means one thing: a fairness check passed or a state is confirmed. On paper, use `paper-ink-verified`. No other green dot or "live" light anywhere.
- `warning` and `error` always come with an icon and a text label. Color alone never carries a state.
- `error` text sits only on `surface` or `ground`. On `surface-raised` it drops to 4.0:1.
- Rarity colors appear on item frames, rarity labels and live feed item names. Never on buttons or backgrounds.
- Legendary orange and warning yellow are close in warmth. Legendary never appears without an item frame or item name.
- Neutrals are warm browns derived from the ground. Raise a surface by stepping `ground`, `surface`, `surface-raised`. Never lighten by opacity.
- Contrast: `text` and `text-muted` pass 4.5:1 on `surface-raised`. `on-primary` on `primary` is 6.0:1. All five rarity colors pass 4.5:1 on `surface` and `surface-raised`.

**Paper inks.** Dark-ground colors fail on cream paper: rarity colors land between 1.7:1 and 2.7:1, `primary` at 2.6:1. Anything printed on `paper` (receipt, share card, founder chip) uses its own inks, each at least 4.8:1 on `paper`:

- `on-paper` for main text, `paper-ink-muted` for labels and secondary lines.
- `paper-ink-verified` for the "Verified" stamp.
- `paper-ink-common`, `paper-ink-uncommon`, `paper-ink-rare`, `paper-ink-epic`, `paper-ink-legendary` for the rarity label and the 3px item frame on paper.
- Focus ring on paper is `on-paper`, not `primary`.
- Never put a dark-ground token on paper, and never a paper ink on the dark ground.

## Typography

**World:** printed game boxes, score sheets and receipts. A chunky, friendly grotesk for headlines, a plain humanist sans for reading, a monospace for anything a player compares or verifies.

- Display, headline, title: Bricolage Grotesque, weight 700 to 800, optical size axis at maximum for large sizes. It has a hand-cut warmth that reads as a game, not a bank.
- Body, labels, buttons: Instrument Sans. It is on the overused-as-display list, so it never sets a headline. As body text on Operate screens it is clear at 14 to 16px.
- Mono: JetBrains Mono with tabular figures. Points, ranks, timers, roll numbers, hashes, seeds, ETH amounts.

Scale: display, headline, title, body, label. Each level differs by size, not only weight. Labels are uppercase with 0.06em tracking, and only for short captions.

Loading: Google Fonts, one stylesheet request, `display=swap`. Preconnect to both Google Fonts hosts. Subset to Latin.

Do not use Press Start 2P, Silkscreen, Bungee or Cinzel. They are Hood Siege's voice.

## Layout

- Mobile first. Design at 390px wide with a 16px side gutter. No horizontal page scroll.
- Phone: one column, season bar pinned on top, bottom tab bar with four tabs: Hero, Chests, Season, Friends. Primary action sits in thumb reach, full width.
- Tablet (up to 1023px): phone layout, column at most 480px wide and centred.
- Desktop (1024px and up): 64px header with name, tabs and season bar numbers. Game column at most 480px wide. Leaderboard and live feed sit in a side column at most 360px wide. On the Season tab the full leaderboard takes the game column and the side column keeps only the feed. Landing page content is at most 1120px wide.
- Narrow phone (320px): season bar numbers never wrap; the "pts" unit drops first.
- Spacing scale is 4px based. Inside a panel use 8 to 16px. Between panels use 12px. Between page sections use 32 to 56px.
- Density: compact on game screens, roomy on Read screens.
- Grid breaks on purpose in one place: the chest reel runs edge to edge past the gutter.

## Elevation & Depth

- Depth is a hard offset shadow with no blur: 4px down in `shadow`. Pressable things have it: primary and secondary buttons, receipts (6px).
- Pressed state moves the element 2px down and halves the shadow.
- Panels sit flat, separated by surface steps, not shadows.
- Never a zero-offset glow, never a colored halo, never frosted glass.

## Shapes

- `sm` 6px: inputs, receipts, streak day squares.
- `md` 10px: buttons, item frames.
- `lg` 16px: panels.
- `xl` 24px: bottom sheets and the landing hero frame.
- `full`: chips, badges and meters only.
- Nested elements: inner radius equals outer radius minus the gap.
- Never a card inside a card. A panel holds rows, not more panels.
- One dominant panel per tab: Hero the away summary, Chests the waiting chests, Season the leaderboard, Friends the invite link. Everything else is a flat section: title, rows, dividers, no panel fill.

## Components

- **Buttons:** primary, secondary, ghost (underlined text), disabled. Height 48px minimum. Labels name the outcome: "Open daily chest", "Copy invite link", "Check this roll". Disabled buttons that wait on time show the countdown: "Next chest in 4h 12m". Focus-visible: 2px `primary` outline, 2px offset.
- **Input:** 48px high, `ground` fill, 1px `text-muted` outline so the field shows on any surface, `primary` focus ring. Visible label above, never a placeholder as the only label. Error shows `error` icon and message under the field.
- **Season bar:** 48px, pinned on every game screen, including the chest reel. Three mono values: rank, points, countdown ("#212 | 18,420 pts | 18d 07h 42m"). The whole bar is one button that opens the Season tab. Countdown updates each minute; on the final day it shows seconds in `warning` with a "Final day" label. Phase variants: "Starts in", "Unranked" before first points, "Under review" in place of rank, "final" after the season ends.
- **Tab bar:** 60px, four tabs, label style. Active tab: `text` color and a 3px `primary` bar. Arrow keys move between tabs.
- **Panel:** the one container. Title row on top: title left, status label or number right.
- **Receipt:** cream paper slip. Item with rarity frame, then a dashed rule, then labelled mono lines: roll number and date, server seed hash, player seed. Three states:
  - Sealed: the server secret is not revealed until 00:00 UTC. The receipt shows "Sealed. Checkable after 00:00 UTC" and no stamp.
  - Verified: the player ran the check after the reveal and it passed. The stamp lands.
  - Mismatch: the check failed. `error` alert under the receipt with the mismatching roll numbers.
- **Share card:** the receipt on the dark table, 1200 x 630, with player name, founder chip and invite link. Never carries a stamp: the link opens the live receipt page, which shows the current check state.
- **Rarity frame:** 3px border in the rarity color around item art. Rarity name above the item name in label style. On paper, frame and name use the paper inks.
- **Streak row:** seven 28px squares, earned days filled `primary`. A missed day steps back one square, matching the game rule.
- **Guarantee meter:** 12px bar, `primary` fill, mono count on the right ("2 / 3 days"), plain sentence under it.
- **Chips:** status and identity. The founder chip is cream paper with dark text, so it reads as a ticket stub next to any name.
- **Leaderboard row:** rank (mono, muted), name, optional founder chip, points (mono, right aligned). The player's own row uses `surface-raised` and stays pinned when the list scrolls.
- **Live feed row:** player name (or "Hidden player"), "found", item name in rarity color, rarity word, age. The rarity word is always there, so color never carries rarity alone. The panel label reads "Live" as plain text, no dot. Empty state text: "No rare drops yet this season."
- **Alerts:** `surface` background, icon and bold first phrase in the state color, plain text after. Success uses `verified`.
- **Countdown:** mono, bold. Season end and next game day (00:00 UTC) use the same component.
- Every component has designed empty, loading, error and long-name states. Long names truncate with an ellipsis at one line.

## Do's and Don'ts

- Do keep exactly one primary button per screen.
- Do show every number a player compares in monospace with tabular figures.
- Do show hashes in short form (first 4, last 4) with a copy action for the full value.
- Do write state messages as a bold short phrase plus one plain sentence.
- Do give rare drops real commissioned item art. Until art exists, show a labelled empty frame, never CSS-drawn art.
- Don't use pixel fonts, neon green or sunburst backgrounds. That is Hood Siege.
- Don't add glow, gradients on buttons, gradient text or purple gradient backgrounds.
- Don't use casino imagery: slot machines, poker chips, dollar signs on chests. Chance here is free.
- Don't show wallet addresses where an in-game name exists.
- Don't put secondary actions in modals. Use a bottom sheet on phone or inline on desktop.

## Motion

- **Approach:** intentional. Short state transitions everywhere, one authored moment.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80ms (press), short 200ms (state change), medium 320ms (sheet open), long 600ms (receipt slide-in).
- **The one authored moment:** the chest reel. Items scroll under the pink center line and slow to the result in about 3 seconds. The receipt then slides up from below. When a fairness check passes, the "Verified" stamp lands on the receipt with a short scale-down and a light haptic tap on phones. The stamp never lands at roll time: the check is possible only after the 00:00 UTC reveal.
- **Live feed:** a new row slides in from the top in 320ms. At most one row per 5 seconds; extra rows wait in a queue.
- **Loading:** skeleton rows at final row height. No full-screen spinner.
- `prefers-reduced-motion`: the reel jumps straight to the result, receipt and stamp appear without movement, feed rows appear without sliding, skeletons do not pulse.

## Decisions Log

- 2026-10-02: Initial design system created from the Brief, the stories and a visual study of hoodsiege.com.
- 2026-10-02: Dark warm ground chosen over a light paper theme. Reason: phone, evening, short sessions; matches the audience's category. Alternative: light printed "fairground ticket" theme.
- 2026-10-02: Hot pink primary chosen over Robinhood-style green. Reason: green belongs to the chain and to Hood Siege. Alternative: deep ink green.
- 2026-10-02: Chest reel kept, as the Brief requires. Alternative: tear-off ticket strip.
- 2026-10-02: Paper receipt and "Verified" stamp adopted as the fairness and share visual. Alternative: green check icon only.
- 2026-10-02: Bricolage Grotesque, Instrument Sans and JetBrains Mono chosen. Alternatives: Alfa Slab One display, Atkinson Hyperlegible body, Courier Prime mono.
- 2026-10-02: Mockup direction C "Scoreboard" picked: season bar always on top, leaderboard and live feed dominant, share buttons first on a rare result. Alternatives: options A and B.
- 2026-10-02: Paper inks added for small text on cream paper: `paper-ink-muted` #6A5B4A, `paper-ink-rare` #2A60A8 and `paper-ink-verified` #1A6B47 from the mockup, plus inks for the other four rarities. They replace `paper-muted` and `verified-ink`, which failed 4.5:1. Reason: keeps the receipt, the core fairness and share visual. Alternative: change the mockup direction and drop cream paper.
- 2026-10-02: Season bar and tab bar added as components. Inputs get a `text-muted` outline; the `border` color is 1.4:1 and hides the field.
- 2026-10-02: Mockup fixes: "Verified" stamp only after a check, never at roll time; no green "live" dot, since green means verified only; rarity always named in words.
- 2026-10-02: One dominant panel per tab, the rest flat sections. Alternative: the mockup's stack of equal panels, which reads as a template and gives the eye no first stop.
- 2026-10-02: Copy buttons and every tap target at least 44px; the mockup's 28px copy button is replaced.
