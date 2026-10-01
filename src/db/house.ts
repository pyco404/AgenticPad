import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Db } from "./client.js";
import { createAgent, runExhibition } from "./runner.js";
import { agents, chainOps, matches } from "./schema.js";
import { PRESET_NAMES, type PresetName } from "../presets.js";

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

/**
 * The house roster on the deposit program: nine of each preset, thirty-six in
 * all.
 *
 * House agents never stake, so they need no balance (docs/mainnet.md, decision
 * 5): matchmaking, exhibitions and retirement ask nothing of it. `chips` is
 * what the devnet roster was funded with before that was so, and what the
 * optional `fund` step of scripts/seed-deposit-house.ts still tops a vault up
 * to; a mainnet roster is not funded at all.
 */
export const DEPOSIT_HOUSE = {
  perPreset: 9,
  chips: 1_350,
};

export type HouseSeat = { id: string; name: string; presetName: PresetName; chips: number };

/**
 * Creates whatever the deposit-program house roster is missing, and returns
 * all of it.
 *
 * Each agent is written together with a pending `open_vault` op - the op
 * carries the salt its id derives from, and the outbox worker opens the vault.
 * Nothing needs to go into that vault: a house agent never stakes. Nothing here
 * writes a balance; if a vault is ever funded anyway, the sweep's credit for
 * money that reaches a vault by another route brings the ledger along.
 *
 * Idempotent: an agent counts once it has its op, so running this again after
 * a failure creates only what is still missing.
 */
export async function ensureDepositHouse(
  db: Db,
  nextName: () => string,
): Promise<{ created: HouseSeat[]; roster: HouseSeat[] }> {
  const existing = await db
    .select({ id: agents.id, name: agents.name, presetName: agents.presetName })
    .from(agents)
    .where(
      and(
        isNull(agents.ownerId),
        isNull(agents.retiredAt),
        eq(agents.funding, "deposit"),
        sql`exists (select 1 from ${chainOps} where ${chainOps.agentId} = ${agents.id} and ${chainOps.kind} = 'open_vault')`,
      ),
    );
  const seat = (r: { id: string; name: string; presetName: string | null }): HouseSeat => ({
    id: r.id,
    name: r.name,
    presetName: r.presetName as PresetName,
    chips: DEPOSIT_HOUSE.chips,
  });
  const roster = existing.map(seat);
  const created: HouseSeat[] = [];
  for (const presetName of PRESET_NAMES) {
    const have = roster.filter((r) => r.presetName === presetName).length;
    for (let k = have; k < DEPOSIT_HOUSE.perPreset; k++) {
      const row = await db.transaction(async (tx) => {
        const agent = await createAgent(tx as unknown as Db, { name: nextName(), presetName, funding: "deposit" });
        // No owner, and no amount: the program opens a house vault empty,
        // and a house agent needs nothing in it.
        await tx.insert(chainOps).values({ kind: "open_vault", agentId: agent.id, owner: null, salt: agent.salt, amount: 0 });
        return agent;
      });
      const made = seat({ id: row.id, name: row.name, presetName });
      created.push(made);
      roster.push(made);
    }
  }
  return { created, roster };
}

/**
 * Retires every house agent still playing on the seed program, which is closing
 * (docs/cutover.md). House agents have no rental, so the season boundary that
 * retires the seed players never reaches them.
 *
 * Only `retired_at` changes. The ledger balance is left exactly as it is, so it
 * still matches the vault: the vault is on a program whose settler key is
 * exposed and cannot be rotated, and reconciliation keeps checking it, which
 * makes a drain show up as a shortfall rather than as a ledger that was quietly
 * zeroed first. Nothing is moved on chain - there is no owner to sign a
 * withdrawal, and the tokens were minted free.
 *
 * With `apply` false it only reports who would be retired.
 */
export async function retireSeedHouse(
  db: Db,
  options: { apply: boolean; now?: Date },
): Promise<{ id: string; name: string }[]> {
  const seedHouse = and(isNull(agents.ownerId), isNull(agents.retiredAt), eq(agents.funding, "seed"));
  if (!options.apply) {
    return db.select({ id: agents.id, name: agents.name }).from(agents).where(seedHouse);
  }
  return db
    .update(agents)
    .set({ retiredAt: options.now ?? new Date(), retiredReason: "closed" })
    .where(seedHouse)
    .returning({ id: agents.id, name: agents.name });
}
