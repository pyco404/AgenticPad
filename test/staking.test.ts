import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { baseUnits, DEVNET_CHIP_RATE, SEED_CHIP_RATE } from "../src/chips.js";
import { connect, migrate, type Db } from "../src/db/client.js";
import {
  agents,
  chainOps,
  bandByName,
  canAffordBand,
  affordableBands,
  ledger,
  matches,
  normaliseNet,
  ratings,
  STARTING_BALANCE,
} from "../src/db/schema.js";
import {
  balanceOf,
  record,
  settle,
  statement,
  isFirstElicitationFree,
  recordElicitation,
  elicitationCount,
} from "../src/db/ledger.js";
import { assertSameFlow, createAgent, pickOpponent, playableBands, roster, runMatch, setBand } from "../src/db/runner.js";
import { refreshTrueRatings } from "../src/db/rating.js";
import { someWallet } from "./helpers.js";

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

describe("balances", () => {
  it("are the sum of the ledger, and renting seeds the first movement", async () => {
    const a = await createAgent(db, { name: "Seeded", presetName: "Anchor" });
    expect(await balanceOf(db, a.id)).toBe(STARTING_BALANCE);

    await record(db, [{ agentId: a.id, amount: -30, reason: "match-settlement" }]);
    await record(db, [{ agentId: a.id, amount: 12, reason: "match-settlement" }]);
    expect(await balanceOf(db, a.id)).toBe(STARTING_BALANCE - 30 + 12);

    const rows = await statement(db, a.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.amount).toBe(12);
    expect(rows[rows.length - 1]!.reason).toBe("rental-seed");
    // Nothing is stored as a running total: the balance is recomputed from these.
    const summed = rows.reduce((s, r) => s + r.amount, 0);
    expect(summed).toBe(await balanceOf(db, a.id));
  });
});

describe("stakes", () => {
  it("know which bands a balance can still afford", () => {
    expect(affordableBands(900, SEED_CHIP_RATE)).toEqual(["A", "B", "C"]);
    expect(affordableBands(59, SEED_CHIP_RATE)).toEqual(["A", "B"]);
    expect(affordableBands(39, SEED_CHIP_RATE)).toEqual(["A"]);
    expect(affordableBands(19, SEED_CHIP_RATE)).toEqual([]);
    expect(canAffordBand(20, "A", SEED_CHIP_RATE)).toBe(true);
    expect(canAffordBand(19, "A", SEED_CHIP_RATE)).toBe(false);
  });

  it("ask the same question of a deposit-funded balance, in its own units", () => {
    // The same chip figures, six decimals down. What changes is the unit the
    // balance is counted in, never what a band costs.
    const rate = DEVNET_CHIP_RATE;
    expect(affordableBands(baseUnits(900, rate), rate)).toEqual(["A", "B", "C"]);
    expect(affordableBands(baseUnits(59, rate), rate)).toEqual(["A", "B"]);
    expect(affordableBands(baseUnits(19, rate), rate)).toEqual([]);
    expect(canAffordBand(baseUnits(20, rate), "A", rate)).toBe(true);
    expect(canAffordBand(baseUnits(20, rate) - 1, "A", rate)).toBe(false);

    // And a seed balance read at the deposit rate would be a millionth of what
    // it is - which is why the rate is required rather than defaulted.
    expect(canAffordBand(900, "A", rate)).toBe(false);
    expect(canAffordBand(900, "A", SEED_CHIP_RATE)).toBe(true);
  });

  it("normalise a net onto band B's scale so bands compare", () => {
    // A band C win of 30 is the same achievement as a band B win of 20.
    expect(normaliseNet(30, "C")).toBe(20);
    expect(normaliseNet(10, "A")).toBe(20);
    expect(normaliseNet(60, "C")).toBe(40);
    expect(normaliseNet(20, "B")).toBe(20);
    expect(bandByName("C").worstMatch).toBe(60);
  });

  it("scale every amount by one factor, so each band is the same game", () => {
    for (const band of ["A", "B", "C"] as const) {
      const b = bandByName(band);
      // The shape is fixed: ante : bet : raised stays 2 : 5 : 10 everywhere.
      expect(b.baseBet / b.ante).toBe(2.5);
      expect(b.raisedBet / b.baseBet).toBe(2);
      // The worst a match can move is two rounds at the raised bet: a match is
      // first to two, so the winner can never take a third.
      expect(b.worstMatch).toBe(b.raisedBet * 2);
    }
  });

  it("record a net as it stands: nothing is clamped any more", () => {
    expect(settle(45)).toBe(45);
    expect(settle(-45)).toBe(-45);
    expect(settle(0)).toBe(0);
  });
});

describe("settlement", () => {
  it("moves no money, whoever wins: a lost match costs nothing", async () => {
    const { db: d, close: c } = await fresh();
    const a = await createAgent(d, { name: "A", presetName: "Bully", ownerId: someWallet() });
    const b = await createAgent(d, { name: "B", presetName: "Mirage", ownerId: someWallet() });

    let decided = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { match, log, stake, settled } = await runMatch(d, a.id, b.id, { seed });
      // The match is still played in chips, and the row still says what it was played at.
      expect(stake).toBe(bandByName("B").worstMatch);
      expect(settled.A).toBe(settle(log.nets.A));
      if (settled.A !== 0) decided++;
      // But nothing moves: no ledger row, and nothing for the chain.
      expect(await d.select().from(ledger).where(eq(ledger.matchId, match.id))).toHaveLength(0);
      expect(await d.select().from(chainOps).where(eq(chainOps.matchId, match.id))).toHaveLength(0);
    }
    expect(decided).toBeGreaterThan(0);
    expect(await balanceOf(d, a.id)).toBe(STARTING_BALANCE);
    expect(await balanceOf(d, b.id)).toBe(STARTING_BALANCE);
    await c();
  });

  it("moves a full band C net, which no clamp would have allowed", async () => {
    const { db: d, close: c } = await fresh();
    const big = await createAgent(d, { name: "Big", presetName: "Bully", band: "C" });
    const bold = await createAgent(d, { name: "Bold", presetName: "Mirage", band: "C" });

    let sawBeyondBandB = false;
    for (let seed = 1; seed <= 200 && !sawBeyondBandB; seed++) {
      const before = { a: await balanceOf(d, big.id), b: await balanceOf(d, bold.id) };
      if (Math.min(before.a, before.b) < bandByName("C").worstMatch) break;
      const { stake, match } = await runMatch(d, big.id, bold.id, { seed });
      // The band alone sets the stake; balances beyond it buy nothing.
      expect(stake).toBe(60);
      const [row] = await d.select().from(matches).where(eq(matches.id, match.id));
      // Nothing is clamped: the recorded net is the net the engine produced.
      expect(row!.netA).toBe(row!.log.nets.A);
      expect(Math.abs(row!.netA)).toBeLessThanOrEqual(60);
      // Band B's widest possible net is 40; band C reaches past it.
      if (Math.abs(row!.netA) > 40) sawBeyondBandB = true;
    }
    // Band C really does move more than band B ever could.
    expect(sawBeyondBandB).toBe(true);
    await c();
  });

  it("the band decides who an agent is matched against", async () => {
    const { db: d, close: c } = await fresh();
    const owner = someWallet();
    const cautious = await createAgent(d, { name: "Cautious", presetName: "Anchor", ownerId: owner, band: "A" });
    // Four on the cheap scale, four on the dear one.
    const low = [];
    for (let i = 0; i < 4; i++) low.push(await createAgent(d, { name: `Low ${i}`, presetName: "Bully", band: "A", ownerId: someWallet() }));
    for (let i = 0; i < 4; i++) await createAgent(d, { name: `High ${i}`, presetName: "Hammer", band: "C", ownerId: someWallet() });
    await refreshTrueRatings(d);

    for (let i = 0; i < 20; i++) {
      const pick = await pickOpponent(d, cautious.id);
      expect(pick.band).toBe("A");
      expect(low.map((a) => a.id)).toContain(pick.opponentId);
    }

    // Changing band moves the agent to another scale, and another set of opponents.
    expect(await setBand(d, cautious.id, owner, "C")).toBe("C");
    const pick = await pickOpponent(d, cautious.id);
    expect(pick.band).toBe("C");
    expect(low.map((a) => a.id)).not.toContain(pick.opponentId);
    await expect(setBand(d, cautious.id, "88888888-8888-4888-8888-888888888888", "C")).rejects.toThrow(/another owner/);
    await c();
  });

  it("never pairs a wallet's own agents, even when the band is too thin to pick on rating", async () => {
    const { db: d, close: c } = await fresh();
    const owner = someWallet();
    // Two agents, one wallet, one band, and nobody else at all. The rating path
    // needs four candidates, so this always falls through to the preset one.
    const mine = await createAgent(d, { name: "Mine", presetName: "Anchor", ownerId: owner, band: "C" });
    await createAgent(d, { name: "Also mine", presetName: "Bully", ownerId: owner, band: "C" });
    await refreshTrueRatings(d);
    await expect(pickOpponent(d, mine.id)).rejects.toThrow(/no opponent in the C band/);

    // A stranger in the band is picked by that same fallback.
    const stranger = await createAgent(d, { name: "Stranger", presetName: "Hammer", ownerId: someWallet(), band: "C" });
    await refreshTrueRatings(d);
    const pick = await pickOpponent(d, mine.id);
    expect(pick.opponentId).toBe(stranger.id);
    expect(pick.path).toBe("preset-fallback");
    await c();
  });

  it("names a band that does have opponents when this one has none", async () => {
    const { db: d, close: c } = await fresh();
    const lonely = await createAgent(d, { name: "Lonely", presetName: "Anchor", ownerId: someWallet(), band: "C" });
    // Other players' agents: house ones would be no advice here, because this
    // call (no allowHouse, as autoplay makes it) never meets them.
    for (let i = 0; i < 3; i++) await createAgent(d, { name: `B ${i}`, presetName: "Bully", band: "B", ownerId: someWallet() });
    await createAgent(d, { name: "A one", presetName: "Mirage", band: "A", ownerId: someWallet() });
    await refreshTrueRatings(d);
    // Band B has the most ready opponents, so that is the one suggested.
    await expect(pickOpponent(d, lonely.id)).rejects.toThrow(/Band B has 3 agents ready to play/);

    // Counting is per band and respects the cover rule: an agent too poor for
    // its own band is not offered as a reason to go there.
    const counts = await playableBands(d, lonely.id, null, "seed");
    expect(counts.find((x) => x.band === "B")?.count).toBe(3);
    expect(counts.find((x) => x.band === "A")?.count).toBe(1);
    expect(counts.find((x) => x.band === "C")?.count).toBe(0);
    await c();
  });

  it("says so when nobody in the band can play", async () => {
    const { db: d, close: c } = await fresh();
    const lonely = await createAgent(d, { name: "Lonely", presetName: "Anchor", band: "A" });
    for (let i = 0; i < 4; i++) await createAgent(d, { name: `High ${i}`, presetName: "Bully", band: "C" });
    await expect(pickOpponent(d, lonely.id)).rejects.toThrow(/no opponent in the A band/);
    await c();
  });
});

describe("rating across bands", () => {
  it("normalises the ranked record onto band B's scale, so bands rank against each other", async () => {
    const { db: d, close: c } = await fresh();
    // The same preset, the same seed, the same opponent preset - one pair in
    // band A, one in band C. Owned on both sides, so the match is ranked. The
    // money differs by the scale; the ranked record must not.
    const results: Record<string, { cumulative: number; ranked: number; form: number; raw: number }> = {};
    for (const band of ["A", "C"] as const) {
      const a = await createAgent(d, { name: `A-${band}`, presetName: "Bully", band, ownerId: someWallet() });
      const b = await createAgent(d, { name: `B-${band}`, presetName: "Mirage", band, ownerId: someWallet() });
      const { match } = await runMatch(d, a.id, b.id, { seed: 7 });
      const [row] = await d.select().from(matches).where(eq(matches.id, match.id));
      const [rating] = await d.select().from(ratings).where(eq(ratings.agentId, a.id));
      results[band] = {
        cumulative: rating!.cumulativeNet,
        ranked: rating!.rankedNet,
        form: rating!.rollingNet50,
        raw: row!.netA,
      };
    }
    // Band C moved three times band A's money on the same match.
    expect(results["C"]!.raw).toBe(results["A"]!.raw * 3);
    // What the ladder ranks is identical, and on band B's scale: a band A net of n reads as 2n.
    expect(results["C"]!.ranked).toBe(results["A"]!.ranked);
    expect(results["C"]!.form).toBe(results["A"]!.form);
    expect(results["A"]!.ranked).toBe(results["A"]!.raw * 2);
    // But net won is money, and stays the money each band actually moved.
    expect(results["A"]!.cumulative).toBe(results["A"]!.raw);
    expect(results["C"]!.cumulative).toBe(results["C"]!.raw);
    await c();
  });

  it("keeps net won as the chips its matches were won by, though none of it is money", async () => {
    const { db: d, close: c } = await fresh();
    const me = await createAgent(d, { name: "Banded", presetName: "Mirage", band: "A", ownerId: someWallet() });
    const opp = await createAgent(d, { name: "Opp", presetName: "Anchor", band: "A", ownerId: someWallet() });
    let won = 0;
    for (let seed = 1; seed <= 12; seed++) won += (await runMatch(d, me.id, opp.id, { seed })).settled.A;
    const [rating] = await d.select().from(ratings).where(eq(ratings.agentId, me.id));
    expect(rating!.matchesPlayed).toBe(12);
    expect(rating!.cumulativeNet).toBe(won);
    expect(await balanceOf(d, me.id)).toBe(STARTING_BALANCE);
    await c();
  });
});

describe("running out", () => {
  it("never happens in a match: however many it loses, an agent keeps what it holds", async () => {
    const { db: d, close: c } = await fresh();
    const small = await createAgent(d, { name: "Small", presetName: "Mirage", band: "A", startingBalance: 24, ownerId: someWallet() });
    const rival = await createAgent(d, { name: "Rival", presetName: "Bully", band: "A", startingBalance: 900, ownerId: someWallet() });

    let lost = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const result = await runMatch(d, small.id, rival.id, { seed });
      expect(result.retired).toEqual([]);
      if (result.settled.A < 0) lost++;
    }
    expect(lost).toBeGreaterThan(0);
    expect(await balanceOf(d, small.id)).toBe(24);
    const [row] = await d.select().from(agents).where(eq(agents.id, small.id));
    expect(row!.retiredAt).toBeNull();
    await c();
  });

  it("is never offered as an opponent once it cannot cover a stake", async () => {
    const { db: d, close: c } = await fresh();
    // Players' agents: a house agent is never asked for a balance, since it never stakes.
    const seeker = await createAgent(d, { name: "Seeker", presetName: "Anchor", ownerId: someWallet() });
    const broke = await createAgent(d, { name: "Broke", presetName: "Bully", ownerId: someWallet(), startingBalance: bandByName("B").worstMatch - 1 });
    const solvent = [];
    for (let i = 0; i < 5; i++) solvent.push(await createAgent(d, { name: `Solvent ${i}`, presetName: "Hammer", ownerId: someWallet() }));
    await refreshTrueRatings(d);

    for (let i = 0; i < 20; i++) {
      const pick = await pickOpponent(d, seeker.id);
      expect(pick.opponentId).not.toBe(broke.id);
      expect(solvent.map((s) => s.id)).toContain(pick.opponentId);
    }
    await c();
  });
});

describe("first elicitation", () => {
  it("is free once per owner, then counts", async () => {
    const { db: d, close: c } = await fresh();
    const owner = someWallet();
    const other = "34343434-3434-4434-8434-343434343434";

    expect(await isFirstElicitationFree(d, owner)).toBe(true);
    await recordElicitation(d, { ownerId: owner, kind: "preview", free: true });
    expect(await isFirstElicitationFree(d, owner)).toBe(false);
    expect(await elicitationCount(d, owner)).toBe(1);

    await recordElicitation(d, { ownerId: owner, kind: "rent", free: false });
    expect(await elicitationCount(d, owner)).toBe(2);
    // Each owner gets their own first one.
    expect(await isFirstElicitationFree(d, other)).toBe(true);
    await c();
  });
});

describe("agents on different funding flows", () => {
  // Each vault is a token account for one mint under one program. There is no
  // instruction that moves tokens from a vault under one to a vault under the
  // other, so a match across them would be recorded, would move both ledgers,
  // and could never settle. That happened on 2026-09-25 before this existed.
  it("are told apart by the flow check", async () => {
    expect(() =>
      assertSameFlow({ name: "Deposited", funding: "deposit" }, { name: "Seeded", funding: "seed" }),
    ).toThrow(/different programs and cannot settle/);
    expect(() => assertSameFlow({ name: "A", funding: "seed" }, { name: "B", funding: "seed" })).not.toThrow();
  });

  it("are never offered to each other as opponents", async () => {
    const { db } = await connect();
    await migrate(db);
    const mine = await createAgent(db, { name: "Mine", presetName: "Anchor", ownerId: someWallet() });
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, mine.id));
    await record(db, [{ agentId: mine.id, amount: baseUnits(2_000, DEVNET_CHIP_RATE), reason: "deposit" }]);
    // Plenty of seed-funded opponents, all in the same band, all solvent.
    for (let i = 0; i < 4; i++) await createAgent(db, { name: `Seeded ${i}`, presetName: "Bully" });

    await expect(pickOpponent(db, mine.id)).rejects.toThrow(/no opponent/);
  });

  it("will play each other once both are on the same flow", async () => {
    const { db } = await connect();
    await migrate(db);
    const mine = await createAgent(db, { name: "Mine", presetName: "Anchor", ownerId: someWallet() });
    const other = await createAgent(db, { name: "Theirs", presetName: "Bully", ownerId: someWallet() });
    for (const id of [mine.id, other.id]) {
      await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, id));
      await record(db, [{ agentId: id, amount: baseUnits(2_000, DEVNET_CHIP_RATE), reason: "deposit" }]);
    }
    const pick = await pickOpponent(db, mine.id);
    expect(pick.opponentId).toBe(other.id);
  });
});

describe("lists that show many agents at once", () => {
  // Balances are the one money figure in these lists that is in an agent's own
  // units; everything else comes from match nets, which are chips whatever the
  // flow. Side by side, a base-unit balance reads as a million times richer.
  it("show every balance in chips, whichever program holds the vault", async () => {
    const { db } = await connect();
    await migrate(db);
    await createAgent(db, { name: "Seeded", presetName: "Anchor", ownerId: someWallet() });
    const deposited = await createAgent(db, { name: "Deposited", presetName: "Bully", ownerId: someWallet() });
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, deposited.id));
    // The same money, counted in each agent's own units.
    await record(db, [{ agentId: deposited.id, amount: baseUnits(900, DEVNET_CHIP_RATE), reason: "deposit" }]);

    const listed = await roster(db);
    const byName = new Map(listed.map((r) => [r.name, r.balance]));
    // 900 chips each: the seed agent's seed, and the deposit agent's deposit.
    expect(byName.get("Seeded")).toBe(900);
    expect(byName.get("Deposited")).toBe(900);
  });

  it("count a band's playable agents in each agent's own units", async () => {
    const { db } = await connect();
    await migrate(db);
    const me = await createAgent(db, { name: "Mine", presetName: "Anchor", ownerId: someWallet() });
    const rich = await createAgent(db, { name: "Rich", presetName: "Bully", ownerId: someWallet() });
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, rich.id));
    await record(db, [{ agentId: rich.id, amount: baseUnits(900, DEVNET_CHIP_RATE), reason: "deposit" }]);
    // A deposit agent holding 30 base units is holding nothing: it must not be
    // counted as covering a 40-chip band because 30 happens to look like chips.
    const pauper = await createAgent(db, { name: "Pauper", presetName: "Mirage", ownerId: someWallet() });
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, pauper.id));
    await record(db, [{ agentId: pauper.id, amount: 30 - 900, reason: "adjustment" }]);

    // Counted from a deposit agent's side: only its own program's agents count.
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, me.id));
    const counts = await playableBands(db, me.id, null, "deposit");
    const bandB = counts.find((c) => c.band === "B")!;
    expect(bandB.count).toBe(1);
  });

  it("never sends autoplay to a band whose only agents are house agents", async () => {
    // Korarwick again, once the deposit program had a house roster: autoplay
    // was told "Band A has 12 agents ready" - all house, which it never meets.
    const { db } = await connect();
    await migrate(db);
    const me = await createAgent(db, { name: "Waiting", presetName: "Anchor", ownerId: someWallet(), band: "C" });
    for (const band of ["A", "B"] as const) await createAgent(db, { name: `House ${band}`, presetName: "Bully", band });
    expect((await playableBands(db, me.id, me.ownerId, "seed", false)).every((c) => c.count === 0)).toBe(true);
    expect((await playableBands(db, me.id, me.ownerId, "seed", true)).find((c) => c.band === "A")?.count).toBe(1);
    await expect(pickOpponent(db, me.id, { spread: true })).rejects.toThrow(/no opponent in the C band.*press Play to take on a house agent/);
  });

  it("never names a band whose agents are all under the other program", async () => {
    // Korarwick, 2026-09-27: the first deposit agent to play was told "try C"
    // from B and "try B" from C, because the count included seed agents that
    // pickOpponent will never pair it with.
    const { db } = await connect();
    await migrate(db);
    const me = await createAgent(db, { name: "Funded", presetName: "Anchor", ownerId: someWallet() });
    await db.update(agents).set({ funding: "deposit" }).where(eq(agents.id, me.id));
    await record(db, [{ agentId: me.id, amount: baseUnits(900, DEVNET_CHIP_RATE) - 900, reason: "deposit" }]);
    for (const band of ["A", "B", "C"] as const) {
      await createAgent(db, { name: `Seeded ${band}`, presetName: "Bully", ownerId: someWallet(), band });
    }
    const counts = await playableBands(db, me.id, null, "deposit");
    expect(counts.every((c) => c.count === 0)).toBe(true);
    await expect(pickOpponent(db, me.id, { allowHouse: true })).rejects.toThrow(/plays only other agents you fund yourself/);
  });
});

