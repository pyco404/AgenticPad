import { describe, expect, it } from "vitest";
import { INACTIVITY_MS, MarketStore, observeMarket, type Pair } from "../lib/token-market";
import { LaunchStore } from "../lib/launchpad-store";
import { AGP_MINT } from "../lib/agp";
const HOUR = 3_600_000;
const quiet: Pair = { chainId: "solana", pairAddress: "pool", baseToken: { address: "mint" }, quoteToken: { address: "sol" }, priceUsd: "0.01", marketCap: 1000, volume: { h1: 0, h24: 100 }, txns: { h1: { buys: 0, sells: 0 } } };
describe("token inactivity", () => {
  it("keeps AGP listed during prolonged inactivity while still updating market data", () => {
    const pair = { ...quiet, baseToken: { address: AGP_MINT } };
    let market = observeMarket(AGP_MINT, 0, [pair], null, HOUR);
    for (let hour = 2; hour <= 8; hour++) market = observeMarket(AGP_MINT, 0, [pair], market, hour * HOUR);
    expect(market.inactiveAt).toBeNull();
    expect(market.zeroSince).toBeNull();
    expect(market.volume24hUsd).toBe(100);
    expect(market.observedAt).toBe(8 * HOUR);
  });
  it("restores previously archived AGP immediately and during missing market data", () => {
    const store = new LaunchStore(":memory:");
    try {
      const markets = new MarketStore(store);
      const archived = { ...observeMarket(AGP_MINT, 0, [], null, HOUR), zeroSince: 0, inactiveAt: INACTIVITY_MS };
      markets.save(archived);
      expect(markets.visible(AGP_MINT)).toBe(true);
      expect(markets.get(AGP_MINT)!.inactiveAt).toBeNull();
      expect(markets.get(AGP_MINT)!.zeroSince).toBeNull();
      expect(observeMarket(AGP_MINT, 0, [], archived, 8 * HOUR).inactiveAt).toBeNull();
    } finally { store.db.close(); }
  });
  it("archives only after four overlapping hours of verified zero activity", () => {
    let market = observeMarket("mint", 0, [quiet], null, HOUR);
    expect(market.inactiveAt).toBeNull();
    for (let hour = 2; hour < INACTIVITY_MS / HOUR; hour++) market = observeMarket("mint", 0, [quiet], market, hour * HOUR);
    expect(market.inactiveAt).toBeNull();
    market = observeMarket("mint", 0, [quiet], market, INACTIVITY_MS);
    expect(market.inactiveAt).toBe(INACTIVITY_MS);
  });
  it("a sale, buy or volume resets inactivity; new launches get four hours", () => {
    const prev = observeMarket("mint", 0, [quiet], null, HOUR);
    const sale = { ...quiet, txns: { h1: { buys: 0, sells: 1 } } };
    expect(observeMarket("mint", 0, [sale], prev, 2 * HOUR).zeroSince).toBeNull();
    expect(observeMarket("mint", 0, [{ ...quiet, volume: { h1: 1, h24: 100 } }], prev, 2 * HOUR).zeroSince).toBeNull();
    expect(observeMarket("mint", 20 * HOUR, [quiet], null, 20 * HOUR).zeroSince).toBe(20 * HOUR);
  });
  it("outages and missing markets are not zero volume", () => {
    const prev = observeMarket("mint", 0, [quiet], null, HOUR);
    const failed = observeMarket("mint", 0, [], prev, 2 * HOUR);
    expect(failed.zeroSince).toBeNull();
    expect(failed.inactiveAt).toBeNull();
    const resumed = observeMarket("mint", 0, [quiet], failed, 13 * HOUR);
    expect(resumed.inactiveAt).toBeNull();
    expect(resumed.zeroSince).toBe(12 * HOUR);
  });
  it("deduplicates pools and considers activity in every matching pool", () => {
    const second = { ...quiet, pairAddress: "other", volume: { h1: 2, h24: 200 } };
    const market = observeMarket("mint", 0, [quiet, quiet, second], null, HOUR);
    expect(market.volume24hUsd).toBe(300);
    expect(market.zeroSince).toBeNull();
  });
  it("retains archived data for administrators while excluding it publicly", () => {
    const store = new LaunchStore(":memory:");
    const markets = new MarketStore(store);
    const market = { ...observeMarket("mint", 0, [quiet], null, HOUR), inactiveAt: INACTIVITY_MS };
    markets.save(market);
    expect(markets.visible("mint")).toBe(false);
    expect(markets.get("mint")!.inactiveAt).toBe(INACTIVITY_MS);
    store.db.close();
  });
});
