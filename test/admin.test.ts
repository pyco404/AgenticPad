import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { connect, migrate, type Db } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { createAgent } from "../src/db/runner.js";
import { stakedMatch } from "./staked-match.js";
import { chainOps, rentals, STARTING_BALANCE } from "../src/db/schema.js";
import { troubledOps, oldestPending, volume } from "../src/db/admin.js";
import { reconcile, solvency } from "../src/chain/worker.js";
import { drainChainOps } from "../src/chain/worker.js";
import { FakeChain } from "./fake-chain.js";
import { someWallet } from "./helpers.js";

/** Deterministic keypairs, as http.test.ts does: nothing asserts an identity it has not signed for. */
const keypairs = new Map<string, nacl.SignKeyPair>();
const keypairFor = (label: string) => {
  let kp = keypairs.get(label);
  if (!kp) {
    kp = nacl.sign.keyPair.fromSeed(createHash("sha256").update(label).digest());
    keypairs.set(label, kp);
  }
  return kp;
};
const walletOf = (label: string) => bs58.encode(keypairFor(label).publicKey);

let db: Db;
let url: string;
let closeServer: () => Promise<void>;
let closeDb: () => Promise<void>;
let healthCalls = 0;

const ADMIN = walletOf("the-operator");

async function signIn(label: string): Promise<string> {
  const kp = keypairFor(label);
  const publicKey = bs58.encode(kp.publicKey);
  const issued = (await (
    await fetch(`${url}/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey }),
    })
  ).json()) as any;
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(issued.message), kp.secretKey));
  const session = (await (
    await fetch(`${url}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey, nonce: issued.nonce, signature }),
    })
  ).json()) as any;
  return session.token as string;
}

const get = (token?: string) =>
  fetch(`${url}/admin`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

beforeAll(async () => {
  ({ db, close: closeDb } = await connect());
  await migrate(db);
  ({ url, close: closeServer } = await listen({
    db,
    adminWallets: [ADMIN],
    nonceRateLimit: { limit: 1000, windowMs: 60_000 },
    health: async () => {
      healthCalls++;
      return { ok: true };
    },
  }));
});
afterAll(async () => {
  await closeServer();
  await closeDb();
});

describe("who may read /admin", () => {
  it("needs a session at all", async () => {
    // 401, not 404: being signed out says nothing about who may read this.
    expect((await get()).status).toBe(401);
  });

  it("is a 404 for a signed-in wallet that is not on the list, not a 403", async () => {
    // A 403 would confirm the page exists to anyone who asked.
    const before = healthCalls;
    const res = await get(await signIn("somebody-else"));
    expect(res.status).toBe(404);
    // And nothing was read to answer them.
    expect(healthCalls).toBe(before);
  });

  it("answers the wallet on the list", async () => {
    const res = await get(await signIn("the-operator"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("has no admin at all when no wallet was configured", async () => {
    // A deployment that forgets ADMIN_WALLETS gets no admin page, not an open one.
    const c = await connect();
    await migrate(c.db);
    const server = await listen({ db: c.db, nonceRateLimit: { limit: 1000, windowMs: 60_000 }, health: async () => ({ ok: true }) });
    const saved = url;
    url = server.url;
    try {
      expect((await get(await signIn("the-operator"))).status).toBe(404);
    } finally {
      url = saved;
      await server.close();
      await c.close();
    }
  });
});

describe("what it reports", () => {
  const fresh = async () => {
    const c = await connect();
    await migrate(c.db);
    return c;
  };

  it("adds the ledger and the vaults to the same number when nothing is wrong", async () => {
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Sa", presetName: "Bully", ownerId: someWallet() });
    const b = await createAgent(d, { name: "Sb", presetName: "Anchor", ownerId: someWallet() });
    for (let i = 0; i < 4; i++) await stakedMatch(d, a.id, b.id, { seed: 70 + i });
    await drainChainOps(d, chain, { limit: 200 });

    const sums = await solvency(d, chain);
    expect(sums.counted).toBe(2);
    expect(sums.unreachable).toBe(0);
    expect(sums.inFlight).toEqual({});
    // Per flow, never summed: the two programs hold different mints.
    expect(Object.keys(sums.byFlow)).toEqual(["seed"]);
    expect(sums.byFlow.seed!.difference).toBe(0);
    expect(sums.byFlow.seed!.ledger).toBe(sums.byFlow.seed!.chain);
    await close();
  });

  it("shows the shortfall as a negative difference when a vault is drained", async () => {
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Da", presetName: "Bully", ownerId: someWallet() });
    await createAgent(d, { name: "Db", presetName: "Anchor", ownerId: someWallet() });
    await drainChainOps(d, chain, { limit: 200 });

    chain.vaults.set(a.id, (chain.vaults.get(a.id) ?? 0) - 250);
    const sums = await solvency(d, chain);
    expect(sums.byFlow.seed!.difference).toBe(-250);
    expect(sums.byFlow.seed!.chain).toBeLessThan(sums.byFlow.seed!.ledger);
    await close();
  });

  it("counts agents with ops in flight rather than quietly leaving them out", async () => {
    // reconcile skips them on purpose; a total that did would exclude exactly
    // the agents something is happening to.
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Fa", presetName: "Bully", ownerId: someWallet() });
    const b = await createAgent(d, { name: "Fb", presetName: "Anchor", ownerId: someWallet() });
    await drainChainOps(d, chain, { limit: 200 });
    await stakedMatch(d, a.id, b.id, { seed: 5 });

    const sums = await solvency(d, chain);
    expect(sums.counted).toBe(2);
    // Only the flow it belongs to: never a figure across both mints.
    expect(Object.keys(sums.inFlight)).toEqual(["seed"]);
    expect(sums.inFlight.seed).toBeGreaterThan(0);
    // The settlement has moved the ledger but not the vaults, so the totals
    // still agree: it takes from one and gives to the other.
    expect(sums.byFlow.seed!.difference).toBe(0);
    await close();
  });

  it("separates ops given up on from ops still being retried", async () => {
    const { db: d, close } = await fresh();
    const a = await createAgent(d, { name: "Ta", presetName: "Anchor", ownerId: someWallet() });
    const old = new Date(Date.now() - 60 * 60_000);
    await d.insert(chainOps).values([
      { kind: "settle", fromAgent: a.id, amount: 10, status: "failed", lastError: "its vault can never open", createdAt: old },
      { kind: "settle", fromAgent: a.id, amount: 20, status: "pending", lastError: "Error Code: OutflowLimit", createdAt: old, attempts: 9 },
    ]);

    const t = await troubledOps(d, 15 * 60_000);
    expect(t.failed).toHaveLength(1);
    expect(t.failed[0]!.lastError).toMatch(/never open/);
    expect(t.stuck.some((o) => o.lastError?.includes("OutflowLimit"))).toBe(true);
    // Both name the agent, because an id alone is no use at three in the morning.
    expect(t.failed[0]!.agentName).toBe("Ta");

    const oldestOp = await oldestPending(d);
    expect(oldestOp?.attempts).toBe(9);
    await close();
  });

  it("counts what happened without claiming to measure it twice", async () => {
    const { db: d, close } = await fresh();
    const a = await createAgent(d, { name: "Va", presetName: "Bully", ownerId: someWallet() });
    const b = await createAgent(d, { name: "Vb", presetName: "Anchor", ownerId: someWallet() });
    const h = await createAgent(d, { name: "Vh", presetName: "Anchor" });
    for (let i = 0; i < 3; i++) await stakedMatch(d, a.id, b.id, { seed: 800 + i });
    await stakedMatch(d, a.id, h.id, { seed: 999 });

    const v = await volume(d);
    expect(v.agents.active).toBe(2);
    expect(v.agents.house).toBe(1);
    expect(v.matches.staked).toBe(3);
    expect(v.matches.ranked).toBe(3);
    expect(v.matches.exhibitions).toBe(1);
    expect(v.matches.last24h).toBe(4);
    expect(v.deposits.confirmed).toBe(0);
    await close();
  });
});

describe("a vault that could not be read", () => {
  const fresh = async () => {
    const c = await connect();
    await migrate(c.db);
    return c;
  };

  it("is not a disagreement, because it says nothing about the money", async () => {
    // This is the bug that had the drift alarm reporting healthy vaults as
    // drained: the read failed, the failure became null, and null read as
    // "no vault". On a server with 493 rate-limit errors in its log that made
    // the alarm permanent, and an alarm that is usually wrong is ignored.
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Throttled", presetName: "Anchor", ownerId: someWallet() });
    await drainChainOps(d, chain, { limit: 200 });
    chain.unreadable.add(a.id);

    const check = await reconcile(d, chain);
    expect(check.mismatches).toEqual([]);
    expect(check.unverified).toHaveLength(1);
    expect(check.unverified[0]).toMatchObject({ agentId: a.id, name: "Throttled", ledger: STARTING_BALANCE });
    expect(check.unverified[0]!.why).toMatch(/429/);
    await close();
  });

  it("still reports a vault that genuinely is not there", async () => {
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Missing", presetName: "Anchor", ownerId: someWallet() });
    await drainChainOps(d, chain, { limit: 200 });
    chain.vaults.delete(a.id);

    const check = await reconcile(d, chain);
    expect(check.unverified).toEqual([]);
    expect(check.mismatches).toHaveLength(1);
    expect(check.mismatches[0]).toMatchObject({ name: "Missing", chain: null });
    await close();
  });

  it("is left out of the solvency total, and counted as left out", async () => {
    const { db: d, close } = await fresh();
    const chain = new FakeChain();
    const a = await createAgent(d, { name: "Ua", presetName: "Anchor", ownerId: someWallet() });
    await createAgent(d, { name: "Ub", presetName: "Anchor", ownerId: someWallet() });
    await drainChainOps(d, chain, { limit: 200 });
    chain.unreadable.add(a.id);

    const sums = await solvency(d, chain);
    expect(sums.counted).toBe(1);
    expect(sums.unreachable).toBe(1);
    expect(sums.byFlow.seed!.difference).toBe(0);
    await close();
  });
});

describe("money in from owners' wallets", () => {
  it("counts the deposit made at rent time, not only later top-ups", async () => {
    // The deposits table holds top-ups only. The deposit an owner makes when
    // they rent is part of the rental transaction, so counting the table alone
    // read "0 chips" on a server that had taken 1,800 - and an operator
    // checking whether money was arriving would have believed it.
    const c = await connect();
    await migrate(c.db);
    const d = c.db;
    const owner = someWallet();
    const agent = await createAgent(d, { name: "Renter", presetName: "Anchor", ownerId: owner, funding: "deposit" });
    await d.insert(rentals).values({
      agentId: agent.id,
      ownerId: owner,
      fee: 200_000_000,
      deposit: 900_000_000,
      salt: "s",
      preparedTx: "x",
      lastValidBlockHeight: 1,
      status: "confirmed",
    });

    const v = await volume(d);
    expect(v.deposits.atRentChips).toBe(900);
    expect(v.deposits.topUpChips).toBe(0);
    expect(v.deposits.chips).toBe(900);
    expect(v.deposits.confirmed).toBe(1);
    expect(v.rentals.burnedChips).toBe(200);
    await c.close();
  });
});
