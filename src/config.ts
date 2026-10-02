// Every tunable number of the season. Shared by server and browser: no env reads here.

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARE_UP: Rarity[] = ["rare", "epic", "legendary"];

export const SLOTS = ["weapon", "armor", "charm", "boots"] as const;
export type Slot = (typeof SLOTS)[number];

export const WAVE_SECONDS = 60;
export const OFFLINE_CAP_SECONDS = 8 * 3600;
export const FIND_EVERY = 10;
export const BASE_WAVE_POINTS = 10;
export const POWER: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

export const STREAK_MAX = 7;
export const GUARANTEE_DAYS = 3;
export const INVITE_DAYS = 3;
export const FOUNDER_DAYS = 3;
export const REF_SHARE = 0.1;
export const REF_CAP = 50_000;
export const SEASON_DAYS = 28;

// Weights out of 10,000. Order matters: rolls walk the table top to bottom.
export type Table = [Rarity | "none", number][];
export const TOTAL = 10_000;

export const FIND_TABLE: Table = [
  ["none", 8000], ["common", 1200], ["uncommon", 550], ["rare", 200], ["epic", 40], ["legendary", 10],
];
export const GUARANTEED_TABLE: Table = [["rare", 8500], ["epic", 1300], ["legendary", 200]];
const DAILY_BASE: Record<Rarity, number> = { common: 5500, uncommon: 3000, rare: 1100, epic: 350, legendary: 50 };

// Each streak step adds 10% to rare, epic and legendary, taken from common.
export function dailyTable(streak: number): Table {
  const k = 1 + 0.1 * (Math.min(Math.max(streak, 1), STREAK_MAX) - 1);
  const rare = Math.round(DAILY_BASE.rare * k), epic = Math.round(DAILY_BASE.epic * k), legendary = Math.round(DAILY_BASE.legendary * k);
  const common = TOTAL - DAILY_BASE.uncommon - rare - epic - legendary;
  return [["common", common], ["uncommon", DAILY_BASE.uncommon], ["rare", rare], ["epic", epic], ["legendary", legendary]];
}

export type RollKind = "daily" | "guaranteed" | "find";
export function tableFor(kind: RollKind, streak: number): Table {
  return kind === "find" ? FIND_TABLE : kind === "guaranteed" ? GUARANTEED_TABLE : dailyTable(streak);
}

// Prize per place, in dollars. One person, one prize.
export const PRIZES = {
  points: [700, 450, 300, 200, 200, 120, 120, 120, 120, 120, ...Array(10).fill(105)] as number[],
  invites: [400, 250, 150, ...Array(7).fill(100)] as number[],
};
export const PRIZE_FUND = 5000;
