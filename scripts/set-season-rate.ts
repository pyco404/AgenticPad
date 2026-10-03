import "./env.js";
import { connect } from "../src/db/client.js";
import { rateOf, setSeasonRate } from "../src/db/chip-rate.js";
import { MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import { rateForPrice, USD_PER_CHIP } from "../src/chip-rate-plan.js";
import { nextSeason, seasonAt } from "../src/season.js";

// Sets next season's chip rate from the token's price: what pegs the holder
// minimum, $20, to tokens (docs/holder-agents.md). A dry run unless --apply is
// given: it prints the rate and what the minimum comes to at it, so the
// numbers are checked before anything is written.
//
//   DATABASE_URL=... npx tsx scripts/set-season-rate.ts --price 0.00042
//   ... --price 0.00042 --apply          write it
//   ... --rate 13227513                   a rate in base units a chip, instead of a price
//
// The price is USD per whole token, from the published time-weighted average
// the season is meant to be set from - never a spot quote (docs/economy.md,
// The chip rate). Run it before the boundary, Monday 00:00 UTC: the api adopts
// a season's rate on its first pass into it, and a season already under way
// keeps the rate it started with.

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

const planned = price !== undefined ? rateForPrice(Number(price)) : { rate: Number(given), clamped: false };
const next = nextSeason(seasonAt(new Date()));
const { db, close } = await connect();
const current = await rateOf(db, seasonAt(new Date()).key);
const tokens = (rate: number) => (MIN_FUNDING_CHIPS * rate) / 1_000_000;

console.log(`season ${next.key} starts ${next.start.toISOString()}`);
console.log(`rate now: ${current ?? "none recorded"}${current ? ` (minimum ${tokens(current).toLocaleString("en-US")} tokens)` : ""}`);
console.log(`rate next: ${planned.rate} base units a chip - minimum ${tokens(planned.rate).toLocaleString("en-US")} tokens = $${(MIN_FUNDING_CHIPS * USD_PER_CHIP).toFixed(2)}`);
if (planned.clamped) console.log("the price is below what the rate's ceiling allows: the rate is clamped and the peg let go");

if (!apply) {
  console.log("dry run: nothing written. Add --apply to write it.");
} else {
  await setSeasonRate(db, next.key, planned.rate);
  console.log(`written: season ${next.key} plays at ${planned.rate}`);
}
await close();
