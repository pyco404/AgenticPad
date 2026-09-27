import { describe, expect, it } from "vitest";
import pg from "pg";
import { connect, migrate, type Db } from "../src/db/client.js";
import { balanceOf, balancesOf, record } from "../src/db/ledger.js";
import { createAgent, hasBudgetRoom, hasOutflowRoom, leaderboard, lostToday, playableBands, publicAgent, runMatch } from "../src/db/runner.js";
import { liveCounters } from "../src/db/feed.js";
import { faucetStatus } from "../src/db/faucet.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { chainOps, rentals } from "../src/db/schema.js";
import { seasonStatement } from "../src/db/statement.js";
import { seasonAt } from "../src/season.js";
import { someWallet } from "./helpers.js";
import { volume } from "../src/db/admin.js";
import { solvency } from "../src/chain/worker.js";
import { FakeChain } from "./fake-chain.js";

/**
 * The suite runs on PGlite; production runs on node-postgres. They do not agree
 * about int8: PGlite hands back a number, node-postgres a string. Through a
 * typed column drizzle hides the difference, but not through a raw
 * `sum(...)::bigint` - so a balance that came back as "900000000" in production
 * would pass every other test in this repo.
 *
 * This file is the guard. It runs only against a real Postgres, named by
 * PG_URL, and `scripts/pg-test.sh` puts a throwaway one in front of it. Add a
 * case here whenever a query starts returning a bigint.
 *
 *   scripts/pg-test.sh
 *   PG_URL=postgres://... npx vitest run test/postgres.test.ts
 */

const URL = process.env["PG_URL"];

/** A database of its own per test, because these share one server. */
let n = 0;
async function fresh(): Promise<{ db: Db; close: () => Promise<void> }> {
  const base = new pg.Pool({ connectionString: URL });
  const name = `oxude_test_${process.pid}_${n++}`;
  await base.query(`drop database if exists ${name}`);
  await base.query(`create database ${name}`);
  await base.end();
  const { db, close } = await connect(new URL_(URL!, name).toString());
  await migrate(db);
  return { db, close };
}
/** The same server, a different database. */
class URL_ {
  constructor(
    private readonly base: string,
    private readonly name: string,
  ) {}
  toString() {
    const u = new globalThis.URL(this.base);
    u.pathname = `/${this.name}`;
    return u.toString();
  }
}

describe.skipIf(!URL)("against a real Postgres (npm run check runs these; a bare vitest run skips them)", () => {
  it("reads a balance as an exact number, past what a 32-bit column held", async () => {
    const { db, close } = await fresh();
    const agent = await createAgent(db, { name: "Wide", presetName: "Anchor" });
    // 2,147 chips is where a 32-bit column ran out at six decimals.
    const big = baseUnits(50_000, DEVNET_CHIP_RATE);
    expect(big).toBeGreaterThan(2_147_483_647);
    await record(db, [{ agentId: agent.id, amount: big, reason: "adjustment" }]);

    const balance = await balanceOf(db, agent.id);
    expect(typeof balance).toBe("number");
    expect(balance).toBe(big + 900);

    // The whole devnet supply in one vault: the most any balance could be.
    const supply = baseUnits(1_000_000_000, DEVNET_CHIP_RATE);
    await record(db, [{ agentId: agent.id, amount: supply, reason: "adjustment" }]);
    const total = await balanceOf(db, agent.id);
    expect(total).toBe(big + 900 + supply);
    expect(Number.isSafeInteger(total)).toBe(true);
    await close();
  });

  it("reads one as a number everywhere a balance is summed, not only in balanceOf", async () => {
    const { db, close } = await fresh();
    const owner = someWallet();
    const agent = await createAgent(db, { name: "Summed", presetName: "Hammer", ownerId: owner });
    const big = baseUnits(50_000, DEVNET_CHIP_RATE);
    await record(db, [{ agentId: agent.id, amount: big, reason: "adjustment" }]);
    const expected = big + 900;

    // Every place that sums ledger.amount or chain_ops.amount in raw SQL.
    const many = await balancesOf(db, [agent.id]);
    expect(many.get(agent.id)).toBe(expected);

    // playableBands compares the same sum inside SQL rather than reading it
    // out, so what it proves is that the arithmetic does not overflow: a
    // 32-bit cast raised "integer out of range" on a balance this size.
    const other = await createAgent(db, { name: "Opponent", presetName: "Bully" });
    await record(db, [{ agentId: other.id, amount: big, reason: "adjustment" }]);
    const bands = await playableBands(db, agent.id, owner, "seed");
    expect(bands.find((b) => b.band === "B")?.count).toBe(1);

    const view = await publicAgent(db, agent.id);
    expect(typeof view!.balance).toBe("number");
    expect(view!.balance).toBe(expected);

    // committedOutflow sums chain_ops.amount, which is also a bigint now.
    await db.insert(chainOps).values({ kind: "settle", fromAgent: agent.id, amount: big });
    expect(typeof (await hasOutflowRoom(db, agent.id, 60))).toBe("boolean");

    // And the ladder, whose figures come from bigint rating columns.
    const rows = await leaderboard(db, 10);
    for (const row of rows) expect(typeof row.cumulativeNet).toBe("number");
    await close();
  });

  it("reads the live feed's staked total as a number", async () => {
    const { db, close } = await fresh();
    // Both owned: a match involving a house agent is an exhibition and stakes
    // nothing, so it would leave the counter this test is about at zero.
    const a = await createAgent(db, { name: "Staker", presetName: "Anchor", ownerId: someWallet() });
    const b = await createAgent(db, { name: "Caller", presetName: "Bully", ownerId: someWallet() });
    const played = await runMatch(db, a.id, b.id, { seed: 7 });
    const counters = await liveCounters(db, new Date());
    expect(typeof counters.totalStaked).toBe("number");
    expect(counters).toEqual({ matchesToday: 1, totalStaked: played.stake * 2 });
    await close();
  });

  it("reads a bigint column through drizzle as a number too", async () => {
    const { db, close } = await fresh();
    const wallet = someWallet();
    // faucet_grants.amount is a bigint the faucet reads back to decide a wait.
    const status = await faucetStatus(db, wallet, DEVNET_CHIP_RATE);
    expect(typeof status.amount).toBe("number");
    expect(status.available).toBe(true);
    await close();
  });

  it("reads a season statement's sums as numbers, not strings", async () => {
    const { db, close } = await fresh();
    const owner = someWallet();
    const a = await createAgent(db, { name: "Stmt-A", presetName: "Bully", ownerId: owner });
    const b = await createAgent(db, { name: "Stmt-B", presetName: "Mirage", ownerId: someWallet() });
    const key = seasonAt(new Date()).key;
    for (let i = 0; i < 3; i++) await runMatch(db, a.id, b.id, { seed: 4000 + i });

    // The rental fee is in base units, so its sum is a genuinely large int8 -
    // the exact case where node-postgres hands back a string and PGlite does
    // not. Six figures of chips is more rent than anyone will ever pay, which
    // is the point: the figure has to survive being bigger than it should be.
    const fee = baseUnits(500_000, DEVNET_CHIP_RATE);
    expect(fee).toBeGreaterThan(2_147_483_647);
    await db.insert(rentals).values({
      agentId: a.id,
      ownerId: owner,
      fee,
      deposit: 0,
      salt: "pg",
      preparedTx: "x",
      lastValidBlockHeight: 1,
      status: "confirmed",
    });

    const s = await seasonStatement(db, key);
    for (const v of Object.values(s.play)) expect(typeof v).toBe("number");
    expect(typeof s.burned.chips).toBe("number");
    expect(s.burned.chips).toBe(500_000);
    expect(s.play.rankedMatches).toBe(3);
    expect(s.play.netAcrossAllSides).toBe(0);
    expect(s.play.rankedStaked).toBeGreaterThan(0);
    expect(Number.isSafeInteger(s.play.rankedStaked)).toBe(true);
    await close();
  });

  it("reads the admin page's money-in total as a number, rental deposits included", async () => {
    // volume() sums rentals.deposit with raw SQL: the deposit made at rent
    // time, which the deposits table (top-ups only) never sees.
    const { db, close } = await fresh();
    const owner = someWallet();
    const a = await createAgent(db, { name: "Vol", presetName: "Anchor", ownerId: owner });
    const deposit = baseUnits(500_000, DEVNET_CHIP_RATE);
    expect(deposit).toBeGreaterThan(2_147_483_647);
    await db.insert(rentals).values({
      agentId: a.id,
      ownerId: owner,
      fee: 0,
      deposit,
      salt: "pg-vol",
      preparedTx: "x",
      lastValidBlockHeight: 1,
      status: "confirmed",
    });

    const v = await volume(db);
    expect(typeof v.deposits.atRentChips).toBe("number");
    expect(v.deposits.atRentChips).toBe(500_000);
    expect(v.deposits.chips).toBe(500_000);
    expect(v.deposits.confirmed).toBe(1);
    await close();
  });

  it("reads settlements in flight as numbers, one per flow", async () => {
    // solvency() sums pending settlements per flow with raw SQL and a group by.
    const { db, close } = await fresh();
    const a = await createAgent(db, { name: "Fly-A", presetName: "Bully", ownerId: someWallet() });
    const b = await createAgent(db, { name: "Fly-B", presetName: "Anchor", ownerId: someWallet() });
    // Played and not drained: the settlement sits in the outbox.
    await runMatch(db, a.id, b.id, { seed: 5 });

    const sums = await solvency(db, new FakeChain());
    expect(Object.keys(sums.inFlight)).toEqual(["seed"]);
    expect(typeof sums.inFlight.seed).toBe("number");
    expect(sums.inFlight.seed).toBeGreaterThan(0);
    await close();
  });

  it("reads a day's net loss as a number, for the owner's loss budget", async () => {
    // netLossOn sums settle ops with raw SQL: losses in, wins out, one UTC day.
    const { db, close } = await fresh();
    const a = await createAgent(db, { name: "Budget-A", presetName: "Anchor", ownerId: someWallet() });
    const b = await createAgent(db, { name: "Budget-B", presetName: "Bully", ownerId: someWallet() });
    const big = baseUnits(3_000, DEVNET_CHIP_RATE);
    expect(big).toBeGreaterThan(2_147_483_647);
    await db.insert(chainOps).values([
      { kind: "settle", fromAgent: a.id, toAgent: b.id, amount: big },
      { kind: "settle", fromAgent: b.id, toAgent: a.id, amount: baseUnits(1_000, DEVNET_CHIP_RATE) },
    ]);
    const lost = await lostToday(db, a.id);
    expect(typeof lost).toBe("number");
    expect(lost).toBe(baseUnits(2_000, DEVNET_CHIP_RATE));
    expect(await lostToday(db, b.id)).toBe(-baseUnits(2_000, DEVNET_CHIP_RATE));
    expect(typeof (await hasBudgetRoom(db, a.id, 40))).toBe("boolean");
    await close();
  });

  it("refuses an integer too large to read exactly, rather than losing its last digits", async () => {
    const parse = pg.types.getTypeParser(20);
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parse("9223372036854775807")).toThrow(/without losing precision/);
  });
});
