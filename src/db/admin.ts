import { and, eq, isNotNull, isNull, max, min, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, holdings, matches, scoreDays } from "./schema.js";
import { holderCount, HOLDINGS_INTERVAL_MS } from "./holdings.js";
import { dayDate, dayOf } from "./scores.js";

/**
 * What /admin reports: the health of what runs now (docs/holder-agents.md).
 *
 * There is no program, no vault and no settlement, so nothing here watches
 * money move. What can go quietly wrong is the reading of wallets - an RPC
 * that stops answering leaves every holder on an old figure, and nobody in or
 * out of play when they should be - and the freezing of each day's scores,
 * which payouts will be made from. Both are said plainly, with the threshold
 * past which they are wrong rather than merely late.
 *
 * Read fresh each request: the page is opened when something looks wrong,
 * which is exactly when a stale figure is worst.
 */
export type Health = {
  at: Date;
  holders: number;
  holdings: {
    /** Wallets behind a holder agent in play. */
    wallets: number;
    /** The oldest of their readings, and how old it is. Null when there are none. */
    oldestReadAt: Date | null;
    oldestAgeMs: number | null;
    /** Past this, readings are stale: three missed passes. */
    staleAfterMs: number;
    stale: boolean;
  };
  scores: {
    /** The last UTC day frozen, as YYYY-MM-DD; null before any. */
    lastFrozen: string | null;
    /** Days that are over and not yet frozen. More than one means the freeze has stopped. */
    behind: number;
  };
  matches: { today: number; rankedToday: number };
};

export async function health(db: Db, now = new Date()): Promise<Health> {
  const inPlay = and(eq(agents.funding, "holder"), isNull(agents.retiredAt), isNotNull(agents.ownerId));
  const [readings] = await db
    .select({ wallets: sql<number>`count(distinct ${agents.ownerId})::int`, oldest: min(holdings.readAt) })
    .from(agents)
    .leftJoin(holdings, eq(holdings.wallet, agents.ownerId))
    .where(inPlay);
  const oldest = readings?.oldest ? new Date(readings.oldest) : null;
  const staleAfterMs = 3 * HOLDINGS_INTERVAL_MS;
  const oldestAgeMs = oldest ? now.getTime() - oldest.getTime() : null;

  const [frozen] = await db.select({ day: max(scoreDays.day) }).from(scoreDays);
  const last = frozen?.day ?? null;
  const today = dayOf(now);

  const midnight = new Date(today * 86_400_000);
  const [played] = await db
    .select({
      today: sql<number>`count(*)::int`,
      ranked: sql<number>`count(*) filter (where ${matches.ranked})::int`,
    })
    .from(matches)
    .where(sql`${matches.createdAt} >= ${midnight.toISOString()}`);

  return {
    at: now,
    holders: await holderCount(db),
    holdings: {
      wallets: Number(readings?.wallets ?? 0),
      oldestReadAt: oldest,
      oldestAgeMs,
      staleAfterMs,
      stale: oldestAgeMs !== null && oldestAgeMs > staleAfterMs,
    },
    scores: { lastFrozen: last === null ? null : dayDate(last), behind: last === null ? 0 : Math.max(0, today - 1 - last) },
    matches: { today: Number(played?.today ?? 0), rankedToday: Number(played?.ranked ?? 0) },
  };
}
