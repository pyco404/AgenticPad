import { afterEach, describe, expect, it } from "vitest";
import { adoptSeasonRate, DEVNET_CHIP_RATE, seasonRate } from "../src/chips.js";
import { MAX_CHIP_RATE, rateForPrice, USD_PER_CHIP } from "../src/chip-rate-plan.js";
import { connect, migrate, type Db } from "../src/db/client.js";
import { createAgent, runMatch } from "../src/db/runner.js";
import { MIN_FUNDING_CHIPS, seasons } from "../src/db/schema.js";
import { someWallet } from "./helpers.js";
import { rateOf, RateError, setSeasonRate, syncSeasonRate } from "../src/db/chip-rate.js";
import { holdingMinimum, readHolding } from "../src/db/holdings.js";
import { seasonStatement } from "../src/db/statement.js";
import { nextSeason, seasonAt } from "../src/season.js";

// The season's chip rate: what pegs the holder minimum, $20, to tokens
// (docs/holder-agents.md). It lives on the season's row, set before the
// season starts, and changes only at a boundary.

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c.db;
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

  it("clamps at the ceiling and says so", () => {
    expect(rateForPrice(1e-12)).toEqual({ rate: MAX_CHIP_RATE, clamped: true });
    expect(rateForPrice(1).clamped).toBe(false);
  });
});

describe("the season's rate", () => {
  it("stands at devnet's fixed rate when no season has ever had one", async () => {
    const db = await fresh();
    const r = await syncSeasonRate(db);
    expect(r).toMatchObject({ rate: DEVNET_CHIP_RATE, source: "devnet" });
    expect(await rateOf(db, r.season)).toBeNull();
    expect(seasonRate()).toBe(DEVNET_CHIP_RATE);
  });

  it("is set for the next season before it starts, and taken up when it does", async () => {
    const db = await fresh();
    const now = new Date();
    const next = nextSeason(seasonAt(now));
    await setSeasonRate(db, next.key, 13_228, now);
    // Not this season's: a week plays at one rate.
    expect((await syncSeasonRate(db, now)).rate).toBe(DEVNET_CHIP_RATE);
    const r = await syncSeasonRate(db, new Date(next.start.getTime() + 1));
    expect(r).toMatchObject({ season: next.key, rate: 13_228, source: "recorded" });
    expect(holdingMinimum()).toBe(MIN_FUNDING_CHIPS * 13_228);
  });

  it("will not be changed for a season already under way", async () => {
    const db = await fresh();
    const now = new Date();
    await expect(setSeasonRate(db, seasonAt(now).key, 13_228, now)).rejects.toThrow(RateError);
    await expect(setSeasonRate(db, nextSeason(seasonAt(now)).key, 0, now)).rejects.toThrow(RateError);
  });

  it("carries the last season's rate into one nobody set, so the minimum stays where it was", async () => {
    const db = await fresh();
    const now = new Date();
    const next = nextSeason(seasonAt(now));
    await setSeasonRate(db, next.key, 13_228, now);
    const after = nextSeason(next);
    const r = await syncSeasonRate(db, new Date(after.start.getTime() + 1));
    expect(r).toMatchObject({ season: after.key, rate: 13_228, source: "carried" });
    expect(await rateOf(db, after.key)).toBe(13_228);
  });

  it("lets two instances agree: the season keeps the first rate recorded", async () => {
    const db = await fresh();
    const now = new Date();
    const next = nextSeason(seasonAt(now));
    await setSeasonRate(db, next.key, 13_228, now);
    const at = new Date(next.start.getTime() + 1);
    const [one, two] = await Promise.all([syncSeasonRate(db, at), syncSeasonRate(db, at)]);
    expect(one.rate).toBe(two.rate);
    expect((await db.select().from(seasons)).filter((s) => s.key === next.key)).toHaveLength(1);
  });

  it("is on the season's statement, so an owner can check what a chip was worth", async () => {
    const db = await fresh();
    const now = new Date();
    const next = nextSeason(seasonAt(now));
    await setSeasonRate(db, next.key, 13_228, now);
    expect((await seasonStatement(db, next.key)).season.chipRate).toBe(13_228);
  });
});

describe("a match at the season's rate", () => {
  const holder = async (db: Db, name: string, presetName: "Anchor" | "Bully", amount: number) => {
    const owner = someWallet();
    const agent = await createAgent(db, { name, presetName, ownerId: owner, funding: "holder" });
    await readHolding(db, { balanceOf: async () => amount, supply: async () => 1e15 }, owner, new Date(), holdingMinimum());
    return agent;
  };

  it("judges who can play in the season's base units, not devnet's", async () => {
    const db = await fresh();
    const now = new Date();
    const next = nextSeason(seasonAt(now));
    await setSeasonRate(db, next.key, 13_228, now);
    const rate = (await syncSeasonRate(db, new Date(next.start.getTime() + 1))).rate;
    // The minimum at this rate is far below the minimum at devnet's: read at the
    // wrong rate, both would be refused as holding too little to play.
    expect(MIN_FUNDING_CHIPS * rate).toBeLessThan(MIN_FUNDING_CHIPS * DEVNET_CHIP_RATE);
    const a = await holder(db, "Ada", "Anchor", MIN_FUNDING_CHIPS * rate);
    const b = await holder(db, "Bo", "Bully", MIN_FUNDING_CHIPS * rate);
    expect((await runMatch(db, a.id, b.id, { seed: 1 })).match.ranked).toBe(true);
  });
});
