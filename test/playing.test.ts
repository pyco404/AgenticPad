import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { agents, ledger, MIN_FUNDING_CHIPS, ratings, WORST_MATCH } from "../src/db/schema.js";
import { balanceOf, isFirstElicitationFree, recordElicitation, elicitationCount } from "../src/db/ledger.js";
import { createAgent, MATCH_RULES, pickOpponent, roster, runMatch, updateRating } from "../src/db/runner.js";
import { refreshTrueRatings } from "../src/db/rating.js";
import { holdingMinimum } from "../src/db/holdings.js";
import { someWallet, createPlayer } from "./helpers.js";

// Playing as a holder (docs/holder-agents.md): a match moves no money, the
// balance is the owner's wallet as read, and an agent is in play while that
// wallet holds the minimum.

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await connect());
  await migrate(db);
});
afterAll(async () => close());

const fresh = async () => {
  const { db: d, close: c } = await connect();
  await migrate(d);
  return { db: d, close: c };
};

describe("stakes", () => {
  it("are one scale for every match: ante 4, bet 10, raised 20, and at most 40 a match", () => {
    expect(MATCH_RULES.stakes).toEqual({ ante: 4, baseBet: 10, raisedBet: 20 });
    // The widest a match can be won by is two rounds at the raised bet: a
    // match is first to two, so the winner can never take a third.
    expect(WORST_MATCH).toBe(MATCH_RULES.stakes.raisedBet * 2);
  });
});

describe("a match", () => {
  it("moves no money, whoever wins: a lost match costs nothing", async () => {
    const { db: d, close: c } = await fresh();
    const a = await createPlayer(d, { name: "A", presetName: "Bully" });
    const b = await createPlayer(d, { name: "B", presetName: "Mirage" });
    let decided = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { match, log, stake, settled } = await runMatch(d, a.id, b.id, { seed });
      // The match is played in chips, and the row says what it was played at.
      expect(stake).toBe(WORST_MATCH);
      expect(settled.A).toBe(log.nets.A);
      if (settled.A !== 0) decided++;
      expect(await d.select().from(ledger).where(eq(ledger.matchId, match.id))).toHaveLength(0);
    }
    expect(decided).toBeGreaterThan(0);
    // The balance is the wallet's, and a match does not touch a wallet.
    expect(await balanceOf(d, a.id)).toBe(holdingMinimum());
    expect(await balanceOf(d, b.id)).toBe(holdingMinimum());
    await c();
  });

  it("puts everyone in one pool: any player's agent can be matched against any other", async () => {
    const { db: d, close: c } = await fresh();
    const me = await createPlayer(d, { name: "Me", presetName: "Anchor" });
    const others = [];
    for (let i = 0; i < 6; i++) others.push(await createPlayer(d, { name: `Other ${i}`, presetName: (["Bully", "Hammer", "Mirage"] as const)[i % 3]! }));
    await refreshTrueRatings(d);
    const pick = await pickOpponent(d, me.id, { spread: true });
    expect(pick.candidates).toBe(6);
    const { stake, match } = await runMatch(d, me.id, others[0]!.id, { seed: 1 });
    expect(stake).toBe(WORST_MATCH);
    expect(match.rulesConfig.stakes).toEqual(MATCH_RULES.stakes);
    await c();
  });

  it("never pairs a wallet's own agents, even when the roster is too thin to pick on rating", async () => {
    const { db: d, close: c } = await fresh();
    const owner = someWallet();
    const mine = await createPlayer(d, { name: "Mine", presetName: "Anchor", ownerId: owner });
    await createPlayer(d, { name: "Also mine", presetName: "Bully", ownerId: owner });
    await refreshTrueRatings(d);
    await expect(pickOpponent(d, mine.id)).rejects.toThrow(/no opponent right now/);
    const stranger = await createPlayer(d, { name: "Stranger", presetName: "Hammer" });
    await refreshTrueRatings(d);
    const pick = await pickOpponent(d, mine.id);
    expect(pick.opponentId).toBe(stranger.id);
    expect(pick.path).toBe("preset-fallback");
    await c();
  });

  it("never sends autoplay to house agents, and says Play is the way to meet one", async () => {
    const { db: d, close: c } = await fresh();
    const me = await createPlayer(d, { name: "Waiting", presetName: "Anchor" });
    for (let i = 0; i < 2; i++) await createAgent(d, { name: `House ${i}`, presetName: "Bully" });
    await expect(pickOpponent(d, me.id, { spread: true })).rejects.toThrow(/no opponent right now.*press Play to take on a house agent/);
    await c();
  });
});

describe("ratings", () => {
  it("rank on the chips a match was won by: nothing is normalised", async () => {
    const { db: d, close: c } = await fresh();
    const a = await createPlayer(d, { name: "Pa", presetName: "Bully" });
    const b = await createPlayer(d, { name: "Pb", presetName: "Mirage" });
    let won = 0;
    for (let seed = 1; seed <= 6; seed++) won += (await runMatch(d, a.id, b.id, { seed })).settled.A;
    await updateRating(d, a.id);
    const [rating] = await d.select().from(ratings).where(eq(ratings.agentId, a.id));
    expect(rating!.rankedNet).toBe(won);
    expect(rating!.cumulativeNet).toBe(won);
    await c();
  });
});

describe("holding too little", () => {
  it("never happens in a match: however many it loses, an agent keeps what its wallet holds", async () => {
    const { db: d, close: c } = await fresh();
    const small = await createPlayer(d, { name: "Small", presetName: "Mirage" });
    const rival = await createPlayer(d, { name: "Rival", presetName: "Bully" });
    let lost = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const result = await runMatch(d, small.id, rival.id, { seed });
      expect(result.retired).toEqual([]);
      if (result.settled.A < 0) lost++;
    }
    expect(lost).toBeGreaterThan(0);
    expect(await balanceOf(d, small.id)).toBe(holdingMinimum());
    const [row] = await d.select().from(agents).where(eq(agents.id, small.id));
    expect(row!.retiredAt).toBeNull();
    await c();
  });

  it("is never offered as an opponent while its wallet holds less than the minimum", async () => {
    const { db: d, close: c } = await fresh();
    const seeker = await createPlayer(d, { name: "Seeker", presetName: "Anchor" });
    const short = await createPlayer(d, { name: "Short", presetName: "Bully", holds: holdingMinimum() - 1 });
    const holders = [];
    for (let i = 0; i < 5; i++) holders.push(await createPlayer(d, { name: `Holder ${i}`, presetName: "Hammer" }));
    await refreshTrueRatings(d);
    for (let i = 0; i < 20; i++) {
      const pick = await pickOpponent(d, seeker.id);
      expect(pick.opponentId).not.toBe(short.id);
      expect(holders.map((s) => s.id)).toContain(pick.opponentId);
    }
    await c();
  });
});

describe("first elicitation", () => {
  it("is free once per owner, then counts", async () => {
    const owner = someWallet();
    const other = someWallet();
    expect(await isFirstElicitationFree(db, owner)).toBe(true);
    await recordElicitation(db, { ownerId: owner, kind: "preview", free: true });
    expect(await isFirstElicitationFree(db, owner)).toBe(false);
    expect(await elicitationCount(db, owner)).toBe(1);
    await recordElicitation(db, { ownerId: owner, kind: "rent", free: false });
    expect(await elicitationCount(db, owner)).toBe(2);
    expect(await isFirstElicitationFree(db, other)).toBe(true);
  });
});

describe("lists that show many agents at once", () => {
  it("show every holding in chips", async () => {
    const { db: d, close: c } = await fresh();
    await createPlayer(d, { name: "Holds", presetName: "Anchor" });
    const listed = await roster(d);
    expect(new Map(listed.map((r) => [r.name, r.balance])).get("Holds")).toBe(MIN_FUNDING_CHIPS);
    await c();
  });
});
