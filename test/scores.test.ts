import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { createAgent, MATCH_RULES } from "../src/db/runner.js";
import { dailyScores, matches, scoreDays } from "../src/db/schema.js";
import { readHolding, type HoldingsChain } from "../src/db/holdings.js";
import { computeDay, dayOf, dayScores, freezeDay, freezeEndedDays, seasonScores } from "../src/db/scores.js";
import { seasonStatement } from "../src/db/statement.js";
import { seasonAt } from "../src/season.js";
import { SCORE_PARAMS, weight, power } from "../src/score.js";
import type { MatchLog } from "../src/types.js";
import { someWallet } from "./helpers.js";

// Holder scores from matches and holdings (docs/holder-agents.md, Scoring).
// Matches are placed by hand here, with the nets and the moments chosen, so a
// day's arithmetic can be checked exactly; the engine has its own tests.

const DAY_MS = 86_400_000;
const SUPPLY = 1_000_000_000_000_000;

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c;
};

/** Holdings that report whatever the test sets. */
function holdingsOf(held: Map<string, number>): HoldingsChain {
  return { balanceOf: async (w) => held.get(w) ?? 0, supply: async () => SUPPLY };
}

async function holder(db: Db, name: string, held: Map<string, number>, amount = 1) {
  const owner = someWallet();
  held.set(owner, amount);
  await readHolding(db, holdingsOf(held), owner);
  return createAgent(db, { name, presetName: "Anchor", ownerId: owner, funding: "holder" });
}

/** A recorded match with a chosen net and moment. Ranked when both sides are players. */
async function placed(db: Db, a: { id: string }, b: { id: string }, netA: number, at: Date, ranked = true) {
  await db.insert(matches).values({
    agentA: a.id,
    agentB: b.id,
    seed: 1,
    rulesConfig: MATCH_RULES,
    winner: netA > 0 ? "A" : "B",
    netA,
    netB: -netA,
    stake: 40,
    ranked,
    exhibition: !ranked,
    season: seasonAt(at).key,
    log: {} as MatchLog,
    createdAt: at,
  });
}

/** Noon on a day well in the past, so it is over and can be frozen. */
const DAY = dayOf(new Date("2026-03-04T00:00:00Z"));
const noon = (day: number, minute = 0) => new Date(day * DAY_MS + 12 * 3_600_000 + minute * 60_000);

describe("a day's score", () => {
  it("counts ranked matches only, caps each opponent at 40, and floors the day at zero", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held);
    const b = await holder(db, "B", held);
    const c = await holder(db, "C", held);
    const house = await createAgent(db, { name: "House", presetName: "Hammer" });

    // A takes 30 + 30 from B (60, capped to 40) and loses 15 to C: 40 - 15 = 25.
    await placed(db, a, b, 30, noon(DAY, 1));
    await placed(db, a, b, 30, noon(DAY, 2));
    await placed(db, c, a, 15, noon(DAY, 3));
    // A house match is played and recorded, and counts for nothing.
    await placed(db, a, house, 40, noon(DAY, 4), false);
    // Another day's match is another day's.
    await placed(db, a, b, 40, noon(DAY + 1));

    const rows = new Map((await computeDay(db, DAY)).map((r) => [r.agentId, r]));
    expect(rows.get(a.id)!.points).toBe(25);
    expect(rows.get(a.id)!.rankedMatches).toBe(3);
    // B lost 60 net: floored, never negative.
    expect(rows.get(b.id)!.points).toBe(0);
    expect(rows.get(c.id)!.points).toBe(15);
    expect(rows.has(house.id)).toBe(false);
    await close();
  });

  it("qualifies only an agent with the day's minimum of ranked matches", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held);
    const b = await holder(db, "B", held);
    for (let i = 0; i < SCORE_PARAMS.minDailyMatches - 1; i++) await placed(db, a, b, 4, noon(DAY, i));
    expect((await computeDay(db, DAY)).every((r) => !r.qualified)).toBe(true);
    await placed(db, a, b, 4, noon(DAY, 59));
    expect((await computeDay(db, DAY)).every((r) => r.qualified)).toBe(true);
    await close();
  });

  it("weights by the owner's share of supply, read from holdings, and gives a non-holder none", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const whale = await holder(db, "Whale", held, SUPPLY / 100);
    const small = await holder(db, "Small", held, 1);
    // An agent on the old seed flow: it plays, it has no holding.
    const seeded = await createAgent(db, { name: "Seeded", presetName: "Anchor", ownerId: someWallet() });
    await placed(db, whale, small, 20, noon(DAY, 1));
    await placed(db, seeded, small, 20, noon(DAY, 2));

    const rows = new Map((await computeDay(db, DAY)).map((r) => [r.agentId, r]));
    expect(rows.get(whale.id)!.shareOfSupply).toBe(0.01);
    expect(rows.get(whale.id)!.weight).toBeCloseTo(1.45);
    expect(rows.get(whale.id)!.score).toBeCloseTo(29);
    expect(rows.get(seeded.id)!.shareOfSupply).toBe(0);
    expect(rows.get(seeded.id)!.weight).toBe(1);
    // Its holding was read today, after this day: no days held by this day's end.
    expect(rows.get(whale.id)!.convictionDays).toBe(0);
    await close();
  });
});

describe("freezing", () => {
  it("freezes a day once, with its parameters, and never moves it afterwards", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held, SUPPLY / 100);
    const b = await holder(db, "B", held);
    await placed(db, a, b, 20, noon(DAY));

    await expect(freezeDay(db, DAY, noon(DAY))).rejects.toThrow(/not over/);
    const after = new Date((DAY + 1) * DAY_MS + 1);
    expect(await freezeDay(db, DAY, after)).toBe(true);
    expect(await freezeDay(db, DAY, after)).toBe(false);
    const [day] = await db.select().from(scoreDays).where(eq(scoreDays.day, DAY));
    expect(day!.opponentCap).toBe(SCORE_PARAMS.opponentCap);
    expect(day!.minDailyMatches).toBe(SCORE_PARAMS.minDailyMatches);

    // The whale sells everything after the day was frozen. The frozen day keeps
    // the weight it was scored with; a live computation would not.
    held.set(a.ownerId!, 0);
    await readHolding(db, holdingsOf(held), a.ownerId!);
    expect((await computeDay(db, DAY)).find((r) => r.agentId === a.id)!.weight).toBe(1);
    const table = await dayScores(db, DAY);
    expect(table.frozen).toBe(true);
    expect(table.rows.find((r) => r.agentId === a.id)!.weight).toBeCloseTo(1.45);
    await close();
  });

  it("freezes every ended day from the first ranked match, and only those", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held);
    const b = await holder(db, "B", held);
    await placed(db, a, b, 10, noon(DAY));
    await placed(db, a, b, 10, noon(DAY + 2));

    const now = noon(DAY + 3);
    expect(await freezeEndedDays(db, now)).toBe(3);
    // The day in progress is not frozen.
    expect((await dayScores(db, DAY + 3)).frozen).toBe(false);
    expect(await freezeEndedDays(db, now)).toBe(0);
    // A day with no ranked matches is frozen too, empty, so the run carries on past it.
    expect((await db.select().from(dailyScores).where(eq(dailyScores.day, DAY + 1)))).toEqual([]);
    expect((await dayScores(db, DAY + 1)).frozen).toBe(true);
    await close();
  });
});

describe("a season's score", () => {
  it("sums its daily scores, each floored on its own day, and qualifies on the season's minimum", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held);
    const b = await holder(db, "B", held);
    const season = seasonAt(noon(DAY));
    const monday = dayOf(season.start);
    // A good Monday for A, a bad Tuesday: the bad day costs nothing from the good one.
    await placed(db, a, b, 30, noon(monday));
    await placed(db, b, a, 40, noon(monday + 1));

    const table = await seasonScores(db, season.key, new Date(season.end.getTime() + 1));
    const row = table.rows.find((r) => r.agentId === a.id)!;
    expect(row.points).toBe(30);
    expect(row.score).toBe(30 * weight(power({ convictionDays: 0, shareOfSupply: 1 / SUPPLY })));
    expect(row.days).toBe(2);
    expect(row.qualified).toBe(false);
    expect(row.share).toBe(0);
    // Nothing was frozen yet, so the season is not final however late it is read.
    expect(table.frozen).toBe(false);
    await close();
  });

  it("appears in the season's statement beside the prize order", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const a = await holder(db, "A", held);
    const b = await holder(db, "B", held);
    const now = new Date();
    await placed(db, a, b, 12, now);
    const s = await seasonStatement(db, seasonAt(now).key);
    expect(s.scores.minSeasonMatches).toBe(SCORE_PARAMS.minSeasonMatches);
    expect(s.scores.places.find((r) => r.agentId === a.id)!.points).toBe(12);
    await close();
  });
});
