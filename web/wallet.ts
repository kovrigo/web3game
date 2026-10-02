// Wallet helpers, fetched by the page only when a wallet action needs them (see /wallet.js in src/server.ts).
// viem is more than half of the page script otherwise.
export { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
export { getAddress, isAddress } from "viem";
