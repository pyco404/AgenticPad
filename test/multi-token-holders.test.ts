import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { and, eq, isNull } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { activateHolder, endHolder } from "../src/db/holder-activation.js";
import { holdingOf, keeps, readHolding, type HoldingsChain } from "../src/db/holdings.js";
import { agents } from "../src/db/schema.js";
import { balanceOf, inPlayOf } from "../src/db/ledger.js";
import { pickOpponent, runMatch } from "../src/db/runner.js";
import { useLiveHolderPricing } from "../src/holder-policy.js";
let db: Db; let close: () => Promise<void>;
beforeAll(async () => { const conn = await connect(); db = conn.db; close = conn.close; await migrate(db); }, 30_000);
afterAll(async () => { useLiveHolderPricing(false); await close(); });
const wallet = Keypair.generate().publicKey.toBase58();
function reader(mint: string, state: { amount: number; price?: number; at?: number; down?: boolean }): HoldingsChain {
  return { mint, balanceOf: async () => { if (state.down) throw new Error("RPC unavailable"); return state.amount; }, supply: async () => 1_000_000,
    quote: () => ({ minimum: Math.ceil(20 / (state.price ?? 1)), priceUsd: state.price ?? 1, decimals: 0, at: state.at ?? Date.now() }) };
}
const mintA = Keypair.generate().publicKey.toBase58();
const mintB = Keypair.generate().publicKey.toBase58();
const a = { amount: 20 }; const b = { amount: 30 };
const chainA = reader(mintA, a); const chainB = reader(mintB, b);
describe("one independent holder agent per wallet and launch token", () => {
  it("creates distinct autoplay agents, with independent balances and no duplicates under concurrent activation", async () => {
    await readHolding(db, chainA, wallet); await readHolding(db, chainB, wallet);
    await Promise.all([activateHolder(db, wallet, mintA), activateHolder(db, wallet, mintA), activateHolder(db, wallet, mintB)]);
    const rows = await db.select().from(agents).where(and(eq(agents.ownerId, wallet), isNull(agents.retiredAt)));
    expect(rows).toHaveLength(2); expect(rows.every(r => r.autoplay)).toBe(true);
    expect(await balanceOf(db, rows.find(r => r.holderMint === mintA)!.id)).toBe(20);
    expect(await balanceOf(db, rows.find(r => r.holderMint === mintB)!.id)).toBe(30);
  });
  it("pauses and resumes only the matching token without changing its strategy or identity", async () => {
    const agentA = (await activateHolder(db, wallet, mintA))!;
    const agentB = (await activateHolder(db, wallet, mintB))!;
    a.amount = 19; await readHolding(db, chainA, wallet);
    expect(await activateHolder(db, wallet, mintA)).toBeNull();
    expect((await inPlayOf(db, [agentA.id, agentB.id])).get(agentA.id)).toBe(false);
    expect((await inPlayOf(db, [agentA.id, agentB.id])).get(agentB.id)).toBe(true);
    a.amount = 20; await readHolding(db, chainA, wallet);
    expect((await activateHolder(db, wallet, mintA))!.id).toBe(agentA.id);
  });
  it("removes a zero-balance token agent and recreates only that token when it qualifies again", async () => {
    const old = (await activateHolder(db, wallet, mintA))!;
    const other = (await activateHolder(db, wallet, mintB))!;
    a.amount = 0; await readHolding(db, chainA, wallet); await activateHolder(db, wallet, mintA);
    const [row] = await db.select().from(agents).where(eq(agents.id, old.id));
    expect(row!.retiredReason).toBe("no-holdings"); expect(row!.autoplay).toBe(false);
    expect((await activateHolder(db, wallet, mintB))!.id).toBe(other.id);
    a.amount = 20; await readHolding(db, chainA, wallet);
    expect((await activateHolder(db, wallet, mintA))!.id).not.toBe(old.id);
  });
  it("does not retire on failed RPC reads and rejects stale quotes even if the primary price is unavailable", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const state = { amount: 20, down: false, at: Date.now() }; const chain = reader(mint, state);
    useLiveHolderPricing(true);
    await readHolding(db, chain, wallet); const row = (await activateHolder(db, wallet, mint))!;
    expect((await inPlayOf(db, [row.id])).get(row.id)).toBe(true);
    state.down = true; await expect(readHolding(db, chain, wallet)).rejects.toThrow();
    expect((await holdingOf(db, wallet, mint))!.amount).toBe(20);
    state.down = false; state.at = Date.now() - 16*60_000; await readHolding(db, chain, wallet);
    expect(keeps(await holdingOf(db, wallet, mint))).toBe(false);
    expect((await inPlayOf(db, [row.id])).get(row.id)).toBe(false);
    useLiveHolderPricing(false);
  });
  it("ending one token opts out only that token and prevents self-wallet match farming", async () => {
    const agentA = (await activateHolder(db, wallet, mintA))!;
    const agentB = (await activateHolder(db, wallet, mintB))!;
    await expect(runMatch(db, agentA.id, agentB.id)).rejects.toThrow("same wallet");
    await expect(pickOpponent(db, agentA.id)).rejects.toThrow("no opponent");
    expect(await endHolder(db, wallet, agentA.id)).toBe(true);
    expect(await activateHolder(db, wallet, mintA)).toBeNull();
    expect((await activateHolder(db, wallet, mintB))!.id).toBe(agentB.id);
  });
});
