import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Db } from "./client.js";
import { runExhibition } from "./runner.js";
import { agents, matches } from "./schema.js";
import { inPlaySql } from "./ledger.js";

/**
 * Exhibitions between house agents, so the platform is visibly running when no
 * player is. They stake nothing and settle nothing (see runExhibition); this
 * only decides who plays whom, and when.
 */

/**
 * Picks a pair that spreads play across the house roster rather than repeating
 * one matchup. Both agents are always under the same program, because
 * runExhibition refuses anything else.
 *
 * That constraint is not decoration. Picking across a roster where some pairs
 * cannot play (agents in different bands, once) meant the least-played agent -
 * a freshly seeded one, on zero plays - was paired with one it could not meet,
 * refused, and left on zero plays, so it was picked again next time.
 * Exhibitions did not fail sometimes; they stopped.
 */
export async function pickHousePair(
  db: Db,
  random: (n: number) => number = (n) => randomInt(n),
): Promise<[string, string] | null> {
  // Ten eligible autoplay players under the same program can meet each other.
  // Pause house filler until that is no longer true; no restart is needed.
  const players = await db.select({ funding: agents.funding }).from(agents)
    .where(and(isNotNull(agents.ownerId), isNull(agents.retiredAt), eq(agents.autoplay, true), inPlaySql()))
    .groupBy(agents.funding).having(sql`count(*) >= 10`).limit(1);
  if (players.length) return null;
  const rows = await db
    .select({ id: agents.id, funding: agents.funding })
    .from(agents)
    .where(and(isNull(agents.ownerId), isNull(agents.retiredAt)));

  // Only groups with at least two agents - a lone agent has nobody to meet.
  // No balance is asked of anyone: an exhibition moves nothing, and house
  // agents need no money. Grouped by program: runExhibition refuses a pair
  // under different programs, and
  // the least-played agent is picked first, so a fresh deposit-program agent
  // offered seed-program opponents would be refused, stay least-played, and be
  // picked again - every time.
  const groupOf = new Map<string, string>();
  const byGroup = new Map<string, string[]>();
  for (const r of rows) {
    const group = r.funding;
    groupOf.set(r.id, group);
    byGroup.set(group, [...(byGroup.get(group) ?? []), r.id]);
  }
  const house = [...byGroup.values()].filter((ids) => ids.length >= 2).flat();
  if (house.length < 2) return null;

  // Recent history: roughly two rounds of the roster.
  const recent = await db
    .select({ a: matches.agentA, b: matches.agentB })
    .from(matches)
    .where(eq(matches.exhibition, true))
    .orderBy(desc(matches.seq))
    .limit(house.length * 2);
  const plays = new Map<string, number>(house.map((id) => [id, 0]));
  const met = new Map<string, number>();
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const r of recent) {
    plays.set(r.a, (plays.get(r.a) ?? 0) + 1);
    plays.set(r.b, (plays.get(r.b) ?? 0) + 1);
    met.set(pairKey(r.a, r.b), (met.get(pairKey(r.a, r.b)) ?? 0) + 1);
  }

  const leastBy = (ids: string[], score: (id: string) => number) => {
    const best = Math.min(...ids.map(score));
    const tied = ids.filter((id) => score(id) === best);
    return tied[random(tied.length)]!;
  };
  // Whoever has played least goes next, against whoever it has met least,
  // then whoever has played least; ties at random.
  const first = leastBy(house, (id) => plays.get(id) ?? 0);
  // Its opponent comes from its own program only.
  const others = byGroup.get(groupOf.get(first)!)!.filter((id) => id !== first);
  const second = leastBy(others, (id) => (met.get(pairKey(first, id)) ?? 0) * 1000 + (plays.get(id) ?? 0));
  return random(2) === 0 ? [first, second] : [second, first];
}

/** Plays one exhibition every `intervalMs` on average, jittered so it doesn't tick like a metronome. */
export function startHouseExhibitions(
  db: Db,
  options: { intervalMs: number; onMatch?: (matchId: string) => void; onError?: (error: unknown) => void },
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const next = () => {
    if (stopped) return;
    const delay = Math.round(options.intervalMs * 0.5) + randomInt(Math.max(1, options.intervalMs));
    timer = setTimeout(() => void once(), delay);
  };
  const once = async () => {
    try {
      const pair = await pickHousePair(db);
      if (pair) {
        // Not folded into `onMatch?.(...)`: optional chaining would skip the match itself when no callback is given.
        const { match } = await runExhibition(db, pair[0], pair[1]);
        options.onMatch?.(match.id);
      }
    } catch (error) {
      options.onError?.(error);
    }
    next();
  };
  next();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
