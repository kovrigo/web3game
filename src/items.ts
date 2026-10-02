import type { Rarity, Slot } from "./config";

export type Item = { id: number; name: string; slot: Slot; rarity: Rarity };

// Order is the item id. Never reorder or remove: old rolls point at these ids.
const RAW: [Slot, Rarity, string[]][] = [
  ["weapon", "common", ["Rusty Cleaver", "Oak Cudgel", "Notched Shortsword"]],
  ["weapon", "uncommon", ["Brine Spear", "Harbor Hook", "Gull-feather Bow"]],
  ["weapon", "rare", ["Saltglass Saber", "Tidecaller Trident", "Ninth Wave Harpoon"]],
  ["weapon", "epic", ["Stormrend Glaive", "Deepwater Halberd", "Thunderhead Maul"]],
  ["weapon", "legendary", ["Ember of the First Gate", "Leviathan's Rib", "Dawnbreaker"]],
  ["armor", "common", ["Patched Jerkin", "Rope Vest", "Tin Cap"]],
  ["armor", "uncommon", ["Kelpweave Coat", "Barnacle Mail", "Gatewarden Helm"]],
  ["armor", "rare", ["Saltglass Buckler", "Reefplate Cuirass", "Lighthouse Helm"]],
  ["armor", "epic", ["Stormglass Mantle", "Tidebreaker Gauntlets", "Coralforged Plate"]],
  ["armor", "legendary", ["Ember Crown", "Mantle of the Long Night", "Aegis of the Ninth Gate"]],
  ["charm", "common", ["Lucky Pebble", "Frayed Ribbon", "Bent Coin"]],
  ["charm", "uncommon", ["Driftwood Charm", "Gull Bone Totem", "Sea-glass Bead"]],
  ["charm", "rare", ["Lantern of the Ninth Wave", "Compass of Quiet Seas", "Pearl of Low Tide"]],
  ["charm", "epic", ["Stormbottle", "Eye of the Maelstrom", "Siren's Locket"]],
  ["charm", "legendary", ["Heart of the Tide", "Star of the Last Watch", "Crownless Sigil"]],
  ["boots", "common", ["Worn Sandals", "Wet Socks", "Cork Clogs"]],
  ["boots", "uncommon", ["Mossbound Boots", "Dockhand Boots", "Sandrunner Wraps"]],
  ["boots", "rare", ["Wavestrider Boots", "Salt-crusted Greaves", "Quayside Treads"]],
  ["boots", "epic", ["Galewalker Boots", "Undertow Sabatons", "Riptide Striders"]],
  ["boots", "legendary", ["Boots of the Endless Shore", "Stormwalker's Path", "Footfalls of Dawn"]],
];

export const ITEMS: Item[] = RAW.flatMap(([slot, rarity, names]) => names.map((name) => ({ slot, rarity, name }))).map(
  (it, id) => ({ id, ...it }),
);

// Items of one rarity, sorted by id: the roll picks an index into this list.
export const byRarity = (r: Rarity) => ITEMS.filter((it) => it.rarity === r);
