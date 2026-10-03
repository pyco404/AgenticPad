import { describe, expect, it } from "vitest";
import pg from "pg";
import { connect, migrate, type Db } from "../src/db/client.js";
import { balanceOf, balancesOf, inPlayOf, record } from "../src/db/ledger.js";
import { createAgent, leaderboard, pickOpponent, publicAgent, runMatch } from "../src/db/runner.js";
import { liveCounters } from "../src/db/feed.js";
import { faucetStatus } from "../src/db/faucet.js";
import { adoptSeasonRate, baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { rentals, STARTING_BALANCE } from "../src/db/schema.js";
import { seasonStatement } from "../src/db/statement.js";
import { holdingOf, readHolding } from "../src/db/holdings.js";
import { computeDay, dayOf, freezeEndedDays } from "../src/db/scores.js";
import { seasonAt } from "../src/season.js";
import { someWallet } from "./helpers.js";
import { health } from "../src/db/admin.js";

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
  const name = `agentclash_test_${process.pid}_${n++}`;
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
    expect(balance).toBe(big + STARTING_BALANCE);

    // The whole devnet supply in one vault: the most any balance could be.
    const supply = baseUnits(1_000_000_000, DEVNET_CHIP_RATE);
    await record(db, [{ agentId: agent.id, amount: supply, reason: "adjustment" }]);
    const total = await balanceOf(db, agent.id);
    expect(total).toBe(big + STARTING_BALANCE + supply);
    expect(Number.isSafeInteger(total)).toBe(true);
    await close();
  });

  it("reads a holder agent's balance - its wallet's holding - as a number, in every path that reads balances", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const other = someWallet();
      // Past 2^31, so a 32-bit read would be wrong, and through raw SQL (balanceSql).
      const held = baseUnits(50_000, DEVNET_CHIP_RATE);
      const chain = {
        balanceOf: async (wallet: string) => (wallet === owner || wallet === other ? held : 0),
        supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE),
      };
      await readHolding(db, chain, owner);
      await readHolding(db, chain, other);
      const agent = await createAgent(db, { name: "Holds", presetName: "Anchor", ownerId: owner, funding: "holder" });
      const rival = await createAgent(db, { name: "Rival", presetName: "Hammer", ownerId: other, funding: "holder" });

      expect(await balanceOf(db, agent.id)).toBe(held);
      expect((await balancesOf(db, [agent.id])).get(agent.id)).toBe(held);
      const view = await publicAgent(db, agent.id);
      expect(typeof view!.balance).toBe("number");
      expect(view!.balance).toBe(held);
      const holding = await holdingOf(db, owner);
      expect(holding!.amount).toBe(held);
      expect(typeof holding!.supply).toBe("number");
      // The matchmaker compares the same figure in SQL against the minimum.
      const pick = await pickOpponent(db, agent.id, { minCandidates: 1 });
      expect(pick.opponentId).toBe(rival.id);
    } finally {
      await close();
    }
  });

  it("scores and freezes a day through raw SQL, with the drivers' own types for counts and moments", async () => {
    const { db, close } = await fresh();
    try {
      const a = await createAgent(db, { name: "Pa", presetName: "Anchor", ownerId: someWallet() });
      const b = await createAgent(db, { name: "Pb", presetName: "Hammer", ownerId: someWallet() });
      await runMatch(db, a.id, b.id, { seed: 41 });
      const today = dayOf(new Date());
      const rows = await computeDay(db, today);
      expect(rows.map((r) => typeof r.rankedMatches)).toEqual(["number", "number"]);
      expect(rows.every((r) => r.rankedMatches === 1)).toBe(true);
      // The first ranked match's moment comes back as a Date here and a string
      // elsewhere; either way the run starts on today, which is not over.
      expect(await freezeEndedDays(db, new Date())).toBe(0);
      expect(await freezeEndedDays(db, new Date((today + 1) * 86_400_000 + 1))).toBe(1);
    } finally {
      await close();
    }
  });

  it("decides a holder is in play from its conviction amount, a bigint, against the minimum bound as a parameter", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const min = baseUnits(3_600, DEVNET_CHIP_RATE);
      const chain = { balanceOf: async () => min, supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE) };
      const agent = await createAgent(db, { name: "Kept", presetName: "Anchor", ownerId: owner, funding: "holder" });
      await readHolding(db, chain, owner);
      expect((await inPlayOf(db, [agent.id])).get(agent.id)).toBe(true);
      const holding = await holdingOf(db, owner);
      expect(holding!.convictionAmount).toBe(min);
      expect(holding!.convictionSince).toBeInstanceOf(Date);
      // The minimum doubles; the wallet has not sold, and stays in play.
      adoptSeasonRate(2 * DEVNET_CHIP_RATE);
      try {
        expect((await inPlayOf(db, [agent.id])).get(agent.id)).toBe(true);
        expect((await publicAgent(db, agent.id))!.inPlay).toBe(true);
      } finally {
        adoptSeasonRate(DEVNET_CHIP_RATE);
      }
    } finally {
      await close();
    }
  });

  it("reads one as a number everywhere a balance is summed, not only in balanceOf", async () => {
    const { db, close } = await fresh();
    const owner = someWallet();
    const agent = await createAgent(db, { name: "Summed", presetName: "Hammer", ownerId: owner });
    const big = baseUnits(50_000, DEVNET_CHIP_RATE);
    await record(db, [{ agentId: agent.id, amount: big, reason: "adjustment" }]);
    const expected = big + STARTING_BALANCE;

    // Every place that sums ledger.amount in raw SQL.
    const many = await balancesOf(db, [agent.id]);
    expect(many.get(agent.id)).toBe(expected);

    // Matchmaking compares the same sum inside SQL rather than reading it out,
    // to find who holds enough to play, so what it proves is that the
    // arithmetic does not overflow: a 32-bit cast raised "integer out of
    // range" on a balance this size.
    const other = await createAgent(db, { name: "Opponent", presetName: "Bully", ownerId: someWallet() });
    await record(db, [{ agentId: other.id, amount: big, reason: "adjustment" }]);
    expect((await pickOpponent(db, agent.id, { minCandidates: 1 })).opponentId).toBe(other.id);

    const view = await publicAgent(db, agent.id);
    expect(typeof view!.balance).toBe("number");
    expect(view!.balance).toBe(expected);

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
    expect(counters).toEqual({ matchesToday: 1, totalStaked: played.stake * 2, holders: 0 });
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

  it("reads the admin page's counts and oldest reading as numbers and a date", async () => {
    const { db, close } = await fresh();
    try {
      const owner = someWallet();
      const chain = { balanceOf: async () => baseUnits(3_600, DEVNET_CHIP_RATE), supply: async () => baseUnits(1_000_000_000, DEVNET_CHIP_RATE) };
      await createAgent(db, { name: "Read", presetName: "Anchor", ownerId: owner, funding: "holder" });
      await readHolding(db, chain, owner);
      const h = await health(db);
      expect(h.holders).toBe(1);
      expect(h.holdings.wallets).toBe(1);
      expect(h.holdings.oldestReadAt).toBeInstanceOf(Date);
      expect(typeof h.holdings.oldestAgeMs).toBe("number");
      expect(h.holdings.stale).toBe(false);
      expect(typeof h.matches.today).toBe("number");
    } finally {
      await close();
    }
  });

  it("refuses an integer too large to read exactly, rather than losing its last digits", async () => {
    const parse = pg.types.getTypeParser(20);
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parse("9223372036854775807")).toThrow(/without losing precision/);
  });
});
