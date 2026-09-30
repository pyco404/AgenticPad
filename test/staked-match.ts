import type { Db } from "../src/db/client.js";
import { agents, chainOps } from "../src/db/schema.js";
import { record } from "../src/db/ledger.js";
import { runMatch, type RunMatchOptions } from "../src/db/runner.js";
import { baseUnits, rateOf } from "../src/chips.js";
import { inArray } from "drizzle-orm";

/**
 * A match that settles as matches did before nothing was staked
 * (docs/no-loss-rewards.md): the match is played and recorded by the runner,
 * which moves nothing, and then its net is moved between the two ledgers and
 * queued for the chain exactly as the runner used to do it.
 *
 * Only the tests of the settlement machinery - hourly netting, the outbox's
 * settle path, reconciliation, the withdrawal lock - use it. The runner no
 * longer feeds that machinery, and it goes once it is removed; until then this
 * keeps it tested with the settlements it was built for.
 */
export async function stakedMatch(db: Db, agentAId: string, agentBId: string, options: RunMatchOptions = {}) {
  const played = await runMatch(db, agentAId, agentBId, options);
  const rows = await db.select().from(agents).where(inArray(agents.id, [agentAId, agentBId]));
  const rowA = rows.find((r) => r.id === agentAId)!;
  const rowB = rows.find((r) => r.id === agentBId)!;
  // As before: money moved only when both sides belonged to players.
  if (rowA.ownerId === null || rowB.ownerId === null) return played;
  const movedA = baseUnits(played.settled.A, rateOf(rowA));
  if (movedA === 0) return played;
  await db.transaction(async (tx) => {
    await record(tx, [
      { agentId: rowA.id, amount: movedA, reason: "match-settlement", matchId: played.match.id },
      { agentId: rowB.id, amount: -movedA, reason: "match-settlement", matchId: played.match.id },
    ]);
    const [loser, winner] = movedA > 0 ? [rowB.id, rowA.id] : [rowA.id, rowB.id];
    await tx.insert(chainOps).values({
      kind: "settle",
      matchId: played.match.id,
      fromAgent: loser,
      toAgent: winner,
      amount: Math.abs(movedA),
      netted: rowA.funding === "deposit",
    });
  });
  return played;
}

