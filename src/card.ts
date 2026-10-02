// Share card: the paper receipt on the dark table, 1200 x 630, as PNG for X and Telegram.
// It never carries the "Verified" stamp: the link opens the live receipt page.
import { Resvg } from "@resvg/resvg-js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Rarity } from "./config";

const FONT_DIR = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
const FONT_FILES = readdirSync(FONT_DIR).map((f) => FONT_DIR + f);

const INK: Record<Rarity, string> = {
  common: "#655C55", uncommon: "#3A7020", rare: "#2A60A8", epic: "#6A35BE", legendary: "#9A4A00",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type CardData = { player: string; founder: boolean; item: string; rarity: Rarity; link: string; roll: string };

export function cardSvg(d: CardData) {
  const ink = INK[d.rarity];
  const name = d.item.length > 26 ? `${d.item.slice(0, 25)}…` : d.item;
  const who = d.player.length > 20 ? `${d.player.slice(0, 19)}…` : d.player;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#14110F"/>
  <text x="80" y="104" font-family="Bricolage Grotesque 96pt" font-weight="800" font-size="56" fill="#F4EDE4" letter-spacing="-1.5">Season One</text>
  <text x="80" y="148" font-family="Instrument Sans" font-size="26" fill="#A89C90">Free daily chest. Provably fair.</text>
  <rect x="80" y="196" width="1040" height="356" rx="6" fill="#0A0807"/>
  <rect x="80" y="186" width="1040" height="356" rx="6" fill="#F3E9D2"/>
  <rect x="116" y="222" width="180" height="180" rx="10" fill="#E9DCC0" stroke="${ink}" stroke-width="5"/>
  <text x="206" y="318" text-anchor="middle" font-family="Instrument Sans" font-weight="600" font-size="18" letter-spacing="2" fill="#6A5B4A">ITEM ART</text>
  <text x="332" y="262" font-family="Instrument Sans" font-weight="600" font-size="24" letter-spacing="3" fill="${ink}">${d.rarity.toUpperCase()}</text>
  <text x="332" y="330" font-family="Bricolage Grotesque 96pt" font-weight="800" font-size="${name.length > 20 ? 50 : 60}" fill="#2A211B" letter-spacing="-1.5">${esc(name)}</text>
  <text x="332" y="376" font-family="Instrument Sans" font-size="28" fill="#2A211B">found by <tspan font-weight="600">${esc(who)}</tspan></text>
  ${d.founder ? `<rect x="332" y="396" width="132" height="32" rx="16" fill="#2A211B"/><text x="398" y="418" text-anchor="middle" font-family="Instrument Sans" font-weight="600" font-size="15" letter-spacing="2" fill="#F3E9D2">FOUNDER</text>` : ""}
  <line x1="116" y1="440" x2="1084" y2="440" stroke="#C9B996" stroke-width="3" stroke-dasharray="10 8"/>
  <text x="116" y="498" font-family="JetBrains Mono" font-size="26" fill="#6A5B4A">Roll ${esc(d.roll)}</text>
  <text x="1084" y="498" text-anchor="end" font-family="JetBrains Mono" font-weight="700" font-size="26" fill="#2A211B">${esc(d.link)}</text>
</svg>`;
}

export const cardPng = (d: CardData) =>
  new Resvg(cardSvg(d), { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Instrument Sans" } }).render().asPng();
