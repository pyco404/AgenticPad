import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { connect, migrate, type Db } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { createAgent } from "../src/db/runner.js";
import { MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import { health } from "../src/db/admin.js";
import { HOLDINGS_INTERVAL_MS, readHolding } from "../src/db/holdings.js";
import { freezeDay } from "../src/db/scores.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
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
      await createAgent(db, { name: "Read", presetName: "Anchor", ownerId: owner, funding: "holder" });
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
