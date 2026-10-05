import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { LaunchStore, type StoredLaunch } from "../lib/launchpad-store";
import { MarketStore } from "../lib/token-market";
import { getPumpToken, listPumpTokens } from "../lib/launchpad-server";
let store: LaunchStore;
vi.mock("../lib/launchpad-store", async (original) => {
  const actual = await original<typeof import("../lib/launchpad-store")>();
  return { ...actual, launchStore: () => store };
});
function record(name: string): StoredLaunch {
  const mint = Keypair.generate().publicKey.toBase58();
  return { id: mint, mint, owner: Keypair.generate().publicKey.toBase58(), createdAt: Date.now() - 86_400_000, form: { creator: mint, name, ticker: name, description: "", image: "", links: {}, initialBuySol: "0" }, uri: "", imageUrl: "", transaction: "", lastValidBlockHeight: 0, signature: "confirmed", signed: null, confirmed: true, failure: null };
}
afterAll(() => store?.db.close());
describe("public token lifecycle", () => {
  it("excludes archived tokens from lists, search, direct pages and counts while retaining admin records", async () => {
    store = new LaunchStore(":memory:");
    const active = record("Active"), archived = record("Archived");
    store.insert(active); store.insert(archived);
    const market = new MarketStore(store);
    market.save({ mint: archived.mint, checkedAt: Date.now(), observedAt: Date.now(), zeroSince: Date.now() - 12 * 3_600_000, inactiveAt: Date.now(), marketCapUsd: 100000, volume24hUsd: 0, priceUsd: 0.01, health: "ok" });
    expect(listPumpTokens({ sort: "newest" }).total).toBe(1);
    expect(listPumpTokens({ sort: "marketCap", search: "Archived" }).tokens).toEqual([]);
    expect(await getPumpToken(archived.mint)).toBeNull();
    expect(store.list()).toHaveLength(2);
    expect(store.getMint(archived.mint)?.confirmed).toBe(true);
  });
});
