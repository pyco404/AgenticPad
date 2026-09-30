import { afterEach, describe, expect, it } from "vitest";
import { adoptSeasonRate, chipRate, chips, DEVNET_CHIP_RATE, seasonRate } from "../src/chips.js";
import { MAX_CHIP_RATE, RENT_CHIPS, rateForPrice, rateSteps, rentFor, USD_PER_CHIP } from "../src/chip-rate-plan.js";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { balanceOf, record } from "../src/db/ledger.js";
import { createAgent, runMatch } from "../src/db/runner.js";
import { chainOps, MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import { someWallet } from "./helpers.js";
import { rateOf, syncSeasonRate } from "../src/db/chip-rate.js";
import { seasonTick } from "../src/db/seasons.js";
import { seasonStatement } from "../src/db/statement.js";
import { nextSeason, seasonAt } from "../src/season.js";

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c.db;
};

/** A program whose rate and rent a test can move, as the admin would. */
const program = (chipRate: number, rent = rentFor(chipRate)) => {
  const state = { chipRate, rent, reads: 0 };
  return { state, read: async () => (state.reads++, { chipRate: state.chipRate, rent: state.rent }) };
};

// The season's rate is one number for the whole process: put it back after each test.
afterEach(() => adoptSeasonRate(DEVNET_CHIP_RATE));

describe("planning a rate", () => {
  it("keeps the peg: 900 chips are $5 at the price given", () => {
    const { rate } = rateForPrice(0.00042);
    // 900 chips in tokens, times the price, is five dollars - to the base unit's rounding.
    expect(((900 * rate) / 1e6) * 0.00042).toBeCloseTo(5, 5);
    expect(rateForPrice(USD_PER_CHIP).rate).toBe(1_000_000);
  });

  it("clamps at the program's ceiling and says so", () => {
    expect(rateForPrice(1e-12)).toEqual({ rate: MAX_CHIP_RATE, clamped: true });
    expect(rateForPrice(1).clamped).toBe(false);
  });

  it("rises in one instruction and falls by halves, each one the program would accept", () => {
    expect(rateSteps(1_000, 50_000)).toEqual([50_000]);
    expect(rateSteps(1_000, 1_000)).toEqual([]);
    const steps = rateSteps(1_000_001, 100_000);
    expect(steps.at(-1)).toBe(100_000);
    // The program's rule, rate_change_ok: 2 x next >= previous.
    let previous = 1_000_001;
    for (const step of steps) {
      expect(step * 2).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
    expect(steps).toHaveLength(4);
  });

  it("keeps renting at $2", () => {
    expect(RENT_CHIPS).toBe(360);
    expect(rentFor(13_228)).toBe(360 * 13_228);
  });
});

describe("the season's rate", () => {
  it("stands at devnet's fixed rate where there is no program to read, and records nothing", async () => {
    const db = await fresh();
    const r = await syncSeasonRate(db, null);
    expect(r).toMatchObject({ rate: DEVNET_CHIP_RATE, source: "devnet", drift: null });
    expect(await rateOf(db, r.season)).toBeNull();
    expect(seasonRate()).toBe(DEVNET_CHIP_RATE);
  });

  it("is read from the program once, recorded against the season, and used for every chip", async () => {
    const db = await fresh();
    const { read } = program(13_228);
    const r = await syncSeasonRate(db, read);
    expect(r).toMatchObject({ rate: 13_228, source: "chain", drift: null, rent: rentFor(13_228) });
    expect(await rateOf(db, r.season)).toBe(13_228);
    expect(seasonRate()).toBe(13_228);
    expect(chipRate("deposit")).toBe(13_228);
    expect(chipRate("seed")).toBe(1);
    expect(chips(900 * 13_228, chipRate("deposit"))).toBe(900);
  });

  it("does not change mid-season when the program does: it reports the drift instead", async () => {
    const db = await fresh();
    const p = program(13_228);
    const now = new Date();
    await syncSeasonRate(db, p.read, now);
    p.state.chipRate = 20_000;
    p.state.rent = rentFor(20_000);
    const r = await syncSeasonRate(db, p.read, new Date(now.getTime() + 60_000));
    expect(r).toMatchObject({ rate: 13_228, source: "recorded", drift: { chain: 20_000, season: 13_228 } });
    // The rent quoted follows the program even so: that is what a rental must pay.
    expect(r.rent).toBe(rentFor(20_000));
    expect(seasonRate()).toBe(13_228);
  });

  it("takes the program's new rate at the next season, and the old season keeps its own", async () => {
    const db = await fresh();
    const p = program(13_228);
    const now = new Date();
    const first = await syncSeasonRate(db, p.read, now);
    p.state.chipRate = 20_000;
    const later = new Date(nextSeason(seasonAt(now)).start.getTime() + 1_000);
    const second = await seasonTick(db, later, p.read);
    expect(second.rate).toMatchObject({ season: nextSeason(seasonAt(now)).key, rate: 20_000, source: "chain", drift: null });
    expect(second.closed.map((c) => c.key)).toContain(first.season);
    expect(await rateOf(db, first.season)).toBe(13_228);
    expect(seasonRate()).toBe(20_000);
  });

  it("keeps the rate in use while the program cannot be read, and records it once it can", async () => {
    const db = await fresh();
    adoptSeasonRate(9_999);
    const down = async () => {
      throw new Error("rpc down");
    };
    const r = await syncSeasonRate(db, down);
    expect(r).toMatchObject({ rate: 9_999, source: "unreadable" });
    expect(await rateOf(db, r.season)).toBeNull();
    const back = await syncSeasonRate(db, program(13_228).read);
    expect(back).toMatchObject({ rate: 13_228, source: "chain" });
  });

  it("lets two instances agree: the first rate recorded is the season's", async () => {
    const db = await fresh();
    await syncSeasonRate(db, program(13_228).read);
    const other = await syncSeasonRate(db, program(15_000).read);
    expect(other).toMatchObject({ rate: 13_228, source: "recorded", drift: { chain: 15_000, season: 13_228 } });
  });

  it("is on the season's statement, so an owner can check what a chip was worth", async () => {
    const db = await fresh();
    const r = await syncSeasonRate(db, program(13_228).read);
    expect((await seasonStatement(db, r.season)).season.chipRate).toBe(13_228);
  });
});

describe("a match at the season's rate", () => {
  const funded = async (db: Db, name: string, presetName: "Anchor" | "Bully", rate: number) => {
    const agent = await createAgent(db, { name, presetName, ownerId: someWallet(), funding: "deposit" });
    await record(db, [{ agentId: agent.id, amount: MIN_FUNDING_CHIPS * rate, reason: "deposit" }]);
    return agent;
  };

  it("judges who can play in the season's base units, not devnet's, and moves nothing", async () => {
    const db = await fresh();
    const rate = (await syncSeasonRate(db, program(13_228).read)).rate;
    const a = await funded(db, "Ada", "Anchor", rate);
    const b = await funded(db, "Bo", "Bully", rate);
    // The minimum at this rate is far below the minimum at devnet's: read at the
    // wrong rate, both would be refused as holding too little to play.
    expect(MIN_FUNDING_CHIPS * rate).toBeLessThan(MIN_FUNDING_CHIPS * DEVNET_CHIP_RATE);
    let m = await runMatch(db, a.id, b.id, { seed: 1 });
    for (let seed = 2; m.settled.A === 0 && seed < 50; seed++) m = await runMatch(db, a.id, b.id, { seed });
    expect(m.settled.A).not.toBe(0);
    // A decided match, and neither balance moved, nor was the chain asked to move one.
    expect(await balanceOf(db, a.id)).toBe(MIN_FUNDING_CHIPS * rate);
    expect(await balanceOf(db, b.id)).toBe(MIN_FUNDING_CHIPS * rate);
    expect(await db.select().from(chainOps).where(eq(chainOps.matchId, m.match.id))).toHaveLength(0);
  });
});
