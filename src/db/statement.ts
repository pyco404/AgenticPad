import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { matches, seasons } from "./schema.js";
import { seasonScores, type SeasonScoreRow } from "./scores.js";
import { seasonByKey } from "../season.js";

/**
 * A season's statement: what the season did, and what it would pay.
 *
 * Under holder agents (docs/holder-agents.md) matches move no money and
 * nothing is rented or burned, so the statement is the play and the scores.
 * The payout side is deliberately empty: the reward wallets are funded by the
 * creator-fee split, which waits on the legal review, so there is no pool and
 * no amount per share. When the pool opens, the work is to fill in `payouts`;
 * nothing here has to be rearranged to make room for it, and nothing quietly
 * reads as a payout in the meantime.
 */
export type SeasonStatement = {
  season: {
    key: string;
    number: number;
    startsAt: Date;
    endsAt: Date;
    /** "closed" means the figures below are final and will not move again. */
    status: "open" | "closed";
    /**
     * Base units of the token in one chip, this season: what pegged the
     * holder minimum to dollars. Null where none was recorded.
     */
    chipRate: number | null;
  };
  play: {
    /** Player against player: the matches that score. */
    rankedMatches: number;
    /** With a house agent in them: played and shown, counted toward nothing. */
    exhibitions: number;
    /**
     * The sum of every side's net across ranked matches. A match is zero-sum
     * between its two agents, so this is zero, and a statement that says so is
     * a statement that has checked. A non-zero figure means a match row was
     * written that the engine never produced.
     */
    netAcrossAllSides: number;
  };
  payouts: {
    /**
     * False until the creator-fee split is configured and the reward wallets
     * are funded. While it is false, every amount is null rather than zero:
     * "nothing was paid" and "we do not know yet" must not look alike.
     */
    funded: false;
    pool: null;
    paid: null;
  };
  /**
   * The holder score: the sum of each agent's daily scores, with each day's
   * power inputs stored beside its score (/scores?day=) so a payout can be
   * checked against what it was made of. `share` is the fraction of a payout
   * under the 10% cap, not an amount.
   */
  scores: {
    basis: "net chips won x weight(power), summed over the season's days";
    frozen: boolean;
    minSeasonMatches: number;
    places: SeasonScoreRow[];
  };
};

/**
 * `places` is capped: a statement is a document, and a season with a thousand
 * agents does not want every one of them in it.
 */
export async function seasonStatement(db: Db, key: string, places = 50): Promise<SeasonStatement> {
  const season = seasonByKey(key);
  const [row] = await db.select({ status: seasons.status, chipRate: seasons.chipRate }).from(seasons).where(eq(seasons.key, key)).limit(1);
  const [play] = await db
    .select({
      rankedMatches: sql<number>`count(*) filter (where ${matches.ranked})::int`,
      exhibitions: sql<number>`count(*) filter (where ${matches.exhibition})::int`,
      net: sql<number>`coalesce(sum(${matches.netA} + ${matches.netB}) filter (where ${matches.ranked}), 0)::bigint`,
    })
    .from(matches)
    .where(eq(matches.season, key));
  const scored = await seasonScores(db, key);
  return {
    season: {
      key,
      number: season.number,
      startsAt: season.start,
      endsAt: season.end,
      status: row?.status === "closed" ? "closed" : "open",
      chipRate: row?.chipRate ?? null,
    },
    play: {
      rankedMatches: Number(play?.rankedMatches ?? 0),
      exhibitions: Number(play?.exhibitions ?? 0),
      netAcrossAllSides: Number(play?.net ?? 0),
    },
    payouts: { funded: false, pool: null, paid: null },
    scores: {
      basis: "net chips won x weight(power), summed over the season's days",
      frozen: scored.frozen,
      minSeasonMatches: scored.params.minSeasonMatches,
      places: scored.rows.slice(0, places),
    },
  };
}
