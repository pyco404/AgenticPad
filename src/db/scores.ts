import { eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, dailyScores, holdings, scoreDays } from "./schema.js";
import { utcDay } from "../chain/common.js";
import { convictionDays } from "./holdings.js";
import { seasonByKey } from "../season.js";
import { points, power, shares, weight, SCORE_PARAMS, type ScoreParams } from "../score.js";

/**
 * Holder scores, from matches and holdings (docs/holder-agents.md, Scoring).
 *
 * A day is scored from its ranked matches - player against player; a house
 * agent's fixed weaknesses measure nothing - and frozen once it is over, with
 * the power inputs beside each score. A season's score is the sum of its
 * daily scores, each floored and weighted on its own day.
 *
 * Nothing here is read by anything that plays. Scores are made of matches
 * already played; they never decide one.
 *
 * Conviction is the clock each holding keeps (src/db/holdings.ts), counted in
 * whole days to the end of the day being scored - or to now, for a day still
 * running. It runs on snapshots, so it is only as exact as they are.
 */

const DAY_MS = 86_400_000;

/** The UTC day a date falls on, and back. */
export const dayOf = (at: Date): number => utcDay(at);
export const dayDate = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayFromDate = (date: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not a date: ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`not a date: ${date}`);
  return ms / DAY_MS;
};

export type DayScore = {
  agentId: string;
  rankedMatches: number;
  points: number;
  qualified: boolean;
  convictionDays: number;
  shareOfSupply: number;
  power: number;
  weight: number;
  score: number;
};

type Rows<T> = { rows: T[] };

/** Each agent's net and match count against each opponent, over ranked matches on one UTC day. */
async function netsOn(db: Db, day: number) {
  const start = new Date(day * DAY_MS).toISOString();
  const end = new Date((day + 1) * DAY_MS).toISOString();
  // Raw and fully qualified: each match once from each seat, so one GROUP BY covers both.
  const result = (await db.execute(sql`
    select s.agent_id, s.opponent_id, sum(s.net)::int as net, count(*)::int as n from (
      select m.agent_a as agent_id, m.agent_b as opponent_id, m.net_a as net from matches m
        where m.ranked and m.created_at >= ${start} and m.created_at < ${end}
      union all
      select m.agent_b, m.agent_a, m.net_b from matches m
        where m.ranked and m.created_at >= ${start} and m.created_at < ${end}
    ) s group by s.agent_id, s.opponent_id
  `)) as unknown as Rows<{ agent_id: string; opponent_id: string; net: number; n: number }>;
  const byAgent = new Map<string, { matches: number; nets: number[] }>();
  for (const r of result.rows) {
    const entry = byAgent.get(r.agent_id) ?? { matches: 0, nets: [] };
    entry.matches += Number(r.n);
    entry.nets.push(Number(r.net));
    byAgent.set(r.agent_id, entry);
  }
  return byAgent;
}

/**
 * What each agent's power is made of: the fraction of supply its owner's
 * wallet held at the last reading, and the days its conviction clock has run
 * by `at`. Only a holder agent has a holding; any other agent scores with none.
 */
async function powerInputs(db: Db, agentIds: string[], at: Date) {
  if (agentIds.length === 0) return new Map<string, { convictionDays: number; shareOfSupply: number }>();
  const rows = await db
    .select({ id: agents.id, funding: agents.funding, amount: holdings.amount, supply: holdings.supply, since: holdings.convictionSince })
    .from(agents)
    .leftJoin(holdings, eq(holdings.wallet, agents.ownerId))
    .where(inArray(agents.id, agentIds));
  return new Map(
    rows.map((r) => {
      const supply = Number(r.supply ?? 0);
      const holder = r.funding === "holder";
      const share = holder && supply > 0 ? Number(r.amount ?? 0) / supply : 0;
      return [r.id, { convictionDays: holder ? convictionDays(r.since, at) : 0, shareOfSupply: share }];
    }),
  );
}

/** Scores one UTC day from its matches and the holdings as they stand. Not stored. */
export async function computeDay(db: Db, day: number, params: ScoreParams = SCORE_PARAMS, now = new Date()): Promise<DayScore[]> {
  const nets = await netsOn(db, day);
  // Days held by the end of the day scored, or by now while it is still running.
  const at = new Date(Math.min(now.getTime(), (day + 1) * DAY_MS));
  const inputs = await powerInputs(db, [...nets.keys()], at);
  const rows = [...nets.entries()].map(([agentId, { matches, nets: byOpponent }]) => {
    const input = inputs.get(agentId) ?? { convictionDays: 0, shareOfSupply: 0 };
    const p = power(input);
    const w = weight(p);
    const pts = points(byOpponent, params.opponentCap);
    return {
      agentId,
      rankedMatches: matches,
      points: pts,
      qualified: matches >= params.minDailyMatches,
      convictionDays: input.convictionDays,
      shareOfSupply: input.shareOfSupply,
      power: p,
      weight: w,
      score: pts * w,
    };
  });
  return rows.sort((a, b) => b.score - a.score || b.rankedMatches - a.rankedMatches || (a.agentId < b.agentId ? -1 : 1));
}

/**
 * Freezes a day that is over: scores it once and stores the scores, with the
 * parameters on the day's row. Exactly once - under a lock, and a day that is
 * already frozen is left alone - so a restart or a second instance changes
 * nothing. Returns whether this call froze it.
 */
export async function freezeDay(db: Db, day: number, now = new Date(), params: ScoreParams = SCORE_PARAMS): Promise<boolean> {
  if (now.getTime() < (day + 1) * DAY_MS) throw new Error(`day ${dayDate(day)} is not over`);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`score-day:${day}`}, 0))`);
    const [done] = await tx.select({ day: scoreDays.day }).from(scoreDays).where(eq(scoreDays.day, day)).limit(1);
    if (done) return false;
    const rows = await computeDay(t, day, params, now);
    await tx.insert(scoreDays).values({ day, opponentCap: params.opponentCap, minDailyMatches: params.minDailyMatches, frozenAt: now });
    if (rows.length) await tx.insert(dailyScores).values(rows.map((r) => ({ day, ...r })));
    return true;
  });
}

/**
 * Freezes every day that is over and not yet frozen, oldest first: from the
 * day after the last frozen one, or from the first ranked match if none has
 * been. Returns how many it froze.
 */
export async function freezeEndedDays(db: Db, now = new Date(), params: ScoreParams = SCORE_PARAMS): Promise<number> {
  const [last] = await db.select({ day: max(scoreDays.day) }).from(scoreDays);
  let from: number;
  if (last?.day !== null && last?.day !== undefined) {
    from = last.day + 1;
  } else {
    const first = (await db.execute(sql`select min(m.created_at) as at from matches m where m.ranked`)) as unknown as Rows<{ at: string | Date | null }>;
    const at = first.rows[0]?.at;
    if (!at) return 0;
    from = dayOf(new Date(at));
  }
  let frozen = 0;
  for (let day = from; day < dayOf(now); day++) if (await freezeDay(db, day, now, params)) frozen++;
  return frozen;
}

export type ScoreRow = DayScore & {
  name: string;
  mark: string | null;
  /** This row's fraction of the payout, under the 10% cap. 0 when it did not qualify. */
  share: number;
};

export type DayTable = {
  day: string;
  /** True once the day is over and its scores are the stored ones. */
  frozen: boolean;
  params: { opponentCap: number; minDailyMatches: number };
  rows: ScoreRow[];
};

async function named<T extends { agentId: string }>(db: Db, rows: T[]) {
  if (rows.length === 0) return new Map<string, { name: string; mark: string | null }>();
  const found = await db
    .select({ id: agents.id, name: agents.name, mark: agents.mark })
    .from(agents)
    .where(inArray(agents.id, rows.map((r) => r.agentId)));
  return new Map(found.map((r) => [r.id, { name: r.name, mark: r.mark }]));
}

/** Shares among the qualified rows only, in the rows' order. */
function withShares<T extends { qualified: boolean; score: number }>(rows: T[]): (T & { share: number })[] {
  const qualified = rows.filter((r) => r.qualified);
  const fractions = new Map(qualified.map((r, i) => [r, shares(qualified)[i]!]));
  return rows.map((r) => ({ ...r, share: fractions.get(r) ?? 0 }));
}

/** The frozen scores for a day, or null if it is not frozen. */
async function frozenDay(db: Db, day: number): Promise<{ params: DayTable["params"]; rows: DayScore[] } | null> {
  const [row] = await db.select().from(scoreDays).where(eq(scoreDays.day, day)).limit(1);
  if (!row) return null;
  const rows = await db.select().from(dailyScores).where(eq(dailyScores.day, day));
  return {
    params: { opponentCap: row.opponentCap, minDailyMatches: row.minDailyMatches },
    rows: rows
      .map(({ day: _day, ...r }) => r)
      .sort((a, b) => b.score - a.score || b.rankedMatches - a.rankedMatches || (a.agentId < b.agentId ? -1 : 1)),
  };
}

/**
 * One day's scores: the frozen ones once it is frozen, and computed live
 * before then - from today's matches and the holdings as they stand, so they
 * will move. `frozen` says which, because "this will still change" and "this
 * is final" must not be shown as though they were the same table.
 */
export async function dayScores(db: Db, day: number, params: ScoreParams = SCORE_PARAMS): Promise<DayTable> {
  const frozen = await frozenDay(db, day);
  const base = frozen ?? { params: { opponentCap: params.opponentCap, minDailyMatches: params.minDailyMatches }, rows: await computeDay(db, day, params) };
  const names = await named(db, base.rows);
  return {
    day: dayDate(day),
    frozen: frozen !== null,
    params: base.params,
    rows: withShares(base.rows).map((r) => ({ ...r, name: names.get(r.agentId)?.name ?? "", mark: names.get(r.agentId)?.mark ?? null })),
  };
}

export type SeasonScoreRow = {
  agentId: string;
  name: string;
  mark: string | null;
  rankedMatches: number;
  points: number;
  /** The sum of its daily scores. */
  score: number;
  /** Days it scored on. */
  days: number;
  qualified: boolean;
  share: number;
};

export type SeasonScoreTable = {
  season: string;
  /** True once every day of the season is over and frozen. */
  frozen: boolean;
  params: { minSeasonMatches: number };
  rows: SeasonScoreRow[];
};

/**
 * A season's scores: each agent's daily scores summed across the season's
 * days so far, with the season's own minimum of ranked matches to qualify.
 */
export async function seasonScores(db: Db, key: string, now = new Date(), params: ScoreParams = SCORE_PARAMS): Promise<SeasonScoreTable> {
  const season = seasonByKey(key);
  const first = dayOf(season.start);
  const last = Math.min(dayOf(season.end) - 1, dayOf(now));
  const totals = new Map<string, Omit<SeasonScoreRow, "qualified" | "share">>();
  let allFrozen = now.getTime() >= season.end.getTime();
  for (let day = first; day <= last; day++) {
    const table = await dayScores(db, day, params);
    if (!table.frozen) allFrozen = false;
    for (const r of table.rows) {
      const t = totals.get(r.agentId) ?? { agentId: r.agentId, name: r.name, mark: r.mark, rankedMatches: 0, points: 0, score: 0, days: 0 };
      t.rankedMatches += r.rankedMatches;
      t.points += r.points;
      t.score += r.score;
      t.days++;
      totals.set(r.agentId, t);
    }
  }
  const rows = [...totals.values()]
    .map((t) => ({ ...t, qualified: t.rankedMatches >= params.minSeasonMatches }))
    .sort((a, b) => b.score - a.score || b.rankedMatches - a.rankedMatches || (a.agentId < b.agentId ? -1 : 1));
  return { season: key, frozen: allFrozen, params: { minSeasonMatches: params.minSeasonMatches }, rows: withShares(rows) };
}

/** Freezes each day as it ends, on a timer. Returns a stop function. */
export function startScores(
  db: Db,
  options: { intervalMs?: number; onLog?: (line: string) => void; onError?: (error: unknown) => void } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const pass = async () => {
    try {
      const frozen = await freezeEndedDays(db);
      if (frozen) options.onLog?.(`scores: froze ${frozen} day${frozen === 1 ? "" : "s"}`);
    } catch (error) {
      options.onError?.(error);
    }
    if (!stopped) timer = setTimeout(() => void pass(), intervalMs);
  };
  void pass();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
