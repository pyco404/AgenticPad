import "./env.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadKeypair } from "../src/chain/common.js";
import { ChainClient, pdas, tokenProgramOf } from "../src/chain/settlement.js";
import { MAX_CHIP_RATE, RENT_CHIPS, rateForPrice, rateSteps, rentFor, USD_PER_CHIP } from "../src/chip-rate-plan.js";
import { nextSeason, seasonAt } from "../src/season.js";

// Sets next season's chip rate on the deposit program, from the token's price.
// A dry run unless --apply is given: it reads the program, works out the rate
// that keeps the peg (900 chips = $5), and prints every instruction it would
// send and what each figure comes to, so the numbers are checked before the
// admin key signs anything.
//
//   CHAIN_RPC_URL=... CHAIN_STAKE_MINT=... npx tsx scripts/set-season-rate.ts --price 0.00042
//   ... --price 0.00042 --apply          send it, signed by CHAIN_ADMIN_KEYPAIR
//   ... --rate 13227513                   a rate in base units a chip, instead of a price
//
// The price is USD per whole token, from the published time-weighted average
// the season is meant to be set from - never a spot quote (docs/economy.md,
// The chip rate; which average is open question 2).
//
// When to run it: in the last hours before the season boundary, Monday 00:00
// UTC. The api records the program's rate against each season on its first
// pass after the boundary and plays the whole week at it (src/db/chip-rate.ts).
// Set early, the program's own limits count in the new rate before the ledger
// does, and the api reports the drift until the boundary; set late, the season
// starts at the old rate and keeps it for the week.
//
// It sends, in order: the rate, as one instruction for a rise or several
// halvings for a fall (the program allows no more than half per instruction),
// then the rent, so renting stays $2. The program rescales the per-match limit
// itself.
//
// Keys: CHAIN_ADMIN_KEYPAIR, the config's admin. On mainnet that is a hardware
// wallet, which this script cannot sign with - a file key is for devnet and the
// rehearsal. See docs/mainnet.md.

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const apply = args.includes("--apply");
const price = value("--price");
const given = value("--rate");
if ((price === undefined) === (given === undefined)) {
  console.error("usage: set-season-rate.ts (--price <USD per token> | --rate <base units per chip>) [--apply]");
  process.exit(1);
}
const mintAddress = process.env["CHAIN_STAKE_MINT"];
if (!mintAddress) {
  console.error("CHAIN_STAKE_MINT is not set: the deposit program's stake token.");
  process.exit(1);
}

const connection = new Connection(process.env["CHAIN_RPC_URL"] ?? "http://127.0.0.1:18899", "confirmed");
const admin = loadKeypair(process.env["CHAIN_ADMIN_KEYPAIR"] ?? ".keys/admin.json");
const mint = new PublicKey(mintAddress);
const client = new ChainClient(connection, admin, mint, await tokenProgramOf(connection, mint));
const config = await client.config();

const current = config.chipRate.toNumber();
const target = given !== undefined ? Number(given) : rateForPrice(Number(price)).rate;
if (!Number.isSafeInteger(target) || target <= 0 || target > MAX_CHIP_RATE) {
  console.error(`${given} is not a rate the program accepts: a whole number from 1 to ${MAX_CHIP_RATE}.`);
  process.exit(1);
}
const steps = rateSteps(current, target);
const rent = rentFor(target);
const usd = (baseUnits: number, rate: number) => ((baseUnits / rate) * USD_PER_CHIP).toFixed(4);

const now = new Date();
const next = nextSeason(seasonAt(now));
console.log(`program  ${pdas.config().toBase58()}  (config)`);
console.log(`now      rate ${current} base units a chip, rent ${config.rent.toNumber()} (${config.rent.toNumber() / current} chips)`);
if (price !== undefined) {
  const { clamped } = rateForPrice(Number(price));
  console.log(`price    $${price} a token -> ${target} base units a chip${clamped ? `, clamped at the ceiling: the peg is let go` : ""}`);
}
console.log(`target   rate ${target}, rent ${rent} (${RENT_CHIPS} chips, $${usd(rent, target)}); a chip is ${(target / 1e6).toFixed(6)} tokens`);
console.log(`season   ${next.key} starts ${next.start.toISOString()}; the api records the program's rate on its first pass after that`);
if (steps.length === 0 && config.rent.toNumber() === rent) {
  console.log("nothing to change");
  process.exit(0);
}
console.log(`sends    ${steps.length ? steps.map((s) => `set_chip_rate ${s}`).join(", then ") : "no rate change"}${config.rent.toNumber() === rent ? "" : `, then set_rent ${rent}`}`);

if (config.admin.toBase58() !== admin.publicKey.toBase58()) {
  console.error(`The config's admin is ${config.admin.toBase58()}, not this key (${admin.publicKey.toBase58()}): every instruction would fail with NotAdmin.`);
  process.exit(1);
}
if (!apply) {
  console.log("dry run: nothing sent. --apply to send it.");
  process.exit(0);
}

for (const step of steps) console.log(`sent     set_chip_rate ${step}: ${await client.setChipRate(step)}`);
if (config.rent.toNumber() !== rent) console.log(`sent     set_rent ${rent}: ${await client.setRent(rent)}`);
const after = await client.config();
console.log(`now      rate ${after.chipRate.toNumber()}, rent ${after.rent.toNumber()}, per-match limit ${after.maxSettlement.toNumber() / after.chipRate.toNumber()} chips`);
