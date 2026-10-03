import { and, asc, eq, lte, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Db } from "./client.js";
import { standings } from "./standings.js";
import { syncSeasonRate, type RateSync } from "./chip-rate.js";
import { nextSeason, seasonByKey, type Season } from "../season.js";
import { seasonStandings, seasons } from "./schema.js";

/**
 * The season boundary: closing one season.
 *
 * Nothing is rented any more (docs/holder-agents.md), so nothing ends with a
 * season: an agent plays on through the boundary while its wallet holds the
 * minimum, autoplay and all. What a boundary does is freeze the season's
 * ladder standings and settle the next season's chip rate. It is written so
 * that running it late, running it twice, or dying halfway through are all
 * harmless.
 */

/** Makes sure a season has its row. Harmless to call again. */
export async function ensureSeason(db: Db, season: Season): Promise<void> {
  await db
    .insert(seasons)
    .values({ key: season.key, startsAt: season.start, endsAt: season.end })
    .onConflictDoNothing();
}

export type CloseResult = { closed: boolean; standings: number };

/**
 * Closes a season: freezes its standings and marks it closed. Exactly once:
 * the season's row is locked and its status checked first, so a second run -
 * after a restart, or from a second instance - finds it closed and does
 * nothing. One transaction, so a run that dies halfway leaves nothing half-done.
 *
 * The standings are the ladder's: ranked net won, frozen now and never
 * recomputed. What rewards pay on is the score, frozen day by day
 * (src/db/scores.ts), not this.
 */
export async function closeSeason(db: Db, key: string, now = new Date()): Promise<CloseResult> {
  const season = seasonByKey(key);
  if (now.getTime() < season.end.getTime()) throw new Error(`season ${key} has not ended`);
  await ensureSeason(db, season);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`season:${key}`}, 0))`);
    const [row] = await tx.select().from(seasons).where(eq(seasons.key, key)).for("update");
    if (row!.status === "closed") return { closed: false, standings: 0 };

    const table = await standings(t, { season: key });
    if (table.length > 0) {
      await tx
        .insert(seasonStandings)
        .values(
          table.map((s, i) => ({
            season: key,
            agentId: s.agentId,
            rank: i + 1,
            rankedMatches: s.rankedMatches,
            rankedNet: s.rankedNet,
            rankedStaked: s.rankedStaked,
            rankedNetReal: s.rankedNetReal,
            totalMatches: s.totalMatches,
            totalNet: s.totalNet,
          })),
        )
        .onConflictDoNothing();
    }

    await ensureSeason(t, nextSeason(season));
    await tx.update(seasons).set({ status: "closed", closedAt: now }).where(eq(seasons.key, key));
    return { closed: true, standings: table.length };
  });
}

export type SeasonTick = { closed: { key: string; result: CloseResult }[]; rate: RateSync };

/**
 * One pass: close every season that has ended and is still open, oldest
 * first, and settle the rate for the season now in play. Runs at startup and
 * then every minute, so a boundary missed while the api was down is closed as
 * soon as it is back, and a new season's rate is in use within a minute of it
 * starting.
 */
export async function seasonTick(db: Db, now = new Date()): Promise<SeasonTick> {
  const ended = await db
    .select({ key: seasons.key })
    .from(seasons)
    .where(and(eq(seasons.status, "open"), lte(seasons.endsAt, now)))
    .orderBy(asc(seasons.key));
  const closed: SeasonTick["closed"] = [];
  for (const { key } of ended) closed.push({ key, result: await closeSeason(db, key, now) });
  return { closed, rate: await syncSeasonRate(db, now) };
}

export function startSeasons(
  db: Db,
  options: {
    pollMs?: number;
    onLog?: (line: string) => void;
    onError?: (error: unknown) => void;
  } = {},
): { stop: () => void } {
  const pollMs = options.pollMs ?? 60_000;
  const log = options.onLog ?? (() => {});
  let stopped = false;
  let lastSaid = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const once = async () => {
    try {
      const result = await seasonTick(db, new Date());
      const r = result.rate;
      // Said once per change, not every minute.
      const said = `${r.season}:${r.rate}:${r.source}`;
      if (said !== lastSaid) {
        lastSaid = said;
        if (r.source === "carried") log(`season: ${r.season} had no chip rate set, so it carries the last season's, ${r.rate}`);
      }
      for (const { key, result: c } of result.closed) {
        if (c.closed) log(`season: closed ${key} - ${c.standings} standings frozen`);
      }
    } catch (error) {
      options.onError?.(error);
    }
    if (!stopped) timer = setTimeout(() => void once(), pollMs + randomInt(Math.max(1, Math.round(pollMs / 10))));
  };
  void once();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
