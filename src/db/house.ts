import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Db } from "./client.js";
import { createAgent, runExhibition } from "./runner.js";
import { agents, canAffordBand, chainOps, ledger, matches, STAKE_BANDS, type BandName } from "./schema.js";
import { rateOf } from "../chips.js";
import { PRESET_NAMES, type PresetName } from "../presets.js";

/**
 * Exhibitions between house agents, so the platform is visibly running when no
 * player is. They stake nothing and settle nothing (see runExhibition); this
 * only decides who plays whom, and when.
 */

/**
 * Picks a pair that spreads play across the house roster rather than repeating
 * one matchup. Both agents are always in the same band and both can cover its
 * worst match, because runExhibition refuses anything else.
 *
 * That constraint is not decoration. Picking across the whole roster once bands
 * existed meant the least-played agent - a freshly seeded one, on zero plays -
 * was paired with someone in another band, refused, and left on zero plays, so
 * it was picked again next time. Exhibitions did not fail sometimes; they
 * stopped.
 */
export async function pickHousePair(
  db: Db,
  random: (n: number) => number = (n) => randomInt(n),
): Promise<[string, string] | null> {
  // Joined rather than correlated, as in playableBands.
  const balances = db
    .select({ agentId: ledger.agentId, balance: sql<number>`sum(${ledger.amount})::bigint`.as("balance") })
    .from(ledger)
    .groupBy(ledger.agentId)
    .as("balances");
  const rows = await db
    .select({ id: agents.id, band: agents.band, funding: agents.funding, balance: balances.balance })
    .from(agents)
    .innerJoin(balances, eq(balances.agentId, agents.id))
    .where(and(isNull(agents.ownerId), isNull(agents.retiredAt)));

  // Only agents that could actually play their own band, and only groups with
  // at least two of them - a lone agent has nobody to meet. Grouped by band
  // *and* program: runExhibition refuses a pair under different programs, and
  // the least-played agent is picked first, so a fresh deposit-program agent
  // offered seed-program opponents would be refused, stay least-played, and be
  // picked again - every time.
  const groupOf = new Map<string, string>();
  const byGroup = new Map<string, string[]>();
  for (const r of rows) {
    // Each house agent in its own units: a seed chip is one base unit, a
    // deposit chip a million.
    if (!canAffordBand(Number(r.balance), r.band, rateOf(r))) continue;
    const group = `${r.band}:${r.funding}`;
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
  // Its opponent comes from its own band and program only.
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

/**
 * The house roster on the deposit program: three of each preset in every band,
 * each starting with enough chips to last at its band's stakes. From the
 * week-long survival sweep (src/survival.ts, SURVIVAL_BY_SEED): 900 in A
 * survives 99.1% of the time, 1,350 in B 95.0%, 1,800 in C 91.7% - and a house
 * agent plays only when someone presses Play against it, far slower than the
 * autoplay pace that sweep assumes.
 */
export const DEPOSIT_HOUSE = {
  perPreset: 3,
  chips: { A: 900, B: 1_350, C: 1_800 } as Record<BandName, number>,
};

export type HouseSeat = { id: string; name: string; band: BandName; presetName: PresetName; chips: number };

/**
 * Creates whatever the deposit-program house roster is missing, and returns
 * all of it for funding.
 *
 * The deposit program cannot mint, so a house agent here is made in two parts:
 * the agent and a pending `open_vault` op, written together - the op carries
 * the salt its id derives from, and the outbox worker opens the vault - and
 * then a deposit into that vault from the treasury, made separately
 * (scripts/seed-deposit-house.ts). The ledger follows the deposit through the
 * sweep's credit for money that reaches a vault by another route, so nothing
 * here writes a balance.
 *
 * Idempotent: an agent counts once it has its op, so running this again after
 * a failure creates only what is still missing.
 */
export async function ensureDepositHouse(
  db: Db,
  nextName: () => string,
): Promise<{ created: HouseSeat[]; roster: HouseSeat[] }> {
  const existing = await db
    .select({ id: agents.id, name: agents.name, band: agents.band, presetName: agents.presetName })
    .from(agents)
    .where(
      and(
        isNull(agents.ownerId),
        isNull(agents.retiredAt),
        eq(agents.funding, "deposit"),
        sql`exists (select 1 from ${chainOps} where ${chainOps.agentId} = ${agents.id} and ${chainOps.kind} = 'open_vault')`,
      ),
    );
  const seat = (r: { id: string; name: string; band: BandName; presetName: string | null }): HouseSeat => ({
    id: r.id,
    name: r.name,
    band: r.band,
    presetName: r.presetName as PresetName,
    chips: DEPOSIT_HOUSE.chips[r.band],
  });
  const roster = existing.map(seat);
  const created: HouseSeat[] = [];
  for (const { name: band } of STAKE_BANDS) {
    for (const presetName of PRESET_NAMES) {
      const have = roster.filter((r) => r.band === band && r.presetName === presetName).length;
      for (let k = have; k < DEPOSIT_HOUSE.perPreset; k++) {
        const row = await db.transaction(async (tx) => {
          const agent = await createAgent(tx as unknown as Db, { name: nextName(), presetName, band, funding: "deposit" });
          // No owner, and no amount: the program opens a house vault empty,
          // and the treasury's deposit is what fills it.
          await tx.insert(chainOps).values({ kind: "open_vault", agentId: agent.id, owner: null, salt: agent.salt, amount: 0 });
          return agent;
        });
        const made = seat({ id: row.id, name: row.name, band, presetName });
        created.push(made);
        roster.push(made);
      }
    }
  }
  return { created, roster };
}
