import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { agentEvents, agents, matches, ratings, seasonStandings, seasons } from "../src/db/schema.js";
import { createAgent, DEFAULT_RULES, leaderboard, runMatch } from "../src/db/runner.js";
import { nextSeason, seasonAt } from "../src/season.js";
import { closeSeason, seasonTick } from "../src/db/seasons.js";
import { standings } from "../src/db/standings.js";
import { someWallet, createPlayer } from "./helpers.js";

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c;
};

/**
 * Opponents for a player agent, owned by wallets of their own. They have to be
 * players: a match against a house agent stakes nothing and is recorded as an
 * exhibition, so it would neither settle nor reach a standing.
 */
const opponents = async (db: Db, n: number) => {
  const made = [];
  for (let i = 0; i < n; i++) {
    made.push(
      await createPlayer(db, {
        name: `H${i}-${Math.random().toString(36).slice(2, 6)}`,
        presetName: (["Anchor", "Hammer", "Mirage", "Bully"] as const)[i % 4]!,
        ownerId: someWallet(),
      }),
    );
  }
  return made;
};

/** Ends an agent's rental a minute ago, as the season boundary would. */
/** Unowned agents, for the tests that need one to play against. */
const house = async (db: Db, n: number) => {
  const made = [];
  for (let i = 0; i < n; i++) {
    made.push(await createAgent(db, { name: `House${i}-${Math.random().toString(36).slice(2, 6)}`, presetName: "Anchor" }));
  }
  return made;
};

describe("a season, with nothing rented", () => {
  it("never ends an agent: neither a player's nor a house agent's runs out with the season", async () => {
    const { db, close } = await fresh();
    const player = await createPlayer(db, { name: "P", presetName: "Anchor", ownerId: someWallet() });
    const h = await createAgent(db, { name: "H", presetName: "Anchor" });
    expect(player.rentalEndsAt).toBeNull();
    expect(h.rentalEndsAt).toBeNull();
    await close();
  });

  it("records each match in the season it was played in", async () => {
    const { db, close } = await fresh();
    const [opp] = await opponents(db, 1);
    const player = await createPlayer(db, { name: "P", presetName: "Anchor", ownerId: someWallet() });
    const { match } = await runMatch(db, player.id, opp!.id, { seed: 3 });
    expect(match.season).toBe(seasonAt(match.createdAt).key);
    await close();
  });
});

describe("the season boundary", () => {
  /** Two players who have played each other, and a house agent they have both played. */
  const season = async (db: Db) => {
    await house(db, 4);
    const [h] = await house(db, 1);
    const a = await createPlayer(db, { name: "A", presetName: "Hammer", ownerId: someWallet() });
    const b = await createPlayer(db, { name: "B", presetName: "Mirage", ownerId: someWallet() });
    for (let seed = 1; seed <= 6; seed++) await runMatch(db, a.id, b.id, { seed });
    await runMatch(db, a.id, h!.id, { seed: 7 });
    await runMatch(db, b.id, h!.id, { seed: 8 });
    return { a, b, current: seasonAt(new Date()) };
  };
  const eventsOf = async (db: Db, id: string) =>
    // Sorted: events written in one transaction share a timestamp, so their order is not the point.
    (await db.select().from(agentEvents).where(eq(agentEvents.agentId, id))).map((e) => `${e.source} ${e.kind}`).sort();

  it("freezes standings with the same figures the all-time ladder keeps, when every match is in one season", async () => {
    const { db, close } = await fresh();
    const { a, b, current } = await season(db);
    const result = await closeSeason(db, current.key, current.end);
    expect(result).toMatchObject({ closed: true, standings: 2 });
    const frozen = await db.select().from(seasonStandings).where(eq(seasonStandings.season, current.key)).orderBy(seasonStandings.rank);
    expect(frozen.map((r) => r.rank)).toEqual([1, 2]);
    for (const row of frozen) {
      const [r] = await db.select().from(ratings).where(eq(ratings.agentId, row.agentId));
      expect(row.rankedMatches).toBe(r!.rankedMatches);
      expect(row.rankedNet).toBe(r!.rankedNet);
      expect(row.totalMatches).toBe(r!.matchesPlayed);
      expect(row.totalNet).toBe(r!.cumulativeNet);
    }
    // The house match each played counts in neither. Staked and ranked are the
    // same question now: a match against a house agent stakes nothing, so it is
    // an exhibition and reaches no figure at all - where it used to reach the
    // totals but not the ranked ones.
    expect(frozen.every((r) => r.totalMatches === r.rankedMatches)).toBe(true);
    expect(new Set(frozen.map((r) => r.agentId))).toEqual(new Set([a.id, b.id]));
    // The next season exists, and this one is closed.
    const [row] = await db.select().from(seasons).where(eq(seasons.key, current.key));
    expect(row!.status).toBe("closed");
    expect((await db.select().from(seasons).where(eq(seasons.key, nextSeason(current).key)))).toHaveLength(1);
    await close();
  });

  it("closes exactly once: a second run, as after a restart, changes nothing", async () => {
    const { db, close } = await fresh();
    const { a, current } = await season(db);
    await db.update(agents).set({ autoplay: true }).where(eq(agents.id, a.id));
    await closeSeason(db, current.key, current.end);
    const before = { standings: await db.select().from(seasonStandings), events: await db.select().from(agentEvents) };
    const again = await closeSeason(db, current.key, new Date(current.end.getTime() + 60_000));
    expect(again.closed).toBe(false);
    expect(await db.select().from(seasonStandings)).toEqual(before.standings);
    expect(await db.select().from(agentEvents)).toEqual(before.events);
    // And a season that has not ended cannot be closed early.
    await expect(closeSeason(db, nextSeason(current).key, current.end)).rejects.toThrow(/has not ended/);
    await close();
  });

  it("leaves a holder agent's autoplay on through the boundary: nothing was rented, so nothing ended", async () => {
    const { db, close } = await fresh();
    const current = seasonAt(new Date());
    const holder = await createPlayer(db, { name: "Holds", presetName: "Anchor", ownerId: someWallet() });
    await db.update(agents).set({ autoplay: true }).where(eq(agents.id, holder.id));
    await closeSeason(db, current.key, current.end);
    const [row] = await db.select().from(agents).where(eq(agents.id, holder.id));
    expect(row!.autoplay).toBe(true);
    expect(row!.autoplayStoppedReason).toBeNull();
    expect(row!.rentalEndsAt).toBeNull();
    expect(await eventsOf(db, holder.id)).toEqual([]);
    await close();
  });

  it("catches up after downtime: one pass closes every ended season and opens the current one", async () => {
    const { db, close } = await fresh();
    const { current } = await season(db);
    // The api was down from before the boundary until two days after it.
    const later = new Date(current.end.getTime() + 2 * 86_400_000);
    const tick = await seasonTick(db, later);
    expect(tick.closed.map((c) => c.key)).toEqual([current.key]);
    expect((await db.select().from(seasons).where(eq(seasons.key, seasonAt(later).key)))[0]!.status).toBe("open");
    expect((await seasonTick(db, later)).closed).toEqual([]);
    await close();
  });

  it("counts a season's matches only, so a later season starts from nothing", async () => {
    const { db, close } = await fresh();
    const { current } = await season(db);
    expect((await standings(db, { season: current.key })).length).toBe(2);
    expect(await standings(db, { season: nextSeason(current).key })).toEqual([]);
    await close();
  });
});

describe("ladder views", () => {
  const played = async (db: Db) => {
    await house(db, 4);
    const [h] = await house(db, 1);
    const a = await createPlayer(db, { name: "A", presetName: "Hammer", ownerId: someWallet() });
    const b = await createPlayer(db, { name: "B", presetName: "Mirage", ownerId: someWallet() });
    const idle = await createPlayer(db, { name: "Idle", presetName: "Anchor", ownerId: someWallet() });
    for (let seed = 1; seed <= 5; seed++) await runMatch(db, a.id, b.id, { seed });
    await runMatch(db, a.id, h!.id, { seed: 9 });
    return { a, b, idle, current: seasonAt(new Date()) };
  };
  const strip = (rows: Awaited<ReturnType<typeof leaderboard>>) =>
    rows.map((r) => ({ agentId: r.agentId, matchesPlayed: r.matchesPlayed, cumulativeNet: r.cumulativeNet, totalMatches: r.totalMatches, totalNet: r.totalNet }));

  it("ranks the same figures in all three views when every match is today and this season", async () => {
    const { db, close } = await fresh();
    const { idle, current } = await played(db);
    const all = (await leaderboard(db, 50, "winnings")).filter((r) => r.agentId !== idle.id);
    const season = await leaderboard(db, 50, "winnings", { period: "season", season: current.key });
    const day = await leaderboard(db, 50, "winnings", { period: "day", since: new Date(Date.now() - 60 * 60 * 1000) });
    expect(strip(season)).toEqual(strip(all));
    expect(strip(day)).toEqual(strip(all));
    // All time lists an agent that has not played; a season or a day lists only those that did.
    expect((await leaderboard(db, 50, "winnings")).map((r) => r.agentId)).toContain(idle.id);
    expect(season.map((r) => r.agentId)).not.toContain(idle.id);
    await close();
  });

  it("counts only its own window", async () => {
    const { db, close } = await fresh();
    const { current } = await played(db);
    expect(await leaderboard(db, 50, "winnings", { period: "day", since: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await leaderboard(db, 50, "winnings", { period: "season", season: nextSeason(current).key })).toEqual([]);
    await close();
  });

  it("reads a closed season's frozen standings, which a later change cannot move", async () => {
    const { db, close } = await fresh();
    const { a, b, current } = await played(db);
    const live = await leaderboard(db, 50, "winnings", { period: "season", season: current.key });
    await closeSeason(db, current.key, current.end);
    // Something lands in the closed season after it closed: final placement must not see it.
    await db.insert(matches).values({
      agentA: a.id, agentB: b.id, seed: 99, rulesConfig: DEFAULT_RULES, winner: "B", netA: -40, netB: 40,
      stake: 40, ranked: true, season: current.key, log: { rounds: [] } as never,
    });
    const frozen = await leaderboard(db, 50, "winnings", { period: "season", season: current.key });
    expect(strip(frozen)).toEqual(strip(live));
    await close();
  });

  it("per match needs a ranked match to divide by, and a house match is not one", async () => {
    const { db, close } = await fresh();
    await house(db, 4);
    const [h] = await house(db, 1);
    const solo = await createPlayer(db, { name: "Solo", presetName: "Hammer", ownerId: someWallet() });
    await runMatch(db, solo.id, h!.id, { seed: 2 });
    const current = seasonAt(new Date());

    // Solo has played, but only the house - which stakes nothing and is
    // recorded as an exhibition. So it has no ranked match to divide by, and
    // nothing to be ranked on either: it appears in neither view. There is no
    // longer a "staked but unranked" middle for it to sit in.
    expect(await leaderboard(db, 50, "winnings", { period: "season", season: current.key })).toEqual([]);
    expect(await leaderboard(db, 50, "per-match", { period: "season", season: current.key })).toEqual([]);

    // A real opponent puts it in both.
    const rival = await createPlayer(db, { name: "Rival", presetName: "Mirage", ownerId: someWallet() });
    await runMatch(db, solo.id, rival.id, { seed: 3 });
    const winnings = await leaderboard(db, 50, "winnings", { period: "season", season: current.key });
    expect(winnings.map((r) => r.agentId).sort()).toEqual([solo.id, rival.id].sort());
    expect((await leaderboard(db, 50, "per-match", { period: "season", season: current.key })).length).toBe(2);
    await close();
  });
});
