// Prize rules shared by the server and the browser. No database, no network.
import { PRIZES } from "./config";

export type Board = "points" | "invites";
export type Slot = { board: Board; place: number; playerId: number; prize: number };

// One person, one prize. A player on both boards keeps the bigger prize (points race on a tie);
// their place on the other board goes to the next player. `out` holds players who lost
// their prize (excluded by the team or did not confirm in time).
export function assignPrizes(points: number[], invites: number[], out: Set<number>) {
  const skip: Record<Board, Set<number>> = { points: new Set(out), invites: new Set(out) };
  const lists: Record<Board, number[]> = { points, invites };
  const pick = (b: Board) => lists[b].filter((id) => !skip[b].has(id)).slice(0, PRIZES[b].length);
  for (;;) {
    const p = pick("points"), i = pick("invites");
    const both = p.find((id) => i.includes(id));
    if (both === undefined) {
      const slots = (b: Board, ids: number[]): Slot[] => ids.map((playerId, k) => ({ board: b, place: k + 1, playerId, prize: PRIZES[b][k]! }));
      const reserve = (b: Board, taken: number[]) => lists[b].filter((id) => !skip[b].has(id) && !taken.includes(id)).slice(0, 10);
      return { slots: [...slots("points", p), ...slots("invites", i)], reserve: { points: reserve("points", p), invites: reserve("invites", i) } };
    }
    const prizeP = PRIZES.points[p.indexOf(both)]!, prizeI = PRIZES.invites[i.indexOf(both)]!;
    skip[prizeI > prizeP ? "points" : "invites"].add(both);
  }
}

// The text a winner signs with their sign-in wallet to confirm country and payout address.
// Place and amount are left out: they can move when someone above is excluded.
export const payoutMessage = (w: { seasonId: number; playerId: number; name: string; country: string; address: string }) =>
  [
    "Season One prize confirmation",
    `Season: ${w.seasonId}`,
    `Player: ${w.name} (#${w.playerId})`,
    `Country: ${w.country}`,
    `Payout address: ${w.address}`,
    "I confirm this country and that this address accepts ETH on Robinhood Chain.",
  ].join("\n");

export const COUNTRY_RE = /^[A-Za-z][A-Za-z .,'()-]{1,63}$/;

// A plain ETH transfer uses exactly 21,000 gas. With a fixed gas price the cost is exact,
// so the whole balance minus gas can be sent.
export const TRANSFER_GAS = 21_000n;
export function amountAfterGas(balanceWei: bigint, gasPriceWei: bigint) {
  const fee = TRANSFER_GAS * gasPriceWei;
  return { fee, value: balanceWei > fee ? balanceWei - fee : 0n };
}

export function formatEth(wei: bigint, digits = 6) {
  const neg = wei < 0n;
  const w = neg ? -wei : wei;
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const usdToEth = (usd: number, rate: number) => (rate > 0 ? usd / rate : null);
