import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { connect, migrate } from "../src/db/client.js";
import { agents, chainOps, ledger, matches, MIN_FUNDING_CHIPS, ratings } from "../src/db/schema.js";
import { balanceOf } from "../src/db/ledger.js";
import { createAgent, pickOpponent, runExhibition, runMatch } from "../src/db/runner.js";
import { agentRecord, matchActivity, recentMatches } from "../src/db/feed.js";
import { pickHousePair, startHouseExhibitions } from "../src/db/house.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { StakeError } from "../src/db/ledger.js";
import { someWallet, createPlayer } from "./helpers.js";

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c;
};

describe("house exhibitions", () => {
  it("record a match and move nothing: no ledger, no chain, no balance, no rating", async () => {
    const { db, close } = await fresh();
    const a = await createAgent(db, { name: "HouseA", presetName: "Mirage" });
    const b = await createAgent(db, { name: "HouseB", presetName: "Bully" });
    const count0 = async (t: typeof ledger | typeof chainOps) => (await db.select({ n: count() }).from(t))[0]!.n;
    const [ledgerBefore, opsBefore] = [await count0(ledger), await count0(chainOps)];
    const [balA, balB] = [await balanceOf(db, a.id), await balanceOf(db, b.id)];

    for (let seed = 1; seed <= 5; seed++) await runExhibition(db, a.id, b.id, { seed });

    expect(await count0(ledger)).toBe(ledgerBefore);
    expect(await count0(chainOps)).toBe(opsBefore);
    expect(await balanceOf(db, a.id)).toBe(balA);
    expect(await balanceOf(db, b.id)).toBe(balB);
    const [rating] = await db.select().from(ratings).where(eq(ratings.agentId, a.id));
    expect(rating?.matchesPlayed ?? 0).toBe(0);
    expect(await agentRecord(db, a.id)).toEqual({ wins: 0, losses: 0, level: 0 });

    const feed = await recentMatches(db, { limit: 10 });
    expect(feed).toHaveLength(5);
    expect(feed.every((m) => m.exhibition)).toBe(true);
    await close();
  });

  it("never count toward a rating or record once the agent plays a real match", async () => {
    const { db, close } = await fresh();
    const a = await createAgent(db, { name: "HouseA", presetName: "Mirage" });
    const b = await createAgent(db, { name: "HouseB", presetName: "Bully" });
    for (let seed = 1; seed <= 4; seed++) await runExhibition(db, a.id, b.id, { seed });
    // A real match needs two players: a house agent stakes nothing, so it would
    // be another exhibition and would count for nothing either.
    const p1 = await createPlayer(db, { name: "P1", presetName: "Anchor", ownerId: someWallet() });
    const p2 = await createPlayer(db, { name: "P2", presetName: "Hammer", ownerId: someWallet() });
    const { settled } = await runMatch(db, p1.id, p2.id, { seed: 99 });

    const [rating] = await db.select().from(ratings).where(eq(ratings.agentId, p1.id));
    expect(rating!.matchesPlayed).toBe(1);
    expect(rating!.cumulativeNet).toBe(settled.A);
    // The four exhibitions left the house agents' records untouched.
    const houseRecord = await agentRecord(db, a.id);
    expect(houseRecord.wins + houseRecord.losses + houseRecord.level).toBe(0);
    const record = await agentRecord(db, p1.id);
    expect(record.wins + record.losses + record.level).toBe(1);
    await close();
  });

  it("refuses player agents: an exhibition only ever involves the house", async () => {
    const { db, close } = await fresh();
    const house = await createAgent(db, { name: "House", presetName: "Anchor" });
    const mine = await createPlayer(db, { name: "Mine", presetName: "Hammer", ownerId: someWallet() });
    await expect(runExhibition(db, house.id, mine.id)).rejects.toThrow(StakeError);
    await expect(runExhibition(db, house.id, house.id)).rejects.toThrow(StakeError);
    expect((await db.select({ n: count() }).from(matches))[0]!.n).toBe(0);
    await close();
  });

  it("spreads pairings across the roster instead of repeating one matchup", async () => {
    const { db, close } = await fresh();
    for (let i = 0; i < 6; i++) await createAgent(db, { name: `H${i}`, presetName: (["Anchor", "Bully", "Mirage"] as const)[i % 3]! });
    await createPlayer(db, { name: "Player", presetName: "Hammer", ownerId: someWallet() });
    let state = 7;
    const random = (n: number) => (state = (state * 1103515245 + 12345) % 2 ** 31) % n;

    const pairs: string[] = [];
    for (let i = 0; i < 15; i++) {
      const pair = await pickHousePair(db, random);
      expect(pair).not.toBeNull();
      await runExhibition(db, pair![0], pair![1], { seed: i + 1 });
      pairs.push([...pair!].sort().join("|"));
    }
    // 6 agents make 15 possible pairs; the picker should reach most of them without repeats piling up.
    expect(new Set(pairs).size).toBeGreaterThanOrEqual(12);
    const plays = new Map<string, number>();
    for (const p of pairs) for (const id of p.split("|")) plays.set(id, (plays.get(id) ?? 0) + 1);
    expect(Math.max(...plays.values()) - Math.min(...plays.values())).toBeLessThanOrEqual(2);
    const player = (await db.select().from(agents).where(eq(agents.name, "Player")))[0]!;
    expect(plays.has(player.id)).toBe(false);
    await close();
  });

  // The wait below is the point of the test, so its budget has to be comfortably
  // inside the timeout: at the default 5s they were equal, and a loaded suite
  // failed here for no reason but contention.
  it("pairs anyone with anyone, and does not stall on a freshly seeded one", async () => {
    const { db, close } = await fresh();
    // The whole house is one pool: any house agent can meet any other.
    const house = new Set<string>();
    for (let i = 0; i < 12; i++) house.add((await createAgent(db, { name: `H${i}`, presetName: "Anchor" })).id);

    // Run the real loop's own steps: pick, then play. Every pick must be
    // playable, so no exhibition is ever refused and every agent gets a turn.
    const played = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const pair = await pickHousePair(db);
      expect(pair).not.toBeNull();
      const [x, y] = pair!;
      expect(house.has(x) && house.has(y)).toBe(true);
      await runExhibition(db, x, y, { seed: k + 1 });
      played.add(x).add(y);
    }
    // Nobody is stuck on zero.
    expect(played.size).toBe(house.size);
    await close();
  });

  it("asks no balance of anyone", async () => {
    const { db, close } = await fresh();
    const b1 = await createAgent(db, { name: "B1", presetName: "Anchor" });
    // A house agent holds nothing, and it does not matter: an exhibition
    // moves nothing, so it needs no money to play one.
    const poor = await createAgent(db, { name: "Poor", presetName: "Mirage" });

    for (let k = 0; k < 20; k++) {
      const pair = await pickHousePair(db);
      expect(pair).not.toBeNull();
      expect([...pair!].sort()).toEqual([b1.id, poor.id].sort());
    }
    await close();
  });

  it("schedules nothing with fewer than two house agents", async () => {
    const { db, close } = await fresh();
    await createAgent(db, { name: "Only", presetName: "Anchor" });
    expect(await pickHousePair(db)).toBeNull();
    await close();
  });

  it("keeps playing when run the way the server runs it, with no callbacks", async () => {
    const { db, close } = await fresh();
    for (let i = 0; i < 3; i++) await createAgent(db, { name: `H${i}`, presetName: "Anchor" });
    const loop = startHouseExhibitions(db, { intervalMs: 20 });
    try {
      const deadline = Date.now() + 5000;
      let n = 0;
      while (Date.now() < deadline && n < 3) {
        await new Promise((r) => setTimeout(r, 50));
        n = (await db.select({ n: count() }).from(matches))[0]!.n;
      }
      expect(n).toBeGreaterThanOrEqual(3);
    } finally {
      loop.stop();
    }
    await close();
  }, 20_000);

  it("leave platform activity to staked matches only", async () => {
    const { db, close } = await fresh();
    const a = await createAgent(db, { name: "HouseA", presetName: "Mirage" });
    const b = await createAgent(db, { name: "HouseB", presetName: "Bully" });
    for (let seed = 1; seed <= 3; seed++) await runExhibition(db, a.id, b.id, { seed });
    expect(await matchActivity(db)).toEqual({ stakedMatches: 0, totalStaked: 0, largestPot: 0, exhibitions: 3 });

    // A staked match needs two players. Between house agents there is nothing at
    // stake, so it would be a fourth exhibition rather than the platform's first
    // pot.
    const p1 = await createPlayer(db, { name: "P1", presetName: "Anchor", ownerId: someWallet() });
    const p2 = await createPlayer(db, { name: "P2", presetName: "Hammer", ownerId: someWallet() });
    const played = await runMatch(db, p1.id, p2.id, { seed: 5 });
    const activity = await matchActivity(db);
    expect(activity.stakedMatches).toBe(1);
    expect(activity.totalStaked).toBe(played.stake * 2);
    expect(activity.largestPot).toBe(Math.abs(played.settled.A));
    expect(activity.exhibitions).toBe(3);
    await close();
  });
});

describe("house agents with no balance", () => {
  // They never stake, so nothing may be asked of their balance: they hold none.
  const houseWithNothing = (db: Awaited<ReturnType<typeof fresh>>["db"], name: string) =>
    createAgent(db, { name, presetName: "Bully" });
  const player = (db: Awaited<ReturnType<typeof fresh>>["db"], name: string) =>
    createPlayer(db, { name, presetName: "Anchor", ownerId: someWallet() });

  it("is offered to a player who asks for the house, and played, with nothing moving", async () => {
    const { db, close } = await fresh();
    const me = await player(db, "Me");
    const house = await houseWithNothing(db, "Empty");
    expect(await balanceOf(db, house.id)).toBe(0);
    const pick = await pickOpponent(db, me.id, { allowHouse: true, minCandidates: 1 });
    expect(pick.opponentId).toBe(house.id);
    const played = await runMatch(db, me.id, house.id, { seed: 3 });
    expect(played.match.exhibition).toBe(true);
    // Not retired as broke for holding nothing: it was never meant to hold anything.
    const [after] = await db.select().from(agents).where(eq(agents.id, house.id));
    expect(after!.retiredAt).toBeNull();
    expect(await balanceOf(db, me.id)).toBe(baseUnits(MIN_FUNDING_CHIPS, DEVNET_CHIP_RATE));
    await close();
  });

  it("is still never offered to autoplay, which meets players only", async () => {
    const { db, close } = await fresh();
    const me = await player(db, "Me");
    await houseWithNothing(db, "Empty");
    await expect(pickOpponent(db, me.id, { spread: true })).rejects.toThrow(/no opponent/);
    await close();
  });

  it("plays exhibitions against another with nothing", async () => {
    const { db, close } = await fresh();
    const a = await houseWithNothing(db, "EmptyA");
    const b = await houseWithNothing(db, "EmptyB");
    const pair = await pickHousePair(db);
    expect([...pair!].sort()).toEqual([a.id, b.id].sort());
    await runExhibition(db, a.id, b.id, { seed: 1 });
    expect((await db.select({ n: count() }).from(matches))[0]!.n).toBe(1);
    await close();
  });

  it("does not excuse a player: one holding less than the minimum is still never offered", async () => {
    const { db, close } = await fresh();
    const me = await player(db, "Me");
    await createPlayer(db, { name: "Skint", presetName: "Hammer", ownerId: someWallet(), holds: baseUnits(MIN_FUNDING_CHIPS - 1, DEVNET_CHIP_RATE) });
    const fine = await player(db, "Fine");
    for (let i = 0; i < 10; i++) {
      const pick = await pickOpponent(db, me.id, { minCandidates: 1 });
      expect(pick.opponentId).toBe(fine.id);
    }
    await close();
  });
});
