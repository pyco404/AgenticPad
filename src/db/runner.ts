import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { firstFreeMark } from "../marks.js";
import { newAgentId } from "../agent-id.js";
import { randomInt } from "node:crypto";
import { policyAgent, policyFromAgent, type Policy } from "../agents/policy.js";
import { maxNet, AGENTCLASH_RULES, type Stakes } from "../round.js";
import { playMatch } from "../engine.js";
import { PRESETS, PRESET_VERSION, type PresetName } from "../presets.js";
import { renderTranscript } from "../transcript.js";
import type { Agent, MatchLog } from "../types.js";
import type { PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm";
import { connect, type Db } from "./client.js";
import {
  agents,
  chainOps,
  ledger,
  matches,
  withdrawals,
  ratings,
  seasons,
  seasonStandings,
  outflowBudget,
  OUTFLOW_WINDOW_MS,
  MIN_FUNDING_CHIPS,
  MIN_STAKE,
  RATING_WINDOW,
  STARTING_BALANCE,
  WORST_MATCH,
  type AgentRow,
  type MatchRow,
  type RulesConfig,
} from "./schema.js";
import { balanceOf, balanceSql, balancesOf, record, settle, StakeError } from "./ledger.js";
import { isExiting } from "./exits.js";
import { baseUnits, chips, rateOf, type Funding } from "../chips.js";
import { utcDay } from "../chain/common.js";
import { rentalEndFor, rentalOpen, rentalOpenSql } from "./rental.js";
import { periodOf, periodStart } from "./netting.js";
import { seasonAt } from "../season.js";
import { standings, type Standing } from "./standings.js";

export const DEFAULT_RULES: RulesConfig = {
  turnOrder: AGENTCLASH_RULES.turnOrder,
  deal: AGENTCLASH_RULES.deal,
  stakes: { ...AGENTCLASH_RULES.stakes },
  presetVersion: PRESET_VERSION,
};

/** The view an agent's table is snapshotted at: the rules it will be played under. */
const snapshotView = {
  myRoundsWon: 0,
  oppRoundsWon: 0,
  roundNumber: 1,
  oppRaiseCount: 0,
  stakes: DEFAULT_RULES.stakes,
  myNet: 0,
  myActionThisRound: null,
} as const;

/** A preset's table, frozen at the shipped stakes, so transcripts replay for good. */
export const snapshotPreset = (name: PresetName): Policy => policyFromAgent(PRESETS[name], snapshotView);

const sameStakes = (a: Stakes, b: Stakes) =>
  a.ante === b.ante && a.baseBet === b.baseBet && a.raisedBet === b.raisedBet;

/**
 * Whether one set of stakes is the other at a different scale: every amount
 * multiplied by the same factor. A table prices decisions in ratios - what a
 * fold costs against what the pot pays - and those ratios are untouched by a
 * uniform scale, so the same table is correct at any scale - which is why a
 * table snapshotted while its agent played in another band, before every match
 * moved to one scale, still plays correctly. Change one amount without the
 * others and the table really would be mispriced.
 */
export function sameShape(a: Stakes, b: Stakes): boolean {
  if (a.ante <= 0 || b.ante <= 0) return sameStakes(a, b);
  const factor = b.ante / a.ante;
  return b.baseBet === a.baseBet * factor && b.raisedBet === a.raisedBet * factor;
}

/**
 * A stored table encodes decisions taken at particular prices. Playing it at
 * stakes of a different shape would silently misprice every fold, so refuse
 * instead. A different scale is not a different shape: it is the same prices.
 */
export function assertStakesMatch(row: Pick<AgentRow, "name" | "policyStakes">, stakes: Stakes): void {
  const built = row.policyStakes ?? DEFAULT_RULES.stakes;
  if (!sameShape(built, stakes)) {
    throw new Error(
      `agent ${row.name} has a table built for ante ${built.ante}/${built.baseBet}/${built.raisedBet}, ` +
        `but this match is at ante ${stakes.ante}/${stakes.baseBet}/${stakes.raisedBet}, which is not the ` +
        `same prices at a different scale; re-elicit or re-snapshot the table for these stakes`,
    );
  }
}

export type CreateAgentInput = {
  name: string;
  ownerId?: string | null;
  presetName?: PresetName;
  brief?: string;
  policyTable?: Policy;
  /** Defaults to the shipped stakes; must match the stakes matches are played at. */
  policyStakes?: Stakes;
  /** Balance to seed. Defaults to STARTING_BALANCE. Ignored on the deposit flow. */
  startingBalance?: number;
  /**
   * Which funding flow this rental is on. "seed" mints a starting balance and
   * queues the vault for the worker, which is how every agent worked before
   * deposits. "deposit" does neither: the owner's own transaction opens the
   * vault and puts the money in, so there is nothing to seed and nothing for
   * the worker to send. Its ledger row and its vault record are written when
   * that transaction lands (src/db/rentals.ts).
   */
  funding?: Funding;
  /** When the rental is taken out, which decides the season it ends with. Defaults to now. */
  now?: Date;
};

/**
 * Two agents can only stake against each other if their vaults are under the
 * same program. They are not interchangeable: each vault is a token account for
 * one mint under one program, and no instruction exists that moves tokens from
 * a vault under one to a vault under the other. A match across them would be
 * recorded, would move both ledgers, and could never settle - which is exactly
 * what happened on 2026-09-25 before this check existed.
 */
export function assertSameFlow(a: Pick<AgentRow, "name" | "funding">, b: Pick<AgentRow, "name" | "funding">): void {
  if (a.funding !== b.funding) {
    throw new StakeError(
      `${a.name} is funded by ${a.funding} and ${b.name} by ${b.funding}; their vaults are under different programs and cannot settle against each other`,
    );
  }
}

/**
 * Whether a balance in base units is enough to be in play: the $20 minimum
 * (MIN_FUNDING_CHIPS). `rate` is the agent's, from the flow it was rented
 * under, and required so a deposit-funded balance is never read as chips.
 */
export function holdsEnoughToPlay(balance: number, rate: number): boolean {
  return balance >= baseUnits(MIN_FUNDING_CHIPS, rate);
}

/**
 * Refuses a match whose result is larger than the engine says it can produce.
 *
 * Every piece of money safety downstream rests on this bound: both vaults were
 * checked against the widest net a match can produce before it was played, the
 * settlement program refuses anything above `max_settlement`, and the outflow
 * cap is sized from it. All of that was written against a comment saying the
 * engine cannot produce more. This asks the engine instead, every time.
 *
 * It should never fire. If it does, the rules have changed under the money
 * code, and refusing to record the match is the only safe answer: recording it
 * would move more than either vault was checked to cover, and queue a
 * settlement the chain would then refuse, leaving the ledger and the vaults
 * disagreeing for good.
 */
export function assertNetWithinBound(net: number, stakes: Stakes, what: string): void {
  const bound = maxNet(stakes);
  if (Math.abs(net) > bound) {
    throw new StakeError(
      `${what} produced a net of ${net} at ante ${stakes.ante}/${stakes.baseBet}/${stakes.raisedBet}, ` +
        `which can move at most ${bound}. The engine's rules and the money code disagree; nothing was recorded.`,
    );
  }
}

/** The rules every match is played under: the shipped rules, at the one scale there is. */
export const MATCH_RULES: RulesConfig = DEFAULT_RULES;

/** Writes an agent with its table snapshotted, a ratings row, and a seeded balance. */
export async function createAgent(db: Db, input: CreateAgentInput) {
  const table = input.policyTable ?? (input.presetName ? snapshotPreset(input.presetName) : undefined);
  if (!table) throw new Error(`agent ${input.name} needs a preset name or a policy table`);
  const funding = input.funding ?? "seed";
  const seed = input.startingBalance ?? STARTING_BALANCE;
  // The agent, its seeded balance and the chain op that funds its vault land
  // together, so a vault can never be owed without an agent or vice versa.
  // Its id is bound to its owner (src/agent-id.ts): the chain records that owner and no other.
  const { id, salt } = newAgentId(input.ownerId ?? null);
  return db.transaction(async (tx) => {
  const [row] = await tx
    .insert(agents)
    .values({
      id,
      name: input.name,
      presetName: input.presetName ?? null,
      brief: input.brief ?? null,
      ownerId: input.ownerId ?? null,
      policyTable: table,
      policyStakes: input.policyStakes ?? DEFAULT_RULES.stakes,
      funding,
      // A player's rental ends at the season boundary, however far into the
      // season it starts. House agents are not rented and never end, and
      // neither do holder agents: nothing is rented, holding is the entry.
      rentalEndsAt: input.ownerId && funding !== "holder" ? rentalEndFor(input.now) : null,
    })
    .returning();
  await tx.insert(ratings).values({ agentId: row!.id });
  if (funding === "seed") {
    // Renting seeds the balance: the first movement in this agent's ledger.
    await record(tx, [{ agentId: row!.id, amount: seed, reason: "rental-seed" }]);
    // Opening the vault records a player's agent's owner too: that's who can withdraw.
    await tx.insert(chainOps).values({ kind: "open_vault", agentId: row!.id, owner: row!.ownerId, salt, amount: seed });
  }
  // Its emoji, unique across all agents, chosen with the agent.
  // The salt travels back because a deposit-funded rental needs it to build the
  // transaction that opens the vault under this id.
  return { ...row!, salt, mark: await assignMark(tx as unknown as Db, row!.id) };
  });
}

/**
 * Gives an agent the first mark its id leads to that no agent has yet
 * (src/marks.ts). A unique index backs it: if a concurrent rental takes the
 * same mark first, this one moves on to its next candidate.
 */
export async function assignMark(db: Db, agentId: string): Promise<string> {
  const taken = new Set(
    (await db.select({ mark: agents.mark }).from(agents).where(isNotNull(agents.mark))).map((r) => r.mark!),
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    const mark = firstFreeMark(agentId, taken);
    try {
      // A savepoint, so a clash doesn't abort the surrounding transaction.
      await db.transaction(async (sp) => {
        await sp.update(agents).set({ mark }).where(eq(agents.id, agentId));
      });
      return mark;
    } catch (error) {
      if (!/agents_mark_unique|duplicate key|23505/.test(String((error as { cause?: unknown }).cause ?? error))) throw error;
      taken.add(mark);
    }
  }
  throw new Error(`could not give ${agentId} a unique mark`);
}

/** Marks every agent that has none, oldest first: the backfill, and harmless to run again. */
export async function assignMissingMarks(db: Db): Promise<number> {
  const missing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(isNull(agents.mark))
    .orderBy(agents.createdAt, agents.id);
  for (const { id } of missing) await assignMark(db, id);
  return missing.length;
}

/** A uint32, which is what the engine's PRNG takes. */
export const newSeed = () => randomInt(0, 4_294_967_296);

/**
 * Turns a stored agent into a playable function: a shipped preset by name, or
 * the table elicited when the agent was created. Never calls a model.
 */
export function resolveAgent(row: Pick<AgentRow, "presetName" | "policyTable" | "name">): Agent {
  // The stored table wins, for presets too: it is what the agent actually
  // played, so a retune of the shipped presets cannot rewrite old transcripts.
  if (row.policyTable !== null) return policyAgent(row.policyTable);
  if (row.presetName !== null) {
    const preset = PRESETS[row.presetName as PresetName];
    if (!preset) throw new Error(`agent ${row.name} names an unknown preset: ${row.presetName}`);
    return preset;
  }
  throw new Error(`agent ${row.name} has neither a preset nor a policy table`);
}

async function loadAgent(db: Db, id: string): Promise<AgentRow> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!row) throw new Error(`no agent ${id}`);
  return row;
}

/** Replays a stored match from its seed and rules; the log must come out identical. */
export function replayMatch(row: Pick<MatchRow, "seed" | "rulesConfig">, a: Agent, b: Agent): MatchLog {
  return playMatch(a, b, { seed: row.seed, ...row.rulesConfig });
}

export type RunMatchOptions = { seed?: number; rules?: RulesConfig };

/** Plays one match and records it, updating both ratings in the same transaction. */
export async function runMatch(db: Db, agentAId: string, agentBId: string, options: RunMatchOptions = {}) {
  const [rowA, rowB] = await Promise.all([loadAgent(db, agentAId), loadAgent(db, agentBId)]);
  const rules = options.rules ?? MATCH_RULES;
  assertStakesMatch(rowA, rules.stakes);
  assertStakesMatch(rowB, rules.stakes);
  for (const row of [rowA, rowB]) {
    if (row.retiredAt !== null) throw new StakeError(`${row.name} is retired`);
    if (!rentalOpen(row)) throw new StakeError(`${row.name}'s rental ended with the season; renew it to play`);
    // An exit is on chain for this agent and the money may be about to leave.
    // Checked here as well as at the sources that pick opponents, because this
    // is the one place every match passes through.
    if (await isExiting(db, row.id)) {
      throw new StakeError(`${row.name} has an exit waiting on chain, so it can't play until that resolves`);
    }
  }

  /**
   * Nothing is staked: a match moves no money, whoever plays it. A lost match
   * costs the owner nothing (docs/no-loss-rewards.md); what a player's agent
   * earns is points toward the reward wallets, and those come from wins.
   *
   * A match still counts - is ranked - only when both agents belong to players.
   * A house agent is a fixed preset whose weaknesses are exactly computable, so
   * a win over one measures nothing. Against a house agent the match is still
   * played, still recorded and still has a transcript; it just counts for nothing.
   */
  const ranked = rowA.ownerId !== null && rowB.ownerId !== null;
  // Nothing is at risk, but a player's agent must still hold the minimum to be
  // in play at all. A house agent holds nothing and needs nothing.
  const balances = await balancesOf(db, [rowA.id, rowB.id]);
  for (const row of [rowA, rowB]) {
    if (row.ownerId === null) continue;
    const balance = balances.get(row.id) ?? 0;
    if (!holdsEnoughToPlay(balance, rateOf(row))) {
      throw new StakeError(
        `${row.name} holds too little to play: balance ${chips(balance, rateOf(row))}, needs ${MIN_FUNDING_CHIPS}`,
      );
    }
  }
  // The widest net the match could produce, which the row records it was
  // played at. Nobody's balance is asked to cover it: nothing is staked.
  const stake = WORST_MATCH;
  const seed = options.seed ?? newSeed();
  // No display names in the log: the match row references both agents, and a
  // name-free log is exactly what a replay reproduces.
  const log = playMatch(resolveAgent(rowA), resolveAgent(rowB), { seed, ...rules });
  // The engine's own bound, asked of the engine rather than assumed by the
  // code that reads the answer. Before anything is recorded.
  assertNetWithinBound(log.nets.A, rules.stakes, `${rowA.name} against ${rowB.name}`);

  // One transaction: a recorded match and the ratings derived from it move together.
  const settledA = settle(log.nets.A);
  const match = await db.transaction(async (tx) => {
    // Lock both agents, then make sure neither has a withdrawal on its way: while
    // one is in flight the agent is on its way out, and plays again once it lands.
    await tx.execute(sql`select id from ${agents} where ${agents.id} in (${rowA.id}, ${rowB.id}) for update`);
    // Checked again under the lock, because the checks above ran before it: the
    // season may have ended, or the agent retired, while the match was played.
    // This is what makes the boundary exact - a match recorded after an
    // agent's rental ended is refused here, whether or not the boundary job
    // has run yet. `now` is also what decides the match's season.
    const now = new Date();
    for (const locked of await tx.select().from(agents).where(inArray(agents.id, [rowA.id, rowB.id]))) {
      if (locked.retiredAt !== null) throw new StakeError(`${locked.name} is retired`);
      if (!rentalOpen(locked, now)) throw new StakeError(`${locked.name}'s rental ended with the season; renew it to play`);
    }
    const busy = await tx
      .select({ agentId: withdrawals.agentId })
      .from(withdrawals)
      .where(and(inArray(withdrawals.agentId, [rowA.id, rowB.id]), eq(withdrawals.status, "submitted")));
    if (busy.length > 0) {
      const name = busy[0]!.agentId === rowA.id ? rowA.name : rowB.name;
      throw new StakeError(`${name} has a withdrawal on its way; it can play again once that lands`);
    }
    const [inserted] = await tx
      .insert(matches)
      .values({
        agentA: rowA.id,
        agentB: rowB.id,
        seed,
        rulesConfig: rules,
        winner: log.winner,
        netA: settledA,
        netB: -settledA,
        stake,
        // Both sides player-rented, decided here and stored, so a later sale
        // cannot change what this match counted for.
        ranked,
        exhibition: !ranked,
        season: seasonAt(now).key,
        log,
        createdAt: now,
      })
      .returning();
    await updateRating(tx, rowA.id);
    await updateRating(tx, rowB.id);
    return inserted!;
  });
  // Nobody is retired by a match any more: nothing is lost, so nobody goes broke.
  const retired: string[] = [];
  return { match, log, stake, settled: { A: settledA, B: -settledA }, retired };
}

/**
 * An exhibition between two house agents: played by the same engine and stored
 * as a match, with a transcript and a share page, but nothing moves. No ledger
 * rows, no chain op, no rating update. The stake is what the two could have
 * covered, so its numbers read like any match; the row is flagged so every
 * view can say it was an exhibition.
 */
export async function runExhibition(db: Db, agentAId: string, agentBId: string, options: { seed?: number } = {}) {
  const [rowA, rowB] = await Promise.all([loadAgent(db, agentAId), loadAgent(db, agentBId)]);
  for (const row of [rowA, rowB]) {
    if (row.ownerId !== null) throw new StakeError(`${row.name} is not a house agent`);
    if (row.retiredAt !== null) throw new StakeError(`${row.name} is retired`);
  }
  if (rowA.id === rowB.id) throw new StakeError("an agent cannot play itself");
  const rules = MATCH_RULES;
  // Nothing moves in an exhibition, so nothing is asked of either balance:
  // house agents need none. The stake is the widest net a match can produce,
  // which is what the match row shows so it reads like any other.
  const stake = WORST_MATCH;
  assertSameFlow(rowA, rowB);
  const seed = options.seed ?? newSeed();
  const log = playMatch(resolveAgent(rowA), resolveAgent(rowB), { seed, ...rules });
  // The engine's own bound, asked of the engine rather than assumed by the
  // code that spends the answer. Before anything is recorded or moved.
  assertNetWithinBound(log.nets.A, rules.stakes, `${rowA.name} against ${rowB.name}`);
  const settledA = settle(log.nets.A);
  const [match] = await db
    .insert(matches)
    .values({
      agentA: rowA.id,
      agentB: rowB.id,
      seed,
      rulesConfig: rules,
      winner: log.winner,
      netA: settledA,
      netB: -settledA,
      stake,
      log,
      exhibition: true,
      season: seasonAt(new Date()).key,
    })
    .returning();
  return { match: match!, log };
}

/**
 * Recomputes an agent's rating from its own matches: the mean net over the last
 * RATING_WINDOW, and how many it has played. Derived, so it cannot drift.
 */
/**
 * A listed row's balance in chips.
 *
 * Balances are the one money figure in these lists that is in an agent's own
 * units - everything else comes from match nets, which are chips whatever flow
 * the agent is on. Side by side on one page a base-unit balance beside a chip
 * one reads as a million times richer, so each row converts at its own rate.
 */
export function listedInChips<T extends { balance: number; funding: Funding }>(row: T): T {
  return { ...row, balance: chips(Number(row.balance), rateOf(row)) };
}

export async function updateRating(db: Db | PgTransaction<PgQueryResultHKT, Record<string, never>, TablesRelationalConfig>, agentId: string): Promise<void> {
  const raw = sql<number>`case when ${matches.agentA} = ${agentId} then ${matches.netA} else ${matches.netB} end`;
  // Every match is played at one scale, so a chip is a chip and nothing is
  // normalised: the ranked figures and recent form sum the same nets as the total.
  // Exhibitions stake nothing, so they say nothing about how an agent does for money.
  const played = and(or(eq(matches.agentA, agentId), eq(matches.agentB, agentId)), eq(matches.exhibition, false));

  // seq is monotonic, so "the last RATING_WINDOW" is unambiguous even when many
  // matches share a timestamp.
  const recent = await db.select({ net: raw }).from(matches).where(played).orderBy(desc(matches.seq)).limit(RATING_WINDOW);
  const totals = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${raw}), 0)::int` })
    .from(matches)
    .where(played);

  // The ladder's figures: player-versus-player matches only. Kept apart rather than replacing the totals above, because
  // an owner who beat the house still earned that money and should be able to
  // see it - what they did not earn is a place on the ladder for it.
  const rankedOnly = and(played, eq(matches.ranked, true));
  const ranked = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${raw}), 0)::int`,
      // What the ladder's net-per-chip-staked figure divides by, until the
      // no-loss score replaces it.
      staked: sql<number>`coalesce(sum(${matches.stake}), 0)::int`,
    })
    .from(matches)
    .where(rankedOnly);

  const window = recent.map((r) => Number(r.net));
  const rolling = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
  const set = {
    matchesPlayed: totals[0]?.n ?? 0,
    cumulativeNet: Number(totals[0]?.total ?? 0),
    rankedMatches: ranked[0]?.n ?? 0,
    rankedNet: Number(ranked[0]?.total ?? 0),
    rankedStaked: Number(ranked[0]?.staked ?? 0),
    rollingNet50: rolling,
    updatedAt: new Date(),
  };
  await db.insert(ratings).values({ agentId, ...set }).onConflictDoUpdate({ target: ratings.agentId, set });
}

export type OpponentPick = {
  opponentId: string;
  /** Which path matchmaking took, for the log. */
  path: "closest-rating" | "preset-fallback";
  candidates: number;
  ratingGap: number | null;
};

export type PickOpponentOptions = {
  /**
   * Whether a house agent will do when no player is free.
   *
   * Autoplay says no and waits. A match against a house agent is an exhibition
   * now - nothing is staked and nothing counts - so filling the queue with them
   * would give an owner a week of matches that earned nothing and meant
   * nothing, which is not what autoplay promises. Pressing play says yes,
   * because trying an agent out against the house is the point of that button.
   */
  allowHouse?: boolean;
  /** Below this many candidates, fall back to a preset agent. Default 4. */
  minCandidates?: number;
  onLog?: (pick: OpponentPick & { agentId: string }) => void;
  /**
   * Prefer opponents this agent has not just played. Autoplay sets this: it
   * picks by closest rating, which is deterministic, so without it the same
   * pairing would repeat every ten minutes and pile onto one vault's window.
   */
  spread?: boolean;
};

/** How many recent matches the spread penalty looks back over. */
const RECENT_OPPONENTS = 6;
/**
 * What one recent meeting costs an opponent in rating distance. Large enough
 * to break a tie between similarly rated agents, small enough that it never
 * pairs a cautious agent with the boldest on the roster to avoid a repeat.
 */
const RECENT_OPPONENT_PENALTY = 0.05;

/** Who this agent has played lately, and how often, most recent matches first. */
async function recentOpponents(db: Db, agentId: string, limit: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ a: matches.agentA, b: matches.agentB })
    .from(matches)
    .where(and(or(eq(matches.agentA, agentId), eq(matches.agentB, agentId)), eq(matches.exhibition, false)))
    .orderBy(desc(matches.seq))
    .limit(limit);
  const met = new Map<string, number>();
  for (const r of rows) {
    const other = r.a === agentId ? r.b : r.a;
    met.set(other, (met.get(other) ?? 0) + 1);
  }
  return met;
}

/**
 * What a vault has already committed to pay out inside the chain's window, as
 * SQL. Matches whatever became of them: pending and netted are money the chain
 * will be asked for, and a failed one is money it refused, which is the
 * situation this is here to avoid rather than a reason to try again.
 *
 * On the deposit flow, this hour's **net** loss. The hour's matches settle as
 * one net payment, sent once the hour is over, so what the program's window
 * will be asked for is the net of this hour alone - wins count against losses,
 * and an earlier hour went out in a window of its own.
 *
 * On the seed flow, every loss in the trailing window: that program settles
 * match by match, in a window of ten minutes that no rolling one can line up
 * with (schema.ts, OUTFLOW_WINDOW_MS).
 */
const committedOutflow = (agentId: unknown, funding: Funding) => {
  if (funding === "deposit") {
    const hour = periodStart(periodOf(new Date())).toISOString();
    return sql<number>`greatest(0, coalesce((
      select sum(case when ${chainOps.fromAgent} = ${agentId} then ${chainOps.amount} else -${chainOps.amount} end)::bigint
      from ${chainOps}
      where ${chainOps.kind} = 'settle'
        and ${chainOps.status} <> 'failed'
        and (${chainOps.fromAgent} = ${agentId} or ${chainOps.toAgent} = ${agentId})
        and ${chainOps.createdAt} >= ${hour}
    ), 0))`;
  }
  return sql<number>`coalesce((
    select sum(${chainOps.amount})::bigint from ${chainOps}
    where ${chainOps.kind} = 'settle'
      and ${chainOps.fromAgent} = ${agentId}
      and ${chainOps.status} <> 'failed'
      and ${chainOps.createdAt} > now() - interval '${sql.raw(String(Math.round(OUTFLOW_WINDOW_MS / 1000)))} seconds'
  ), 0)`;
};

/**
 * An agent's net loss on one UTC day, in base units, as SQL: what it has lost
 * in settlements dated that day less what it has won. Built from the settle
 * ops themselves - pending and confirmed, not failed - because those are
 * exactly what the program will charge to that day's bucket, whenever they land.
 */
const netLossOn = (agentId: unknown, day: number) => {
  const start = new Date(day * 86_400_000).toISOString();
  const end = new Date((day + 1) * 86_400_000).toISOString();
  return sql<number>`coalesce((
    select sum(case when ${chainOps.fromAgent} = ${agentId} then ${chainOps.amount} else -${chainOps.amount} end)::bigint
    from ${chainOps}
    where ${chainOps.kind} = 'settle'
      and ${chainOps.status} <> 'failed'
      and (${chainOps.fromAgent} = ${agentId} or ${chainOps.toAgent} = ${agentId})
      and ${chainOps.createdAt} >= ${start} and ${chainOps.createdAt} < ${end}
  ), 0)`;
};

/**
 * The owner's loss budget that applies on `day`, in base units, or null when
 * the agent has none. Mirrors `limit_for` in the program: a cut applies from
 * its day, and before it the old limit stands.
 */
export function lossBudgetOn(
  row: Pick<AgentRow, "lossBudget" | "lossBudgetNext" | "lossBudgetNextFromDay">,
  day: number,
): number | null {
  if (row.lossBudget === null) return null;
  if (row.lossBudgetNextFromDay !== null && row.lossBudgetNext !== null && day >= row.lossBudgetNextFromDay) {
    return row.lossBudgetNext;
  }
  return row.lossBudget;
}

/** Whether losing `worst` more base units today would stay inside the budget. Null budget: always. */
const withinBudget = (budget: number | null, lostToday: number, worst: number) =>
  budget === null || Number(lostToday) + worst <= budget;

/**
 * Whether this agent can lose `worstMatch` today without passing its owner's
 * daily loss budget. The program refuses a settlement that would, so the ledger
 * declines the pairing first - otherwise a match the ledger had recorded would
 * be one the chain would never take.
 */
export async function hasBudgetRoom(db: Db, agentId: string, worstMatch: number, now = new Date()): Promise<boolean> {
  const today = utcDay(now);
  const [row] = await db
    .select({
      funding: agents.funding,
      lossBudget: agents.lossBudget,
      lossBudgetNext: agents.lossBudgetNext,
      lossBudgetNextFromDay: agents.lossBudgetNextFromDay,
      lost: netLossOn(agentId, today),
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!row) return false;
  return withinBudget(lossBudgetOn(row, today), Number(row.lost), baseUnits(worstMatch, rateOf(row)));
}

/** What an agent has lost, net, today, in base units. For the owner's view. */
export async function lostToday(db: Db, agentId: string, now = new Date()): Promise<number> {
  const [row] = await db.select({ lost: netLossOn(agentId, utcDay(now)) }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return Number(row?.lost ?? 0);
}

/**
 * Whether this agent could lose `worstMatch` without pushing its vault past
 * what the chain will let it pay out in one window.
 *
 * The program caps a vault's outflow per window and re-reads the cap from the
 * balance before each transfer, so the cap falls as the vault pays. If several
 * autoplayers all pick the same popular opponent inside one window and it
 * loses, the ledger records every loss and the chain refuses the ones past the
 * cap: the money is still right, but the ledger and the chain stop agreeing
 * and the reconciler has to report it.
 *
 * So the ledger declines the pairing first. This is a smoothing measure, not a
 * safety one - the program's cap is the guarantee, and this only keeps us from
 * walking into it.
 */
export async function hasOutflowRoom(db: Db, agentId: string, worstMatch: number): Promise<boolean> {
  const [agent] = await db.select({ funding: agents.funding }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return false;
  const rate = rateOf(agent);
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${ledger.amount})::bigint, 0)`, spent: committedOutflow(agentId, agent.funding) })
    .from(ledger)
    .where(eq(ledger.agentId, agentId));
  const balance = Number(row?.balance ?? 0);
  const spent = Number(row?.spent ?? 0);
  return spent + baseUnits(worstMatch, rate) <= outflowBudget(balance, rate);
}

/**
 * Picks the closest-rated active opponent that has played recently and does not
 * share an owner. Falls back to a preset agent so a queue never stalls.
 */
export async function pickOpponent(db: Db, agentId: string, options: PickOpponentOptions = {}): Promise<OpponentPick> {
  const minCandidates = options.minCandidates ?? 4;
  const me = await loadAgent(db, agentId);
  if (!rentalOpen(me)) throw new StakeError(`${me.name}'s rental ended with the season; renew it to play`);
  const mine = me.trueRating ?? 0;

  // Paired on true rating: the only signal here that is not noise. No recency
  // gate, so a cold roster can bootstrap.
  // Holding enough to be in play, in this agent's units. Candidates are all on
  // the same flow as `me` (below), so one rate applies to every row here - a
  // chip figure compared against a base-unit sum would call a vault holding
  // fifty base units enough for a fifty-chip minimum.
  const myRate = rateOf(me);
  // A holder agent's balance is its owner's wallet, everyone else's their ledger (balanceSql).
  const solvent = sql`${balanceSql()} >= ${baseUnits(MIN_FUNDING_CHIPS, myRate)}`;

  // A player looking for a match that counts needs another player. A house
  // opponent counts for nothing, so it is only ever offered when the caller asked for one.
  const houseAllowed = options.allowHouse === true || me.ownerId === null;

  const all = await db
    .select({
      id: agents.id,
      ownerId: agents.ownerId,
      presetName: agents.presetName,
      rating: agents.trueRating,
      // Each candidate's own unit: its funding flow decides how many base
      // units a chip of its balance is.
      funding: agents.funding,
    })
    .from(agents)
    .where(
      and(
        ne(agents.id, agentId),
        // A house agent never stakes, so it needs no balance to be offered.
        // Players still hold the minimum to be in play.
        or(isNull(agents.ownerId), solvent),
        isNull(agents.retiredAt),
        // An expired agent is not matchable: it could not be recorded anyway.
        rentalOpenSql(),
        // Two agents with no owner are not the same owner.
        me.ownerId === null ? sql`true` : or(isNull(agents.ownerId), ne(agents.ownerId, me.ownerId)),
        // Only agents whose vault is under the same program. Different programs
        // hold different mints, so a match across them could never settle.
        eq(agents.funding, me.funding),
        // House agents only when the caller asked for one: a match against one
        // stakes nothing and counts for nothing.
        houseAllowed ? sql`true` : isNotNull(agents.ownerId),
        // Not one with a withdrawal on its way: it can't play until that lands.
        sql`not exists (select 1 from ${withdrawals} where ${withdrawals.agentId} = ${agents.id} and ${withdrawals.status} = 'submitted')`,
      ),
    );

  // Nothing is staked, so neither side's vault or loss budget has anything to say
  // about a pairing: every candidate above can play.
  const candidates = all;

  if (candidates.length >= minCandidates) {
    // Closest rating is the signal. With `spread`, an opponent met in the last
    // few matches is pushed down it, so a timer that fires every ten minutes
    // does not keep serving the same pairing.
    const recent = options.spread ? await recentOpponents(db, agentId, RECENT_OPPONENTS) : new Map<string, number>();
    const distance = (c: (typeof candidates)[number]) =>
      Math.abs((c.rating ?? 0) - mine) + (recent.get(c.id) ?? 0) * RECENT_OPPONENT_PENALTY;
    const best = candidates.reduce((closest, c) => (distance(c) < distance(closest) ? c : closest));
    const pick: OpponentPick = {
      opponentId: best.id,
      path: "closest-rating",
      candidates: candidates.length,
      ratingGap: Math.abs((best.rating ?? 0) - mine),
    };
    options.onLog?.({ ...pick, agentId });
    return pick;
  }

  // Fall back to a preset agent, so a thin queue does not
  // silently put a cautious agent in with the boldest on the roster.
  //
  // Drawn from `candidates`, not from a query of its own. An earlier version
  // ran a separate, looser query here that skipped the pending-withdrawal
  // check, so the one path meant to guarantee an opponent was the one path
  // that could pair into a refusal. Everything in `candidates` has already
  // passed every check above, including the owner check.
  const presets = candidates.filter((c) => c.presetName !== null);
  const preset = presets.length ? presets[randomInt(presets.length)] : undefined;
  if (!preset) {
    throw new StakeError(
      !houseAllowed
        ? `no opponent right now: no other player's agent is ready. ${me.name} only meets other players' agents here - press Play to take on a house agent, or wait.`
        : me.funding === "deposit"
          ? `no opponent for ${me.name} yet: it plays only other agents you fund yourself, and no other one is ready. Try again later.`
          : `no opponent right now. Try again later.`,
    );
  }
  const pick: OpponentPick = {
    opponentId: preset.id,
    path: "preset-fallback",
    candidates: candidates.length,
    ratingGap: null,
  };
  options.onLog?.({ ...pick, agentId });
  return pick;
}

/**
 * Ranked on all-time net won: a fact, not an estimate, so every match counts and
 * there is no minimum. recentForm rides along for display and is not ranked on.
 * trueRating is deliberately absent: it is private to an agent's owner.
 */
export type LadderTab = "winnings" | "per-match";

/**
 * Which matches a ladder counts. All three rank the same thing - player-versus-
 * player matches - and differ only in the window:
 * everything (the figures `ratings` keeps), one season, or today in UTC.
 */
export type LadderPeriod = { period: "all" } | { period: "season"; season: string } | { period: "day"; since: Date };

export async function leaderboard(db: Db, limit = 50, tab: LadderTab = "winnings", window: LadderPeriod = { period: "all" }) {
  if (window.period !== "all") return periodLeaderboard(db, limit, tab, window);
  // Ranked figures only. Every number the ladder sorts by is player-versus-
  // player; the totals ride along beside them so an owner can see that their
  // winnings against the house are still there and simply do not count.
  const netPerMatch = sql<number>`case when ${ratings.rankedMatches} = 0 then 0
    else ${ratings.rankedNet}::double precision / ${ratings.rankedMatches} end`;
  const balance = balanceSql();
  const rows = db
    .select({
      agentId: agents.id,
      name: agents.name,
      presetName: agents.presetName,
      mark: agents.mark,
      // What the ladder ranks on.
      matchesPlayed: ratings.rankedMatches,
      cumulativeNet: ratings.rankedNet,
      netPerMatch,
      rankedStaked: ratings.rankedStaked,
      // Every staked match, house included: shown, never ranked.
      totalMatches: ratings.matchesPlayed,
      totalNet: ratings.cumulativeNet,
      recentForm: ratings.rollingNet50,
      balance,
      funding: agents.funding,
      // Retired agents stay on the ladder, marked: a record is history, not hidden.
      retired: sql<boolean>`${agents.retiredAt} is not null`,
    })
    .from(ratings)
    .innerJoin(agents, eq(agents.id, ratings.agentId));

  // Players only. A house agent can never rank - every match it plays is
  // against a player and so unranked, or against the house and an exhibition -
  // so listing one would only put a permanent zero between real players.
  const players = isNotNull(agents.ownerId);
  // "Per match" needs a match to divide by; that is arithmetic, not a skill bar.
  const listed =
    tab === "winnings"
      ? rows.where(players).orderBy(desc(ratings.rankedNet)).limit(limit)
      : rows.where(and(players, gt(ratings.rankedMatches, 0))).orderBy(desc(netPerMatch)).limit(limit);
  return (await listed).map(listedInChips);
}

/**
 * A season's or a day's ladder. A closed season reads its frozen standings -
 * final placement, which nothing may recompute - and anything still running
 * is counted live from its matches. The rows have the all-time ladder's shape,
 * so every view renders the same way.
 */
async function periodLeaderboard(
  db: Db,
  limit: number,
  tab: LadderTab,
  window: Exclude<LadderPeriod, { period: "all" }>,
) {
  let rows: Standing[];
  const [closed] =
    window.period === "season"
      ? await db.select({ status: seasons.status }).from(seasons).where(eq(seasons.key, window.season)).limit(1)
      : [];
  if (window.period === "season" && closed?.status === "closed") {
    rows = (
      await db
        .select({
          agentId: agents.id,
          name: agents.name,
          presetName: agents.presetName,
          mark: agents.mark,
          retired: sql<boolean>`${agents.retiredAt} is not null`,
          rankedMatches: seasonStandings.rankedMatches,
          rankedNet: seasonStandings.rankedNet,
          rankedStaked: seasonStandings.rankedStaked,
          rankedNetReal: seasonStandings.rankedNetReal,
          totalMatches: seasonStandings.totalMatches,
          totalNet: seasonStandings.totalNet,
        })
        .from(seasonStandings)
        .innerJoin(agents, eq(agents.id, seasonStandings.agentId))
        .where(eq(seasonStandings.season, window.season))
        .orderBy(seasonStandings.rank)
    ).map((r) => ({
      ...r,
      rankedNet: Number(r.rankedNet),
      rankedStaked: Number(r.rankedStaked),
      rankedNetReal: Number(r.rankedNetReal),
      totalNet: Number(r.totalNet),
    }));
  } else {
    rows = await standings(db, window.period === "season" ? { season: window.season } : { since: window.since });
  }

  const perMatch = (r: Standing) => (r.rankedMatches === 0 ? 0 : r.rankedNet / r.rankedMatches);
  const ranked = tab === "winnings" ? rows : rows.filter((r) => r.rankedMatches > 0).sort((a, b) => perMatch(b) - perMatch(a));
  const shown = ranked.slice(0, limit);
  if (shown.length === 0) return [];

  // Balance and recent form are the agent's now, whatever the window.
  const ids = shown.map((r) => r.agentId);
  const balances = await balancesOf(db, ids);
  const forms = new Map(
    (await db.select({ id: ratings.agentId, form: ratings.rollingNet50 }).from(ratings).where(inArray(ratings.agentId, ids))).map((r) => [r.id, r.form]),
  );
  return shown.map((r) => ({
    agentId: r.agentId,
    name: r.name,
    presetName: r.presetName,
    mark: r.mark,
    matchesPlayed: r.rankedMatches,
    cumulativeNet: r.rankedNet,
    netPerMatch: perMatch(r),
    rankedStaked: r.rankedStaked,
    totalMatches: r.totalMatches,
    totalNet: r.totalNet,
    recentForm: forms.get(r.agentId) ?? 0,
    balance: balances.get(r.agentId) ?? 0,
    retired: r.retired,
  }));
}

/**
 * A stored match as prose. Loads the log and the two names; the renderer sees
 * nothing else, so a transcript cannot leak a brief or a table.
 */
export async function renderStoredTranscript(db: Db, matchId: string): Promise<string> {
  const [row] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!row) throw new Error(`no match ${matchId}`);
  const [a] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, row.agentA)).limit(1);
  const [b] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, row.agentB)).limit(1);
  return renderTranscript(row.log, { A: a?.name ?? "A", B: b?.name ?? "B" });
}

/** What anyone may see about someone else's agent: no true rating, no brief. */
/** The columns every public view of an agent shows. */
const publicAgentColumns = {
  agentId: agents.id,
  name: agents.name,
  presetName: agents.presetName,
  mark: agents.mark,
  createdAt: agents.createdAt,
  retiredAt: agents.retiredAt,
  // Every staked match: the agent's money.
  matchesPlayed: ratings.matchesPlayed,
  cumulativeNet: ratings.cumulativeNet,
  // Player-versus-player only: what the ladder counts. Already public there.
  rankedMatches: ratings.rankedMatches,
  rankedNet: ratings.rankedNet,
  recentForm: ratings.rollingNet50,
  /** Base units. The unit is `funding`'s to say, so it travels beside it. */
  balance: balanceSql(),
  funding: agents.funding,
  retired: sql<boolean>`${agents.retiredAt} is not null`,
  /** A house agent: unowned, seeded so a first player has someone to meet. */
  house: sql<boolean>`${agents.ownerId} is null`,
};

export async function publicAgent(db: Db, agentId: string) {
  const [row] = await db
    .select(publicAgentColumns)
    .from(agents)
    .leftJoin(ratings, eq(ratings.agentId, agents.id))
    .where(eq(agents.id, agentId))
    .limit(1);
  return row;
}

/**
 * Every agent this wallet owns, the ones still playing first and the newest of
 * those first. An owner holds one active agent at a time, but they keep their
 * retired ones: a record is the point of renting, and it outlives the agent.
 */
export async function agentsOf(db: Db, ownerId: string) {
  return db
    .select(publicAgentColumns)
    .from(agents)
    .leftJoin(ratings, eq(ratings.agentId, agents.id))
    .where(eq(agents.ownerId, ownerId))
    .orderBy(sql`${agents.retiredAt} is not null`, desc(agents.createdAt));
}

/** The agents this wallet still has in play. */
export async function activeAgentsOf(db: Db, ownerId: string) {
  return db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.ownerId, ownerId), isNull(agents.retiredAt)));
}

/** The owner's own view, which does include the private rating. */
export async function ownerAgent(db: Db, agentId: string, ownerId: string | null) {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) return undefined;
  if ((row.ownerId ?? null) !== ownerId) throw new Error("agent belongs to another owner");
  return row;
}

/** Who is available to play. */
export async function roster(db: Db, options: { limit?: number } = {}) {

  const balance = balanceSql();
  const rows = await db
    .select({
      agentId: agents.id,
      name: agents.name,
      presetName: agents.presetName,
      mark: agents.mark,
      matchesPlayed: ratings.matchesPlayed,
      cumulativeNet: ratings.cumulativeNet,
      recentForm: ratings.rollingNet50,
      balance,
      funding: agents.funding,
    })
    .from(agents)
    .innerJoin(ratings, eq(ratings.agentId, agents.id))
    .where(and(isNull(agents.retiredAt), rentalOpenSql()))
    .orderBy(desc(ratings.matchesPlayed))
    .limit(options.limit ?? 24);
  return rows.map(listedInChips);
}

/** How long a retired agent stays on the field, dimmed, before it leaves. */
export const FIELD_RETIRED_MS = 60_000;

/**
 * Everyone on the field: every agent in play, house included, and the
 * ones that retired in the last minute so a watcher sees them go rather than
 * vanish. Public, and only what the feed already shows of an agent. No limit
 * and no balance: this is who is here, not how they are doing, so it stays one
 * cheap read however many agents there are.
 */
export async function field(db: Db, now: Date = new Date()) {
  const since = new Date(now.getTime() - FIELD_RETIRED_MS);
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      mark: agents.mark,
      presetName: agents.presetName,
      house: sql<boolean>`${agents.ownerId} is null`,
      retiredAt: agents.retiredAt,
    })
    .from(agents)
    .where(or(and(isNull(agents.retiredAt), rentalOpenSql()), gt(agents.retiredAt, since)))
    .orderBy(agents.createdAt, agents.id);
  return rows.map((r) => ({ ...r, retiredAt: r.retiredAt?.toISOString() ?? null }));
}

export { balanceOf, connect, MIN_STAKE, RATING_WINDOW, StakeError, WORST_MATCH };
