import { holderPriceReady, liveHolderPricing, liveHolderMinimum } from "../holder-policy.js";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, elicitations, FREE_ELICITATIONS, MIN_FUNDING_CHIPS } from "./schema.js";
import { baseUnits, seasonRate } from "../chips.js";

/**
 * What an agent holds, and whether it is in play.
 *
 * Holding is the agent (docs/holder-agents.md): its owner keeps their tokens
 * in their own wallet, and an agent's balance is that wallet's last reading,
 * kept in `holdings` (src/db/holdings.ts). Nothing is deposited, staked or
 * moved, so there is no ledger of movements any more; the `ledger` table
 * stays as the history of the models before.
 *
 * Every balance read and every in-play check goes through here, so "the
 * balance" and "holds enough to play" mean one thing everywhere.
 */

type Writable = Pick<Db, "insert" | "select" | "update">;

/**
 * An agent's balance in base units, as SQL, for a row of `agents`: its owner's
 * wallet as last read, or nothing for a house agent and for agents from
 * before holding was the entry, which are all retired.
 *
 * Written with every identifier qualified by hand, for any query that has
 * `agents` in its FROM. Drizzle leaves columns unqualified in a select from a
 * single table, and inside a subquery an unqualified column can resolve to the
 * subquery's own table - which once read every balance as zero on node-postgres.
 */
export const balanceSql = () => sql<number>`(case when "agents"."funding" = 'holder'
    then coalesce((select h.amount from holdings h where h.wallet = "agents"."owner_id" and h.mint = "agents"."holder_mint"), 0)
    else 0
  end)::bigint`;

/**
 * Whether an agent holds enough to be in play, as SQL, for a row of `agents`:
 * its wallet's last reading holds the minimum - or, once its conviction clock
 * runs, its own conviction amount if that is lower (src/db/holdings.ts,
 * keeps), so a retune that raises the minimum takes out nobody who has not
 * sold. House agents are never asked: they hold nothing and need nothing.
 */
export const inPlaySql = () => {

  const minimum = liveHolderMinimum(baseUnits(MIN_FUNDING_CHIPS, seasonRate()));
  const threshold = liveHolderPricing() ? sql`${minimum}::bigint` : sql`least(coalesce(h.conviction_amount, ${minimum}::bigint), ${minimum}::bigint)`;
  const fresh = liveHolderPricing() ? sql`and h.read_at >= now() - interval '20 minutes'` : sql``;
  return sql<boolean>`(case
    when "agents"."funding" = 'holder' and "agents"."holder_mint" <> '' then coalesce((
      select h.amount >= h.minimum and h.minimum > 0
        and h.price_at >= now() - interval '15 minutes'
        and h.read_at >= now() - interval '20 minutes'
      from holdings h where h.wallet = "agents"."owner_id" and h.mint = "agents"."holder_mint"), false)
    when "agents"."funding" = 'holder' and ${holderPriceReady()} then coalesce((
      select h.amount >= ${threshold} ${fresh}
      from holdings h where h.wallet = "agents"."owner_id" and h.mint = "agents"."holder_mint"), false)
    else false
  end)`;
};

/** inPlaySql for a set of agents. */
export async function inPlayOf(db: Writable, agentIds: string[]): Promise<Map<string, boolean>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db.select({ agentId: agents.id, inPlay: inPlaySql() }).from(agents).where(inArray(agents.id, agentIds));
  return new Map(rows.map((r) => [r.agentId, Boolean(r.inPlay)]));
}

export async function balanceOf(db: Writable, agentId: string): Promise<number> {
  return (await balancesOf(db, [agentId])).get(agentId) ?? 0;
}

export async function balancesOf(db: Writable, agentIds: string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db.select({ agentId: agents.id, balance: balanceSql() }).from(agents).where(inArray(agents.id, agentIds));
  return new Map(rows.map((r) => [r.agentId, Number(r.balance)]));
}

/** A match that cannot be played: an agent retired, out of play, or no opponent. */
export class StakeError extends Error {}

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
