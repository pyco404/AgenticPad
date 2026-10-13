import { Keypair } from "@solana/web3.js";
import { checkAgent, autoplayStatus } from "../src/db/autoplay.js";
import { inPlayOf } from "../src/db/ledger.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { activateHolder, endHolder } from "../src/db/holder-activation.js";
import { readHolding, refreshHolders, holdingMinimum, keeps } from "../src/db/holdings.js";
import { agents } from "../src/db/schema.js";
import { PRESET_NAMES } from "../src/presets.js";
import { createAgent } from "../src/db/runner.js";
import { adoptHolderPrice, holderPriceReady, useLiveHolderPricing } from "../src/holder-policy.js";
let db: Db;
let close: () => Promise<void>;
beforeAll(async () => { const connection = await connect(); db = connection.db; close = connection.close; await migrate(db); }, 30_000);
afterAll(async () => { useLiveHolderPricing(false); await close(); });
const wallet = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const discovered = Keypair.generate().publicKey.toBase58();
const below = Keypair.generate().publicKey.toBase58();
const chain = { balanceOf: async () => holdingMinimum(), supply: async () => 1e15 };
describe("automatic holder activation", () => {
  it("creates one autoplay agent and does not repick on repeated activation", async () => {
    await readHolding(db, chain, wallet);
    const first = await activateHolder(db, wallet);
    expect(first).not.toBeNull();
    const [row] = await db.select().from(agents).where(eq(agents.id, first!.id));
    expect(row!.autoplay).toBe(true);
    expect(PRESET_NAMES).toContain(row!.presetName);
    expect((await activateHolder(db, wallet))!.id).toBe(first!.id);
  });
  it("ending is owner checked and opts out even after a holding refresh", async () => {
    const first = await activateHolder(db, wallet);
    expect(await endHolder(db, other, first!.id)).toBe(false);
    expect(await endHolder(db, wallet, first!.id)).toBe(true);
    await readHolding(db, chain, wallet);
    expect(await activateHolder(db, wallet)).toBeNull();
    const manual = await createAgent(db, { ownerId: wallet, autoplay: true, name: "My choice", presetName: "Mirage" });
    expect(manual.autoplay).toBe(true);
    expect(manual.presetName).toBe("Mirage");
  });
  it("discovers and activates qualifying wallets without a browser session", async () => {
    const result = await refreshHolders(db, { ...chain, discoverWallets: async () => [discovered ] });
    expect(result.failed).toEqual([]);
    expect((await db.select().from(agents).where(eq(agents.ownerId, discovered))).length).toBe(1);
  });
  it("reads the whole holder base from one listing, not a request per wallet", async () => {
    // A known holder who sold everything, a new holder above the minimum, and one below it.
    const sold = Keypair.generate().publicKey.toBase58(), newcomer = Keypair.generate().publicKey.toBase58(), small = Keypair.generate().publicKey.toBase58();
    await readHolding(db, chain, sold); await activateHolder(db, sold);
    let perWallet = 0, listings = 0;
    const result = await refreshHolders(db, { ...chain,
      balanceOf: async () => { perWallet++; return 0; },
      balances: async () => { listings++; return new Map([[newcomer, holdingMinimum()], [small, holdingMinimum() - 1]]); } });
    expect(result.failed).toEqual([]);
    expect(listings).toBe(1);
    // Only wallets the listing leaves out are read directly, to confirm a zero before it ends an agent.
    const known = (await db.selectDistinct({ w: agents.ownerId }).from(agents).where(eq(agents.funding, "holder"))).length;
    expect(perWallet).toBeLessThan(known);
    // Missing from the listing and confirmed empty: the agent ends. The newcomer gets one; the small holder does not.
    expect((await db.select().from(agents).where(eq(agents.ownerId, sold)))[0]!.retiredAt).not.toBeNull();
    expect((await db.select().from(agents).where(eq(agents.ownerId, newcomer))).length).toBe(1);
    expect((await db.select().from(agents).where(eq(agents.ownerId, small))).length).toBe(0);
  });
  it("falls back to a read per wallet when the listing fails", async () => {
    let perWallet = 0;
    const result = await refreshHolders(db, { ...chain,
      balanceOf: async () => { perWallet++; return holdingMinimum(); },
      balances: async () => { throw new Error("listing down"); } });
    expect(perWallet).toBeGreaterThan(0);
    expect(result.failed).toEqual([expect.objectContaining({ wallet: "discovery" })]);
  });
  it("never creates an agent below the threshold", async () => {
    await readHolding(db, { ...chain, balanceOf: async () => holdingMinimum() - 1 }, below);
    expect(await activateHolder(db, below)).toBeNull();
  });
});
describe("live $20 eligibility", () => {
  it("uses the same live threshold in matchmaking SQL and resumes the existing agent", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    useLiveHolderPricing(true);
    try {
      adoptHolderPrice(0.01, 6);
      await readHolding(db, chain, owner);
      const row = await activateHolder(db, owner);
      expect((await inPlayOf(db, [row!.id])).get(row!.id)).toBe(true);
      adoptHolderPrice(0.005, 6);
      expect((await inPlayOf(db, [row!.id])).get(row!.id)).toBe(false);
      const [paused] = await db.select().from(agents).where(eq(agents.id, row!.id));
      expect((await checkAgent(db, paused!)).play).toBe(false);
      expect((await autoplayStatus(db, paused!)).enabled).toBe(true);
      expect((await autoplayStatus(db, paused!)).message).toContain("$20");
      await readHolding(db, chain, owner);
      expect((await inPlayOf(db, [row!.id])).get(row!.id)).toBe(true);
      expect((await activateHolder(db, owner))!.id).toBe(row!.id);
    } finally { useLiveHolderPricing(false); }
  });
  it("uses current price, pauses below $20 and rejects stale prices", () => {
    useLiveHolderPricing(true);
    try {
      expect(holderPriceReady()).toBe(false);
      adoptHolderPrice(0.01, 6);
      expect(holdingMinimum()).toBe(2_000_000_000);
      const holding = { amount: 2_000_000_000, convictionAmount: 1, readAt: new Date() };
      expect(keeps(holding)).toBe(true);
      expect(keeps({ ...holding, amount: 1_999_999_999 })).toBe(false);
      adoptHolderPrice(0.005, 6);
      expect(keeps(holding)).toBe(false);
      adoptHolderPrice(0.01, 6, Date.now() - 16 * 60_000);
      expect(keeps(holding)).toBe(false);
    } finally { useLiveHolderPricing(false); }
  });
});
