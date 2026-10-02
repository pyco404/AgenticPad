import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, elicitations, ledger, FREE_ELICITATIONS, MIN_STAKE, type LedgerReason } from "./schema.js";

/**
 * Money. Balances are derived from the ledger, never accumulated in a column,
 * so a balance is always the sum of movements that actually happened.
 */

export type Movement = { agentId: string; amount: number; reason: LedgerReason; matchId?: string; withdrawalId?: string };

type Writable = Pick<Db, "insert" | "select" | "update">;

export async function record(db: Writable, movements: Movement[]): Promise<void> {
  if (movements.length === 0) return;
  await db.insert(ledger).values(
    movements.map((m) => ({
      agentId: m.agentId,
      amount: m.amount,
      reason: m.reason,
      ...(m.matchId ? { matchId: m.matchId } : {}),
      ...(m.withdrawalId ? { withdrawalId: m.withdrawalId } : {}),
    })),
  );
}

/**
 * An agent's balance in base units, as SQL, for a row of `agents`.
 *
 * Two kinds of agent hold money in two different places. A seed or deposit
 * agent's balance is the sum of its ledger movements. A holder agent has no
 * ledger and no vault: its balance is what its owner's wallet holds, as last
 * read off chain (src/db/holdings.ts). Every balance read goes through here,
 * so a check written against "the balance" - the minimum to play, the
 * matchmaker's candidates, an owner's card - means the right thing for both.
 *
 * Written with every identifier qualified by hand, for any query that has
 * `agents` in its FROM. Drizzle leaves columns unqualified in a select from a
 * single table, and inside the ledger subquery an unqualified "id" is the
 * ledger row's own id - which read every balance as zero on node-postgres.
 */
export const balanceSql = () => sql<number>`(case when "agents"."funding" = 'holder'
    then coalesce((select h.amount from holdings h where h.wallet = "agents"."owner_id"), 0)
    else coalesce((select sum(l.amount) from ledger l where l.agent_id = "agents"."id"), 0)
  end)::bigint`;

export async function balanceOf(db: Writable, agentId: string): Promise<number> {
  return (await balancesOf(db, [agentId])).get(agentId) ?? 0;
}

export async function balancesOf(db: Writable, agentIds: string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db
    .select({ agentId: agents.id, balance: balanceSql() })
    .from(agents)
    .where(inArray(agents.id, agentIds));
  return new Map(rows.map((r) => [r.agentId, Number(r.balance)]));
}

/** An agent's whole history of movements, newest first. */
export async function statement(db: Db, agentId: string, limit = 50) {
  return db
    .select({ amount: ledger.amount, reason: ledger.reason, matchId: ledger.matchId, at: ledger.createdAt })
    .from(ledger)
    .where(eq(ledger.agentId, agentId))
    .orderBy(sql`${ledger.seq} desc`)
    .limit(limit);
}

export class StakeError extends Error {}

/**
 * A match's net in chips, as the match row records it. Nothing is clamped: the
 * engine cannot produce a net beyond the band's worst match. It moves no money.
 */
export const settle = (net: number): number => net;

/** How many model calls this owner has had, and whether the next one is free. */
export async function elicitationCount(db: Writable, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(elicitations)
    .where(eq(elicitations.ownerId, ownerId));
  return Number(row?.n ?? 0);
}

export async function isFirstElicitationFree(db: Writable, ownerId: string): Promise<boolean> {
  return (await elicitationCount(db, ownerId)) < FREE_ELICITATIONS;
}

export async function recordElicitation(
  db: Writable,
  input: { ownerId: string; kind: "preview" | "rent"; free: boolean },
): Promise<void> {
  await db.insert(elicitations).values(input);
}

export { MIN_STAKE };
