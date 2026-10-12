import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { createAgent } from "../src/db/runner.js";
import { MIN_FUNDING_CHIPS, dailyScores, agents } from "../src/db/schema.js";
import { health } from "../src/db/admin.js";
import { HOLDINGS_INTERVAL_MS, readHolding } from "../src/db/holdings.js";
import { freezeDay } from "../src/db/scores.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { everyoneHolds, someWallet } from "./helpers.js";

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
  it("protects payout recipients and refuses live scores", async () => {
    const path = `${url}/admin/payout-recipients?day=${new Date().toISOString().slice(0, 10)}`;
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(path, { headers: { authorization: `Bearer ${await signIn("somebody-else")}` } })).status).toBe(404);
    expect((await fetch(path, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } })).status).toBe(409);
  });
  it("serves a frozen recipient snapshot only to an admin", async () => {
    const day = Math.floor(Date.parse("2026-05-01T00:00:00Z") / 86_400_000);
    await freezeDay(db, day);
    const response = await fetch(`${url}/admin/payout-recipients?day=2026-05-01`, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ frozen: true, minScore: 0, winners: [], dropped: [] });
  });
  it("resolves each frozen winner's actual receiving wallet and capped share", async () => {
    const owner = someWallet();
    const agent = await createAgent(db, { name: "Payout winner", presetName: "Anchor", ownerId: owner });
    const day = Math.floor(Date.parse("2026-05-02T00:00:00Z") / 86_400_000);
    await freezeDay(db, day);
    await db.insert(dailyScores).values({ day, agentId: agent.id, rankedMatches: 3, points: 10, qualified: true, convictionDays: 0, shareOfSupply: 0, power: 0, weight: 1, score: 10 });
    const response = await fetch(`${url}/admin/payout-recipients?day=2026-05-02`, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ frozen: true, minScore: 0, winners: [{ agentId: agent.id, name: "Payout winner", wallet: owner, mint: "", share: 0.1 }], dropped: [] });
  });
  it("merges replacement agents into one capped payout wallet", async () => {
    const owner = someWallet();
    const first = await createAgent(db, { name: "First agent", presetName: "Anchor", ownerId: owner });
    await db.update(agents).set({ retiredAt: new Date(), retiredReason: "owner" }).where(eq(agents.id, first.id));
    const second = await createAgent(db, { name: "Replacement", presetName: "Mirage", ownerId: owner });
    const day = Math.floor(Date.parse("2026-05-03T00:00:00Z") / 86_400_000);
    await freezeDay(db, day);
    for (const agent of [first, second]) await db.insert(dailyScores).values({ day, agentId: agent.id, rankedMatches: 3, points: 10, qualified: true, convictionDays: 0, shareOfSupply: 0, power: 0, weight: 1, score: 10 });
    const response = await fetch(`${url}/admin/payout-recipients?day=2026-05-03`, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } });
    const body = await response.json() as { winners: { wallet: string; share: number; agentIds: string[] }[] };
    expect(body.winners).toHaveLength(1);
    expect(body.winners[0]!.wallet).toBe(owner);
    expect(body.winners[0]!.share).toBe(0.1);
    expect(new Set(body.winners[0]!.agentIds)).toEqual(new Set([first.id, second.id]));
  });
  it("pays a wallet's agents for different tokens independently, each capped", async () => {
    const owner = someWallet();
    const agp = await createAgent(db, { name: "AGP agent", presetName: "Anchor", ownerId: owner });
    const dox = await createAgent(db, { name: "DOX agent", presetName: "Mirage", ownerId: owner, holderMint: "DOXmint" });
    const day = Math.floor(Date.parse("2026-05-04T00:00:00Z") / 86_400_000);
    await freezeDay(db, day);
    for (const agent of [agp, dox]) await db.insert(dailyScores).values({ day, agentId: agent.id, rankedMatches: 3, points: 10, qualified: true, convictionDays: 0, shareOfSupply: 0, power: 0, weight: 1, score: 10 });
    const response = await fetch(`${url}/admin/payout-recipients?day=2026-05-04`, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } });
    const body = await response.json() as { winners: { agentId: string; wallet: string; mint: string; share: number }[] };
    expect(body.winners).toHaveLength(2);
    expect(new Set(body.winners.map((w) => w.mint))).toEqual(new Set(["", "DOXmint"]));
    expect(body.winners.every((w) => w.wallet === owner && w.share === 0.1)).toBe(true);
  });
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
  const DAY_MS = 86_400_000;
  const chainHolding = (amount: number) => ({ balanceOf: async () => amount, supply: async () => 1_000_000_000 * DEVNET_CHIP_RATE });

  it("counts the holders and the wallets read, and says when the readings have gone stale", async () => {
    const { db, close } = await connect();
    await migrate(db);
    try {
      const empty = await health(db);
      expect(empty.holders).toBe(0);
      expect(empty.holdings).toMatchObject({ wallets: 0, oldestReadAt: null, stale: false });

      const owner = someWallet();
      await createAgent(db, { name: "Read", presetName: "Anchor", ownerId: owner });
      const readAt = new Date("2026-05-01T12:00:00Z");
      await readHolding(db, chainHolding(baseUnits(MIN_FUNDING_CHIPS, DEVNET_CHIP_RATE)), owner, readAt);

      const fresh = await health(db, new Date(readAt.getTime() + HOLDINGS_INTERVAL_MS));
      expect(fresh.holders).toBe(1);
      expect(fresh.holdings.wallets).toBe(1);
      expect(fresh.holdings.stale).toBe(false);

      // Three missed passes: something has stopped reading wallets.
      const late = await health(db, new Date(readAt.getTime() + 3 * HOLDINGS_INTERVAL_MS + 1));
      expect(late.holdings.stale).toBe(true);
      expect(late.holdings.oldestAgeMs).toBe(3 * HOLDINGS_INTERVAL_MS + 1);
    } finally {
      await close();
    }
  });

  it("says how far behind the score freeze is", async () => {
    const { db, close } = await connect();
    await migrate(db);
    try {
      expect((await health(db)).scores).toEqual({ lastFrozen: null, behind: 0 });
      const day = Math.floor(Date.parse("2026-05-04T00:00:00Z") / DAY_MS);
      await freezeDay(db, day, new Date((day + 1) * DAY_MS));
      const h = await health(db, new Date((day + 4) * DAY_MS + 1));
      expect(h.scores.lastFrozen).toBe("2026-05-04");
      // Today is day+4, so day+1, day+2 and day+3 are over and not frozen.
      expect(h.scores.behind).toBe(3);
    } finally {
      await close();
    }
  });
});

describe("payout recipients are checked at payout", () => {
  let checked: { url: string; close: () => Promise<void> };
  const held = new Map<string, number>();
  beforeAll(async () => {
    checked = await listen({ db, adminWallets: [ADMIN], nonceRateLimit: { limit: 1000, windowMs: 60_000 }, holder: everyoneHolds(held) });
  });
  afterAll(async () => { await checked.close(); });
  const recipients = async (day: string, query = "") => {
    const session = url; url = checked.url;
    try {
      const response = await fetch(`${url}/admin/payout-recipients?day=${day}${query}`, { headers: { authorization: `Bearer ${await signIn("the-operator")}` } });
      return { status: response.status, body: await response.json() as { winners: { wallet: string; share: number }[]; dropped: { wallet: string; reason: string }[] } };
    } finally { url = session; }
  };
  async function winners(day: string, scores: number[]) {
    const owners = scores.map(() => someWallet());
    const d = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
    await freezeDay(db, d);
    for (const [i, owner] of owners.entries()) {
      const agent = await createAgent(db, { name: `Winner ${i}`, presetName: "Anchor", ownerId: owner });
      await db.insert(dailyScores).values({ day: d, agentId: agent.id, rankedMatches: 3, points: scores[i]!, qualified: true, convictionDays: 0, shareOfSupply: 0, power: 0, weight: 1, score: scores[i]! });
    }
    return owners;
  }

  it("drops a winner who has sold, and re-shares among those still holding", async () => {
    // Twenty winners of 50 points: 5% each as frozen. One sells; the other nineteen share its 5%.
    const owners = await winners("2026-06-01", Array.from({ length: 20 }, () => 50));
    held.set(owners[0]!, 0);
    const { status, body } = await recipients("2026-06-01");
    expect(status).toBe(200);
    expect(body.dropped).toEqual([expect.objectContaining({ wallet: owners[0], reason: "holds under $20" })]);
    expect(body.winners).toHaveLength(19);
    expect(body.winners.every((w) => Math.abs(w.share - 1 / 19) < 1e-12)).toBe(true);
  });
  it("keeps the 10% cap after re-sharing: what it holds back stays in the wallet", async () => {
    const owners = await winners("2026-06-02", [50, 50, 50]);
    held.set(owners[2]!, 0);
    const { body } = await recipients("2026-06-02");
    expect(body.winners.map((w) => w.share)).toEqual([0.1, 0.1]);
  });
  it("drops scores under the minimum score before re-sharing", async () => {
    const owners = await winners("2026-06-03", [400, 300, 15]);
    const { body } = await recipients("2026-06-03", "&minScore=20");
    expect(body.dropped).toEqual([expect.objectContaining({ wallet: owners[2], reason: "below minimum score" })]);
    expect(body.winners.map((w) => w.wallet)).toEqual([owners[0], owners[1]]);
    expect((await recipients("2026-06-03", "&minScore=-1")).status).toBe(400);
  });
});
