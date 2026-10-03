import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { adoptSeasonRate, DEVNET_CHIP_RATE } from "../chips.js";
import { seasonAt, seasonByKey } from "../season.js";
import type { Db } from "./client.js";
import { seasons } from "./schema.js";

/**
 * The season's chip rate: what one chip is worth in base units of the token,
 * for a whole week. Under holder agents (docs/holder-agents.md) it is what
 * pegs the minimum to dollars: $20 is 3,600 chips, and the rate turns that
 * into tokens.
 *
 * There is no program to read it from. It lives on the season's row, set
 * before the season starts (scripts/set-season-rate.ts), and changes only at
 * a boundary (docs/economy.md, The chip rate): the server records it against
 * the season once and plays the week at it. A season nobody set a rate for
 * carries the last season's on, rather than falling back to a figure from
 * nowhere - so forgetting to set one leaves the minimum where it was, not at
 * devnet's one token a chip.
 */

export type RateSync = {
  season: string;
  /** The rate adopted for the season in play. */
  rate: number;
  /**
   * recorded - the season already had its rate; carried - it had none, and
   * took the last season's; devnet - no season ever had one, and the fixed
   * devnet rate stands.
   */
  source: "recorded" | "carried" | "devnet";
};

/**
 * Settles the rate for the season in play and adopts it. Harmless to call
 * again, from any number of instances: the rate is written only where the
 * season has none, and read back, so two processes agree on whichever landed first.
 */
export async function syncSeasonRate(db: Db, now = new Date()): Promise<RateSync> {
  const season = seasonAt(now);
  await db.insert(seasons).values({ key: season.key, startsAt: season.start, endsAt: season.end }).onConflictDoNothing();

  let rate = await rateOf(db, season.key);
  let source: RateSync["source"] = "recorded";
  if (rate === null) {
    const [last] = await db
      .select({ chipRate: seasons.chipRate })
      .from(seasons)
      .where(and(lt(seasons.key, season.key), isNotNull(seasons.chipRate)))
      .orderBy(desc(seasons.key))
      .limit(1);
    if (last?.chipRate) {
      await db
        .update(seasons)
        .set({ chipRate: last.chipRate })
        .where(and(eq(seasons.key, season.key), isNull(seasons.chipRate)));
      rate = (await rateOf(db, season.key)) ?? last.chipRate;
      source = "carried";
    } else {
      rate = DEVNET_CHIP_RATE;
      source = "devnet";
    }
  }
  adoptSeasonRate(rate);
  return { season: season.key, rate, source };
}

/** The rate a season was played at, or null if none was recorded. */
export async function rateOf(db: Db, key: string): Promise<number | null> {
  const [row] = await db.select({ chipRate: seasons.chipRate }).from(seasons).where(eq(seasons.key, key));
  return row?.chipRate ?? null;
}

export class RateError extends Error {}

/**
 * Sets a season's rate before it starts. A season already under way keeps
 * the rate it started with: a change mid-week would make one week's minimum
 * two different numbers of tokens.
 */
export async function setSeasonRate(db: Db, key: string, rate: number, now = new Date()): Promise<void> {
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new RateError(`not a chip rate: ${rate}`);
  const season = seasonByKey(key);
  if (season.start.getTime() <= now.getTime()) throw new RateError(`season ${key} has started; set the next one's rate instead`);
  await db
    .insert(seasons)
    .values({ key: season.key, startsAt: season.start, endsAt: season.end, chipRate: rate })
    .onConflictDoUpdate({ target: seasons.key, set: { chipRate: rate } });
}
