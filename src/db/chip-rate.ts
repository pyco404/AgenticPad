import { and, eq, isNull } from "drizzle-orm";
import { adoptSeasonRate, DEVNET_CHIP_RATE, seasonRate } from "../chips.js";
import { seasonAt } from "../season.js";
import type { Db } from "./client.js";
import { seasons } from "./schema.js";

/**
 * The season's chip rate: what one chip is worth in base units of the stake
 * token, for a whole week.
 *
 * The rate is set on chain, not here. `set_chip_rate` is the config admin's
 * instruction, and that key is a hardware wallet the server never holds
 * (docs/mainnet.md, Keys), so the server cannot choose a rate - only read the
 * one the admin set. What the server owns is the rule that the rate changes
 * only at a season boundary (docs/economy.md, The chip rate): the program
 * cannot see a wall-clock Monday, so the ledger enforces it.
 *
 * It does so by recording the rate against the season, once. The first time a
 * season is in play and has no rate, the chain's rate is read and written to
 * that season's row; from then on the row is the rate for that season, and the
 * process adopts it. A change the admin makes on chain mid-week is therefore
 * not picked up until the next season starts - it is reported instead, as a
 * drift, because it means the chain's limits (the outflow floor, the minimum
 * stake, the rent) are already counting in next week's chips.
 *
 * So the admin sets next season's rate in the last hours before the boundary
 * (scripts/set-season-rate.ts), and the first pass after Monday 00:00 UTC
 * records it. Every season keeps the rate it was played at, which is what a
 * statement needs to show an owner what their chips were worth.
 */

/** What the settlement program's config carries: the rate, and the rent it demands, both in base units. */
export type ChainRate = { chipRate: number; rent: number };

export type RateSync = {
  season: string;
  /** The rate adopted for the season in play. */
  rate: number;
  /**
   * recorded - the season already had its rate; chain - read from the program
   * now and recorded; devnet - there is no program to read, and the fixed rate
   * stands; unreadable - the program could not be read and the season has no
   * rate yet, so the rate in use carries on until it can be.
   */
  source: "recorded" | "chain" | "devnet" | "unreadable";
  /** The program's rate, when it differs from the season's: the admin changed it mid-season. */
  drift: { chain: number; season: number } | null;
  /** The rent the program demands now, when it could be read: rentals must pay exactly this. */
  rent: number | null;
};

/**
 * Settles the rate for the season in play and adopts it. Harmless to call
 * again, from any number of instances: the rate is written only where the
 * season has none, so two processes reading the chain at once agree on
 * whichever landed first.
 *
 * `read` reads the program's config; null where there is no deposit program,
 * which is devnet without one and every test.
 */
export async function syncSeasonRate(db: Db, read: (() => Promise<ChainRate>) | null, now = new Date()): Promise<RateSync> {
  const season = seasonAt(now);
  // The season's row, made here rather than through seasons.ts, which calls this.
  await db.insert(seasons).values({ key: season.key, startsAt: season.start, endsAt: season.end }).onConflictDoNothing();

  let chain: ChainRate | null = null;
  if (read) {
    try {
      chain = await read();
    } catch {
      chain = null;
    }
  }

  const recorded = await rateOf(db, season.key);
  let rate: number;
  let source: RateSync["source"];
  if (recorded !== null) {
    rate = recorded;
    source = "recorded";
  } else if (chain) {
    await db
      .update(seasons)
      .set({ chipRate: chain.chipRate })
      .where(and(eq(seasons.key, season.key), isNull(seasons.chipRate)));
    // Read back rather than trusting what was written: another instance may have recorded it first.
    rate = (await rateOf(db, season.key)) ?? chain.chipRate;
    source = "chain";
  } else if (read) {
    rate = seasonRate();
    source = "unreadable";
  } else {
    rate = DEVNET_CHIP_RATE;
    source = "devnet";
  }

  adoptSeasonRate(rate);
  const drift = chain && chain.chipRate !== rate ? { chain: chain.chipRate, season: rate } : null;
  return { season: season.key, rate, source, drift, rent: chain?.rent ?? null };
}

/** The rate a season was played at, or null if none was recorded (devnet, or a season not yet reached). */
export async function rateOf(db: Db, key: string): Promise<number | null> {
  const [row] = await db.select({ chipRate: seasons.chipRate }).from(seasons).where(eq(seasons.key, key));
  return row?.chipRate ?? null;
}
