import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, chainOps } from "./schema.js";
import { exitingSql } from "./exits.js";

/**
 * Hourly net settlement (docs/economy.md, Decided).
 *
 * A staked match on the deposit flow moves the ledger at once, as every match
 * does, and writes its `settle` row as it always has - but marked `netted`,
 * and never sent on its own. Once its hour is over, a **cut** gathers that
 * hour's rows and nets them per agent: one `net` op for each agent whose hour
 * came to anything, paying into the program's clearing account if it lost and
 * out of it if it won. An agent that plays every ten minutes settles at most
 * twenty-four times a day instead of a hundred and forty-four.
 *
 * The per-match rows stay, and stay what the rest of the server reads: the
 * outflow and loss-budget mirrors count them, and a match page finds its
 * settlement through one. A row a cut has taken is `netted`; from then on its
 * agents' net ops carry it, and they are what "still settling" means.
 *
 * Every cut is zero-sum, because every row in it is: a match gives one agent
 * what it takes from the other. So a cut's payments put into clearing exactly
 * what its receipts take out, and the worker sends a cut's receipts only once
 * all its payments have landed.
 *
 * An agent whose owner is withdrawing or exiting cannot wait for the hour: a
 * withdrawal needs the vault to match the ledger, and an exit gives the server
 * a window to settle in. So those agents are cut early - their rows alone,
 * which is still zero-sum, since each row is - and everyone else's hour closes
 * as usual.
 */

/** The netting period: an hour, the same as the program's outflow window. */
export const NET_PERIOD_MS = 60 * 60 * 1000;
export const periodOf = (at: Date): number => Math.floor(at.getTime() / NET_PERIOD_MS);
export const periodStart = (period: number): Date => new Date(period * NET_PERIOD_MS);
/** The UTC day a period falls in. An hour never straddles two. */
export const dayOfPeriod = (period: number): number => Math.floor(period / 24);

/** Match rows that will settle through net ops and have not been cut yet. */
export const awaitingCut = and(eq(chainOps.kind, "settle"), eq(chainOps.netted, true), eq(chainOps.status, "pending"));

/**
 * When an op is due on chain, as SQL: at once for anything the worker sends,
 * and at the end of its hour for a match waiting to be cut. By epoch
 * arithmetic, not date_trunc, which truncates in the session's time zone.
 */
export const dueAtSql = sql<Date>`case when ${chainOps.netted} and ${chainOps.status} = 'pending'
  then to_timestamp((floor(extract(epoch from ${chainOps.createdAt}) / 3600) + 1) * 3600)
  else ${chainOps.createdAt} end`;

export type CutResult = { cuts: number; rows: number; ops: number };

/**
 * Cuts matches waiting to be netted into net ops.
 *
 * Without `agents`, every row from an hour that has ended: the hourly cut.
 * With `agents`, every row touching one of them, whatever its hour: settling
 * those agents now.
 *
 * Rows are cut by the hour they were played in, one cut per hour, so an
 * agent's payment never covers more than the hour the ledger budgeted it
 * against (runner.ts, `committedOutflow`). A backlog of hours becomes a run
 * of cuts, not one sum the program would refuse as too large.
 */
export async function cutNetSettlements(db: Db, options: { now?: Date; agents?: string[] } = {}): Promise<CutResult> {
  const now = options.now ?? new Date();
  const early = options.agents;
  const result: CutResult = { cuts: 0, rows: 0, ops: 0 };
  if (early && early.length === 0) return result;
  return db.transaction(async (tx) => {
    const which = early
      ? and(awaitingCut, or(inArray(chainOps.fromAgent, early), inArray(chainOps.toAgent, early)))
      : and(awaitingCut, lt(chainOps.createdAt, periodStart(periodOf(now))));
    const rows = await tx
      .select({
        id: chainOps.id,
        fromAgent: chainOps.fromAgent,
        toAgent: chainOps.toAgent,
        amount: chainOps.amount,
        createdAt: chainOps.createdAt,
      })
      .from(chainOps)
      .where(which)
      .orderBy(asc(chainOps.seq))
      .for("update");
    if (rows.length === 0) return result;

    const involved = [...new Set(rows.flatMap((r) => [r.fromAgent!, r.toAgent!]))].sort();
    // Batch numbers are per agent and must follow on exactly from the last,
    // so the agents are held while they are counted.
    await tx.execute(sql`select id from ${agents} where ${inArray(agents.id, involved)} for update`);
    const last = new Map<string, number>();
    const numbered = await tx
      .select({ agentId: chainOps.agentId, batch: sql<number>`max(${chainOps.batch})` })
      .from(chainOps)
      .where(and(eq(chainOps.kind, "net"), inArray(chainOps.agentId, involved)))
      .groupBy(chainOps.agentId);
    for (const n of numbered) last.set(n.agentId!, Number(n.batch));

    const byPeriod = new Map<number, typeof rows>();
    for (const r of rows) {
      const p = periodOf(r.createdAt);
      byPeriod.set(p, [...(byPeriod.get(p) ?? []), r]);
    }
    for (const period of [...byPeriod.keys()].sort((a, b) => a - b)) {
      const group = byPeriod.get(period)!;
      const cut = randomUUID();
      const net = new Map<string, number>();
      for (const r of group) {
        net.set(r.toAgent!, (net.get(r.toAgent!) ?? 0) + r.amount);
        net.set(r.fromAgent!, (net.get(r.fromAgent!) ?? 0) - r.amount);
      }
      // Payments first, so they come first in the outbox as well.
      const moving = [...net].filter(([, n]) => n !== 0).sort(([a, x], [b, y]) => Math.sign(x) - Math.sign(y) || a.localeCompare(b));
      for (const [agentId, n] of moving) {
        const batch = (last.get(agentId) ?? 0) + 1;
        last.set(agentId, batch);
        await tx.insert(chainOps).values({
          kind: "net",
          agentId,
          // Who pays: set for a payment, so every query that asks "what has
          // this agent paid out" finds it where it finds a match's loser.
          fromAgent: n < 0 ? agentId : null,
          toAgent: n > 0 ? agentId : null,
          amount: Math.abs(n),
          cut,
          batch,
          day: dayOfPeriod(period),
          createdAt: now,
        });
        result.ops++;
      }
      await tx
        .update(chainOps)
        .set({ status: "netted", cut, updatedAt: now })
        .where(inArray(chainOps.id, group.map((r) => r.id)));
      result.cuts++;
      result.rows += group.length;
    }
    return result;
  });
}

/**
 * Agents that should settle now rather than on the hour: exiting, or with an
 * owner who has asked for their money, and with matches waiting to be cut.
 */
export async function agentsToSettleEarly(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        or(isNotNull(agents.settleRequestedAt), exitingSql),
        sql`exists (select 1 from ${chainOps} where ${awaitingCut} and (${chainOps.fromAgent} = ${agents.id} or ${chainOps.toAgent} = ${agents.id}))`,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Asks for an agent's matches to settle now. Its owner wants their money, and
 * a withdrawal needs the vault to agree with the ledger, which an agent with
 * matches waiting for their hour does not.
 */
export async function requestEarlySettlement(db: Db, agentId: string, now = new Date()): Promise<boolean> {
  const [waiting] = await db
    .select({ id: chainOps.id })
    .from(chainOps)
    .where(and(awaitingCut, or(eq(chainOps.fromAgent, agentId), eq(chainOps.toAgent, agentId))))
    .limit(1);
  if (!waiting) return false;
  await db.update(agents).set({ settleRequestedAt: now }).where(eq(agents.id, agentId));
  return true;
}

/**
 * One pass of the cutter: every hour that has ended, then whoever cannot wait.
 * The worker runs this before it drains the outbox.
 */
export async function cutDue(db: Db, now = new Date()): Promise<CutResult> {
  const hourly = await cutNetSettlements(db, { now });
  const early = await agentsToSettleEarly(db);
  const soon = await cutNetSettlements(db, { now, agents: early });
  // Every request is answered by this pass: settled now, or had nothing waiting.
  await db.update(agents).set({ settleRequestedAt: null }).where(isNotNull(agents.settleRequestedAt));
  return { cuts: hourly.cuts + soon.cuts, rows: hourly.rows + soon.rows, ops: hourly.ops + soon.ops };
}
