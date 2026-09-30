import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { agents, chainOps, exits } from "../src/db/schema.js";
import { balanceOf, record } from "../src/db/ledger.js";
import { createAgent, hasOutflowRoom } from "../src/db/runner.js";
import { stakedMatch } from "./staked-match.js";
import { cutDue, cutNetSettlements, NET_PERIOD_MS } from "../src/db/netting.js";
import { withdrawable } from "../src/db/withdrawals.js";
import { drainChainOps, reconcile, settlementLag, settlementStatus, solvency } from "../src/chain/worker.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { someWallet } from "./helpers.js";
import { FakeChain } from "./fake-chain.js";

const RATE = DEVNET_CHIP_RATE;
/** An hour from now: every match played in this test has had its hour end. */
const nextHour = () => new Date(Date.now() + NET_PERIOD_MS);

async function fresh(): Promise<Db> {
  const { db } = await connect();
  await migrate(db);
  return db;
}

/**
 * A rented deposit-flow agent with its vault open and funded, as a confirmed
 * rental leaves one: the ledger and the vault both hold the deposit.
 */
async function depositAgent(db: Db, chain: FakeChain, name: string, presetName: "Anchor" | "Bully" | "Mirage" | "Hammer", chips = 4_500) {
  const agent = await createAgent(db, { name, presetName, ownerId: someWallet(), funding: "deposit" });
  const amount = baseUnits(chips, RATE);
  await record(db, [{ agentId: agent.id, amount, reason: "deposit" }]);
  await db.insert(chainOps).values({ kind: "open_vault", agentId: agent.id, owner: agent.ownerId, salt: agent.salt, amount: 0, status: "confirmed" });
  chain.vaults.set(agent.id, amount);
  return agent;
}

/** Plays until `n` matches moved money, round the roster, and returns them. */
async function play(db: Db, roster: { id: string }[], n: number) {
  const played = [];
  for (let seed = 1; played.length < n && seed < 500; seed++) {
    const [a, b] = [roster[seed % roster.length]!, roster[(seed + 1) % roster.length]!];
    const m = await stakedMatch(db, a.id, b.id, { seed });
    if (m.settled.A !== 0) played.push(m);
  }
  return played;
}

async function roster(db: Db, chain: FakeChain) {
  return [
    await depositAgent(db, chain, "Ada", "Anchor"),
    await depositAgent(db, chain, "Bo", "Bully"),
    await depositAgent(db, chain, "Cy", "Mirage"),
    await depositAgent(db, chain, "Di", "Hammer"),
  ];
}

describe("hourly net settlement", () => {
  it("never sends a deposit-flow match on its own, and sends nothing until its hour is over", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 6);

    const rows = await db.select().from(chainOps).where(eq(chainOps.kind, "settle"));
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.netted)).toBe(true);

    // This hour is still open: nothing to cut, nothing to send.
    expect(await cutDue(db)).toEqual({ cuts: 0, rows: 0, ops: 0 });
    const drained = await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(drained.confirmed).toBe(0);
    expect(chain.calls).toEqual([]);
    // And it is not late: a match is due when its hour ends.
    expect(await settlementLag(db)).toBe(0);
  });

  it("cuts an hour into one net per agent, payments first, adding up to nothing", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 10);

    const cut = await cutDue(db, nextHour());
    expect(cut.cuts).toBe(1);
    expect(cut.rows).toBe(10);
    const nets = await db.select().from(chainOps).where(eq(chainOps.kind, "net")).orderBy(asc(chainOps.seq));
    expect(nets.length).toBe(cut.ops);
    expect(nets.length).toBeLessThanOrEqual(4);
    // One per agent, each its first.
    expect(new Set(nets.map((n) => n.agentId)).size).toBe(nets.length);
    expect(nets.every((n) => n.batch === 1)).toBe(true);
    // Every payment before any receipt.
    const firstReceipt = nets.findIndex((n) => n.toAgent !== null);
    expect(nets.slice(firstReceipt).every((n) => n.toAgent !== null)).toBe(true);
    // Zero-sum: what goes into clearing comes out of it.
    const paid = nets.filter((n) => n.fromAgent).reduce((s, n) => s + n.amount, 0);
    const received = nets.filter((n) => n.toAgent).reduce((s, n) => s + n.amount, 0);
    expect(paid).toBe(received);
    // The rows are taken, and a second cut finds nothing.
    const rows = await db.select().from(chainOps).where(eq(chainOps.kind, "settle"));
    expect(rows.every((r) => r.status === "netted" && r.cut === nets[0]!.cut)).toBe(true);
    expect((await cutDue(db, nextHour())).cuts).toBe(0);
  });

  it("leaves every vault matching the ledger and clearing empty once the nets land", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 12);
    await cutDue(db, nextHour());

    const drained = await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(drained.error).toBeNull();
    expect(chain.clearing).toBe(0);
    for (const a of four) expect(chain.vaults.get(a.id)).toBe(await balanceOf(db, a.id));
    const check = await reconcile(db, { seed: new FakeChain(), deposit: chain });
    expect(check.checked).toBe(4);
    expect(check.mismatches).toEqual([]);
    // One transfer per agent for the hour, not one per match.
    expect(chain.calls.length).toBeLessThanOrEqual(4);
  });

  it("holds a cut's receipts until all its payments have landed", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 10);
    await cutDue(db, nextHour());
    const nets = await db.select().from(chainOps).where(eq(chainOps.kind, "net"));
    const payer = nets.find((n) => n.fromAgent)!;

    // One payer's window is spent: its payment is refused, for now.
    chain.throttled.add(payer.agentId!);
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    // No receipt was even tried: clearing does not hold them yet.
    expect(chain.calls.some((c) => c.startsWith("net receive"))).toBe(false);
    expect(chain.clearing).toBe(nets.filter((n) => n.fromAgent && n.id !== payer.id).reduce((s, n) => s + n.amount, 0));

    chain.throttled.clear();
    const after = await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(after.error).toBeNull();
    expect(chain.clearing).toBe(0);
    for (const a of four) expect(chain.vaults.get(a.id)).toBe(await balanceOf(db, a.id));
  });

  it("lands each agent's hours in order, holding a later one behind an earlier", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const [a, b] = await roster(db, chain);
    // Two hours of the same pairing, cut as two.
    const [first] = await play(db, [a!, b!], 1);
    const [row] = await db.select().from(chainOps).where(eq(chainOps.matchId, first!.match.id));
    const firstLoser = row!.fromAgent === a!.id ? a! : b!;
    await cutDue(db, nextHour());
    await play(db, [a!, b!], 1);
    await cutDue(db, new Date(Date.now() + 2 * NET_PERIOD_MS));
    const nets = await db
      .select()
      .from(chainOps)
      .where(and(eq(chainOps.kind, "net"), eq(chainOps.agentId, firstLoser.id)))
      .orderBy(asc(chainOps.seq));
    expect(nets.map((n) => n.batch)).toEqual([1, 2]);

    // Its first hour is refused; its second must not overtake it.
    chain.throttled.add(firstLoser.id);
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(chain.batches.get(firstLoser.id) ?? 0).toBe(0);
    chain.throttled.clear();
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(chain.batches.get(firstLoser.id)).toBe(2);
    expect(chain.clearing).toBe(0);
  });

  it("marks a net that landed but whose confirmation was lost, rather than sending it again", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 6);
    await cutDue(db, nextHour());
    chain.landButThrow = true;
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    chain.landButThrow = false;
    const second = await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(second.alreadyOnChain).toBeGreaterThan(0);
    expect(chain.clearing).toBe(0);
    for (const a of four) expect(chain.vaults.get(a.id)).toBe(await balanceOf(db, a.id));
  });

  it("settles an agent early when its owner looks to withdraw, and nobody else", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    const [ada] = four;
    await play(db, four, 10);

    const before = await withdrawable(db, ada!.id);
    expect(before.reason).toBe("a match is still settling on chain");
    // Looking was asking: the next pass cuts Ada's matches, and only hers.
    const cut = await cutDue(db);
    expect(cut.rows).toBeGreaterThan(0);
    const left = await db.select().from(chainOps).where(and(eq(chainOps.kind, "settle"), eq(chainOps.status, "pending")));
    expect(left.every((r) => r.fromAgent !== ada!.id && r.toAgent !== ada!.id)).toBe(true);
    const [row] = await db.select().from(agents).where(eq(agents.id, ada!.id));
    expect(row!.settleRequestedAt).toBeNull();

    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(chain.vaults.get(ada!.id)).toBe(await balanceOf(db, ada!.id));
    expect((await withdrawable(db, ada!.id)).reason).toBeNull();
  });

  it("settles an exiting agent early, so its window is spent settling rather than waiting", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    const [, bo] = four;
    await play(db, four, 8);
    await db.insert(exits).values({ agentId: bo!.id, requestedSlot: 1, unlockSlot: 4_501, amount: 1 });
    await cutDue(db);
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(chain.vaults.get(bo!.id)).toBe(await balanceOf(db, bo!.id));
  });

  it("says a netted match is settled once both its agents' nets have landed", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    const [m] = await play(db, four, 1);
    expect(await settlementStatus(db, m!.match.id)).toMatchObject({ status: "pending", netted: true, signature: null });
    await cutDue(db, nextHour());
    expect((await settlementStatus(db, m!.match.id))!.status).toBe("pending");
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    const done = await settlementStatus(db, m!.match.id);
    expect(done).toMatchObject({ status: "confirmed", netted: true });
    expect(done!.signature).toMatch(/^sig-net-/);
  });

  it("counts clearing on the chain side of the solvency line", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 10);
    await cutDue(db, nextHour());
    // Payments land and receipts do not: the money sits in clearing.
    chain.refuseReceipts = true;
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    expect(chain.clearing).toBeGreaterThan(0);
    const line = await solvency(db, { seed: new FakeChain(), deposit: chain });
    expect(line.byFlow.deposit!.difference).toBe(0);
  });

  it("mirrors the program's hourly window with the hour's net, so a win makes room", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const [a, b] = await roster(db, chain);
    const worst = 20;
    expect(await hasOutflowRoom(db, a!.id, worst)).toBe(true);
    // A loss of nearly a fifth of the vault this hour leaves no room for a worst match...
    const fifth = Math.floor(baseUnits(4_500, RATE) / 5);
    await db.insert(chainOps).values({ kind: "settle", fromAgent: a!.id, toAgent: b!.id, amount: fifth - baseUnits(worst, RATE) + 1, netted: true });
    expect(await hasOutflowRoom(db, a!.id, worst)).toBe(false);
    // ...and a win in the same hour nets against it.
    await db.insert(chainOps).values({ kind: "settle", fromAgent: b!.id, toAgent: a!.id, amount: baseUnits(worst, RATE), netted: true });
    expect(await hasOutflowRoom(db, a!.id, worst)).toBe(true);
  });

  it("cuts a backlog of hours one cut per hour, never one sum", async () => {
    const db = await fresh();
    const chain = new FakeChain();
    const four = await roster(db, chain);
    await play(db, four, 4);
    // Two of them backdated an hour, as matches from before an outage are.
    const rows = await db.select().from(chainOps).where(eq(chainOps.kind, "settle")).orderBy(asc(chainOps.seq));
    for (const r of rows.slice(0, 2)) {
      await db.update(chainOps).set({ createdAt: new Date(r.createdAt.getTime() - NET_PERIOD_MS) }).where(eq(chainOps.id, r.id));
    }
    const cut = await cutNetSettlements(db, { now: nextHour() });
    expect(cut.cuts).toBe(2);
    await drainChainOps(db, { seed: new FakeChain(), deposit: chain });
    for (const a of four) expect(chain.vaults.get(a.id)).toBe(await balanceOf(db, a.id));
  });
});
