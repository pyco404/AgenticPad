import { describe, expect, it } from "vitest";
import { connect, migrate } from "../src/db/client.js";
import { adoptSeasonRate, DEVNET_CHIP_RATE, baseUnits } from "../src/chips.js";
import { MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import { convictionDays, holdingOf, holdingView, keeps, nextClock, readHolding, refreshHolders, type HoldingsChain } from "../src/db/holdings.js";
import { createAgent, runMatch } from "../src/db/runner.js";
import { computeDay, dayOf } from "../src/db/scores.js";
import { power, weight } from "../src/score.js";
import { someWallet } from "./helpers.js";

// Conviction on snapshots (docs/holder-agents.md, Conviction): the clock a
// wallet's holding keeps, read off the readings the server takes.

const DAY_MS = 86_400_000;
const MIN = baseUnits(MIN_FUNDING_CHIPS, DEVNET_CHIP_RATE);
const T0 = new Date("2026-04-01T12:00:00Z");
const later = (days: number) => new Date(T0.getTime() + days * DAY_MS);

describe("the clock", () => {
  it("starts at the first reading that holds the minimum, recording the minimum, not the holding", () => {
    expect(nextClock(null, MIN - 1, MIN, T0)).toBeNull();
    expect(nextClock(null, 10 * MIN, MIN, T0)).toEqual({ amount: MIN, since: T0 });
  });

  it("runs on through a top-up and through selling down to anything still at the conviction amount", () => {
    const clock = { amount: MIN, since: T0 };
    expect(nextClock(clock, 10 * MIN, MIN, later(1))).toBe(clock);
    expect(nextClock(clock, MIN, MIN, later(2))).toBe(clock);
  });

  it("resets on a reading below the conviction amount, and restarts there if the minimum still holds", () => {
    const clock = { amount: MIN, since: T0 };
    expect(nextClock(clock, MIN - 1, MIN, later(5))).toBeNull();
    // The minimum fell (the token rose): below the old amount, above the new minimum.
    expect(nextClock(clock, MIN - 1, MIN / 2, later(5))).toEqual({ amount: MIN / 2, since: later(5) });
  });

  it("is not touched by a retune that raises the minimum, and the wallet keeps its agent", () => {
    const clock = { amount: MIN, since: T0 };
    // The token halved: the minimum is now twice the tokens. The wallet has not sold.
    expect(nextClock(clock, MIN, 2 * MIN, later(30))).toBe(clock);
    expect(keeps({ amount: MIN, convictionAmount: MIN }, 2 * MIN)).toBe(true);
    // A new wallet with the same tokens does not qualify.
    expect(keeps({ amount: MIN, convictionAmount: null }, 2 * MIN)).toBe(false);
  });

  it("counts whole days", () => {
    expect(convictionDays(null, T0)).toBe(0);
    expect(convictionDays(T0, later(0.99))).toBe(0);
    expect(convictionDays(T0, later(90.5))).toBe(90);
  });
});

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c;
};

function holdingsOf(held: Map<string, number>): HoldingsChain {
  return { balanceOf: async (w) => held.get(w) ?? 0, supply: async () => 1_000_000_000 * DEVNET_CHIP_RATE };
}

describe("the clock through readings", () => {
  it("is kept on the holding, read by read, and shown to the owner", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const chain = holdingsOf(held);
    const wallet = someWallet();
    await createAgent(db, { name: "Clock", presetName: "Anchor", ownerId: wallet });

    held.set(wallet, 3 * MIN);
    await readHolding(db, chain, wallet, T0);
    held.set(wallet, MIN); // sold down, still at the conviction amount
    await refreshHolders(db, chain, later(40));
    let h = await holdingOf(db, wallet);
    expect(h!.convictionAmount).toBe(MIN);
    expect(h!.convictionSince).toEqual(T0);
    const view = holdingView(h, DEVNET_CHIP_RATE, later(40));
    expect(view.conviction.days).toBe(40);
    expect(view.conviction.chips).toBe(MIN_FUNDING_CHIPS);

    held.set(wallet, MIN - 1); // sold below it
    await refreshHolders(db, chain, later(41));
    h = await holdingOf(db, wallet);
    expect(h!.convictionSince).toBeNull();
    expect(holdingView(h, DEVNET_CHIP_RATE, later(41)).conviction.days).toBe(0);

    held.set(wallet, MIN); // bought back: a new clock, from this reading
    await refreshHolders(db, chain, later(42));
    expect((await holdingOf(db, wallet))!.convictionSince).toEqual(later(42));
    await close();
  });

  it("keeps a holder in play through a retune that raises the minimum, if it has not sold", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const chain = holdingsOf(held);
    const a = await createAgent(db, { name: "Kept", presetName: "Anchor", ownerId: someWallet() });
    const b = await createAgent(db, { name: "Also", presetName: "Hammer", ownerId: someWallet() });
    held.set(a.ownerId!, MIN);
    held.set(b.ownerId!, MIN);
    await refreshHolders(db, chain);
    adoptSeasonRate(2 * DEVNET_CHIP_RATE);
    try {
      await refreshHolders(db, chain);
      expect((await runMatch(db, a.id, b.id, { seed: 3 })).match.ranked).toBe(true);
      // A wallet that never qualified needs the new minimum.
      const c = await createAgent(db, { name: "New", presetName: "Bully", ownerId: someWallet() });
      held.set(c.ownerId!, MIN);
      await refreshHolders(db, chain);
      await expect(runMatch(db, a.id, c.id, { seed: 4 })).rejects.toThrow(/holds too little/);
    } finally {
      adoptSeasonRate(DEVNET_CHIP_RATE);
    }
    await close();
  });

  it("weights a day's score by the days the clock had run by that day's end", async () => {
    const { db, close } = await fresh();
    const held = new Map<string, number>();
    const chain = holdingsOf(held);
    const a = await createAgent(db, { name: "Ninety", presetName: "Anchor", ownerId: someWallet() });
    const b = await createAgent(db, { name: "Fresh", presetName: "Hammer", ownerId: someWallet() });
    held.set(a.ownerId!, MIN);
    held.set(b.ownerId!, MIN);
    const today = dayOf(new Date());
    // A qualified ninety days before today ended; B qualified today.
    await readHolding(db, chain, a.ownerId!, new Date((today + 1 - 90) * DAY_MS));
    await readHolding(db, chain, b.ownerId!, new Date());
    await runMatch(db, a.id, b.id, { seed: 5 });

    const rows = new Map((await computeDay(db, today, undefined, new Date((today + 1) * DAY_MS))).map((r) => [r.agentId, r]));
    expect(rows.get(a.id)!.convictionDays).toBe(90);
    expect(rows.get(a.id)!.weight).toBeCloseTo(weight(power({ convictionDays: 90, shareOfSupply: MIN / (1_000_000_000 * DEVNET_CHIP_RATE) })));
    expect(rows.get(b.id)!.convictionDays).toBe(0);
    await close();
  });
});
