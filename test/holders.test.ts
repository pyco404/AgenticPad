import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { balanceOf } from "../src/db/ledger.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { agents, ledger, chainOps, MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import { holderCount, holdingMinimum, holdingOf, refreshHolders, type HoldingsChain } from "../src/db/holdings.js";
import { liveCounters } from "../src/db/feed.js";
import { pickOpponent, runMatch, StakeError } from "../src/db/runner.js";

// Holder agents (docs/holder-agents.md): a wallet holding the token above the
// minimum has an agent. Nothing is rented, deposited or moved; the server only
// reads the wallet, and that reading is the agent's balance everywhere a
// balance is checked.

const MIN = baseUnits(MIN_FUNDING_CHIPS, DEVNET_CHIP_RATE);
const SUPPLY = 1_000_000_000 * DEVNET_CHIP_RATE;

/** A wallet's holdings as the chain would report them, and a switch to make it unreachable. */
class FakeHoldings implements HoldingsChain {
  held = new Map<string, number>();
  down = false;
  reads = 0;
  async balanceOf(wallet: string) {
    this.reads++;
    if (this.down) throw new Error("rpc throttled");
    return this.held.get(wallet) ?? 0;
  }
  async supply() {
    if (this.down) throw new Error("rpc throttled");
    return SUPPLY;
  }
}

let db: Db;
let closeDb: () => Promise<void>;
let url: string;
let closeServer: () => Promise<void>;
const chain = new FakeHoldings();

const seedOf = (label: string) => createHash("sha256").update(label).digest();
const walletOf = (label: string) => Keypair.fromSeed(seedOf(label)).publicKey.toBase58();
const tokens = new Map<string, string>();

async function tokenFor(label: string): Promise<string> {
  if (tokens.has(label)) return tokens.get(label)!;
  const kp = nacl.sign.keyPair.fromSeed(seedOf(label));
  const publicKey = bs58.encode(kp.publicKey);
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
      (r) => r.json() as Promise<Record<string, string>>,
    );
  const issued = await post("/auth/nonce", { publicKey });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(issued["message"]!), kp.secretKey));
  const { token } = await post("/auth/verify", { publicKey, nonce: issued["nonce"], signature });
  tokens.set(label, token!);
  return token!;
}

const api = async (path: string, init: { method?: string; body?: unknown; as: string }) => {
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${await tokenFor(init.as)}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

/** Every wallet here is on the holder flow except this one. */
const OUTSIDER = "not-a-holder";

beforeAll(async () => {
  ({ db, close: closeDb } = await connect());
  await migrate(db);
  ({ url, close: closeServer } = await listen({
    db,
    holder: { chain, allow: (o) => o !== walletOf(OUTSIDER) },
    rateLimit: { limit: 1000, windowMs: 60_000 },
    rentRateLimit: { limit: 1000, windowMs: 60_000 },
    rentAddressRateLimit: { limit: 1000, windowMs: 60_000 },
    nonceRateLimit: { limit: 1000, windowMs: 60_000 },
    playRateLimit: { limit: 1000, windowMs: 60_000 },
  }));
});
afterAll(async () => {
  await closeServer();
  await closeDb();
});

describe("holder agents", () => {
  it("prices the minimum in tokens from the chips, at the season's rate", () => {
    expect(holdingMinimum()).toBe(MIN);
    // A rate that doubles - the token halved in price - doubles the tokens it takes.
    expect(holdingMinimum(2 * DEVNET_CHIP_RATE)).toBe(2 * MIN);
  });

  it("turns a wallet below the minimum away, with the figures, and creates nothing", async () => {
    chain.held.set(walletOf("short"), MIN - 1);
    const out = await api("/agents", { method: "POST", body: { presetName: "Anchor" }, as: "short" });
    expect(out.status).toBe(403);
    expect(out.body.holding.eligible).toBe(false);
    expect(out.body.holding.minimumChips).toBe(MIN_FUNDING_CHIPS);
    expect(out.body.holding.chips).toBe(MIN_FUNDING_CHIPS - 1);
    expect(await db.select().from(agents).where(eq(agents.ownerId, walletOf("short")))).toEqual([]);
  });

  it("gives a wallet at the minimum an agent with nothing rented, deposited or queued", async () => {
    chain.held.set(walletOf("holds"), MIN);
    const out = await api("/agents", { method: "POST", body: { presetName: "Anchor" }, as: "holds" });
    expect(out.status).toBe(201);
    expect(out.body.agent.canPlay).toBe(true);
    const id = out.body.agent.id as string;
    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    expect(row!.funding).toBe("holder");
    // Not rented, so it does not end with the season.
    expect(row!.rentalEndsAt).toBeNull();
    // No ledger and no vault: its balance is the wallet's holding.
    expect(await db.select().from(ledger).where(eq(ledger.agentId, id))).toEqual([]);
    expect(await db.select().from(chainOps).where(eq(chainOps.agentId, id))).toEqual([]);
    expect(await balanceOf(db, id)).toBe(MIN);

    // Its owner sees the wallet, the clock and the weight they earn; nothing about a rental.
    const own = await api(`/agents/${id}`, { as: "holds" });
    expect(own.body.view).toBe("owner");
    expect(own.body.holder.holding.eligible).toBe(true);
    expect(own.body.holder.holding.conviction.chips).toBe(MIN_FUNDING_CHIPS);
    expect(own.body.holder.power.convictionDays).toBe(0);
    expect(own.body.holder.power.weight).toBeGreaterThanOrEqual(1);
    expect(own.body.holder.power.weight).toBeLessThan(1.01);
  });

  it("tells a signed-in wallet which flow it is on and what it holds", async () => {
    chain.held.set(walletOf("asks"), MIN + 5 * DEVNET_CHIP_RATE);
    await api("/holding", { method: "POST", as: "asks" });
    const me = await api("/auth/me", { as: "asks" });
    expect(me.body.holding.chips).toBe(MIN_FUNDING_CHIPS + 5);
    expect(me.body.holding.eligible).toBe(true);
    // Off the flow there is no holding to show.
    const other = await api("/auth/me", { as: OUTSIDER });
    expect(other.body.holding).toBeNull();
    expect((await api("/holding", { as: OUTSIDER })).status).toBe(404);
  });

  it("refuses rather than guesses when the wallet cannot be read", async () => {
    chain.held.set(walletOf("unread"), MIN * 10);
    chain.down = true;
    try {
      const out = await api("/agents", { method: "POST", body: { presetName: "Anchor" }, as: "unread" });
      expect(out.status).toBe(503);
      expect(await db.select().from(agents).where(eq(agents.ownerId, walletOf("unread")))).toEqual([]);
      // A failed read is not a reading of zero: nothing is recorded.
      expect(await holdingOf(db, walletOf("unread"))).toBeNull();
    } finally {
      chain.down = false;
    }
  });

  it("takes an agent out of play when its owner sells below the minimum, and back in when they buy back", async () => {
    const make = async (label: string) => {
      chain.held.set(walletOf(label), MIN);
      const out = await api("/agents", { method: "POST", body: { presetName: "Hammer" }, as: label });
      expect(out.status).toBe(201);
      return out.body.agent.id as string;
    };
    const a = await make("plays-a");
    const b = await make("plays-b");

    const played = await runMatch(db, a, b, { seed: 7 });
    // Two players' agents: it counts.
    expect(played.match.ranked).toBe(true);

    chain.held.set(walletOf("plays-b"), MIN - 1);
    await refreshHolders(db, chain);
    await expect(runMatch(db, a, b, { seed: 8 })).rejects.toThrow(StakeError);
    await expect(runMatch(db, a, b, { seed: 8 })).rejects.toThrow(/holds too little/);
    // And the matchmaker no longer offers it.
    const pick = await pickOpponent(db, a, { minCandidates: 1 }).catch(() => null);
    expect(pick?.opponentId).not.toBe(b);

    chain.held.set(walletOf("plays-b"), MIN);
    await refreshHolders(db, chain);
    expect((await runMatch(db, a, b, { seed: 9 })).match.ranked).toBe(true);
  });

  it("keeps a wallet's last reading when a scheduled read fails, and says so", async () => {
    const wallet = walletOf("plays-a");
    const before = await holdingOf(db, wallet);
    chain.down = true;
    try {
      const result = await refreshHolders(db, chain);
      expect(result.read).toBe(0);
      expect(result.failed.map((f) => f.wallet)).toContain(wallet);
    } finally {
      chain.down = false;
    }
    expect(await holdingOf(db, wallet)).toEqual(before);
  });

  it("counts each wallet holding an agent in play once, and drops one that sells below", async () => {
    const before = await holderCount(db);
    chain.held.set(walletOf("counted"), MIN);
    expect((await api("/agents", { method: "POST", body: { presetName: "Bully" }, as: "counted" })).status).toBe(201);
    expect(await holderCount(db)).toBe(before + 1);
    expect((await liveCounters(db, new Date())).holders).toBe(before + 1);
    chain.held.set(walletOf("counted"), MIN - 1);
    await refreshHolders(db, chain);
    expect(await holderCount(db)).toBe(before);
  });

  it("records the supply with each reading, for position", async () => {
    await refreshHolders(db, chain);
    expect((await holdingOf(db, walletOf("plays-a")))!.supply).toBe(SUPPLY);
  });
});
