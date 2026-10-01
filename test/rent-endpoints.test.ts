import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { connect, migrate, type Db } from "../src/db/client.js";
import { listen } from "../src/http/server.js";
import { balanceOf } from "../src/db/ledger.js";
import { baseUnits, DEVNET_CHIP_RATE } from "../src/chips.js";
import { MIN_FUNDING_CHIPS } from "../src/db/schema.js";
import type { RentalChain } from "../src/db/rentals.js";
import type { DepositChain } from "../src/db/deposits.js";
import type { WithdrawalChain } from "../src/db/withdrawals.js";
import type { LossBudgetChain } from "../src/db/loss-budget.js";
import { PROGRAM_ID, pdas, type LossBudgetState } from "../src/chain/settlement.js";
import { utcDay, uuidBytes } from "../src/chain/common.js";
import idl from "../src/chain/idl.json" with { type: "json" };
import { SystemProgram } from "@solana/web3.js";

const BUDGET_DISCRIMINATOR = Buffer.from(idl.instructions.find((i) => i.name === "set_loss_budget")!.discriminator);

// Renting over HTTP on both flows. What matters here is that a caller can tell
// them apart without guessing, and that the deposit flow never hands back an
// agent that looks ready to play before it has been paid for.

const RATE = DEVNET_CHIP_RATE;
const uuidFromBytesLocal = (b: Uint8Array) => {
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const FEE = baseUnits(200, RATE);
const FAKE_PROGRAM = new PublicKey(Buffer.alloc(32, 5));

class FakeChain implements RentalChain, DepositChain, WithdrawalChain, LossBudgetChain {
  readonly settler = Keypair.generate();
  get signer() {
    return this.settler;
  }
  budgets = new Map<string, LossBudgetState>();
  /** A real set_loss_budget instruction, accounts in the program's order, so the server's checks see what they would in production. */
  async prepareLossBudget(input: { agentId: string; owner: string; perDay: number }) {
    const perDay = Buffer.alloc(8);
    perDay.writeBigUInt64LE(BigInt(input.perDay));
    const transaction = new Transaction({
      feePayer: this.settler.publicKey,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: this.height + 150,
    }).add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: this.settler.publicKey, isSigner: true, isWritable: true },
          { pubkey: pdas.config(), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(input.owner), isSigner: true, isWritable: false },
          { pubkey: pdas.owner(input.agentId), isSigner: false, isWritable: false },
          { pubkey: pdas.budget(input.agentId), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([BUDGET_DISCRIMINATOR, Buffer.from(uuidBytes(input.agentId)), perDay]),
      }),
    );
    transaction.partialSign(this.settler);
    return { transaction, lastValidBlockHeight: this.height + 150 };
  }
  async lossBudgetOf(agentId: string) {
    return this.budgets.get(agentId) ?? null;
  }
  /** What the program does with a change: a raise at once, a cut from tomorrow. */
  private applyBudget(data: Buffer) {
    const agentId = uuidFromBytesLocal(data.subarray(8, 24));
    const asked = Number(data.readBigUInt64LE(24));
    const now = this.budgets.get(agentId);
    const today = utcDay(new Date());
    this.budgets.set(
      agentId,
      !now || asked >= now.perDay
        ? { perDay: asked, nextPerDay: asked, nextFromDay: 0, net: [] }
        : { ...now, nextPerDay: asked, nextFromDay: today + 1 },
    );
  }
  vaults = new Map<string, number>();
  height = 1000;
  async prepareRental(input: { rentalId: string; agentId: string; owner: string; deposit: number }) {
    const transaction = new Transaction({
      feePayer: this.settler.publicKey,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: this.height + 150,
    }).add(
      new TransactionInstruction({
        programId: FAKE_PROGRAM,
        keys: [{ pubkey: new PublicKey(input.owner), isSigner: true, isWritable: true }],
        data: Buffer.from(`${input.agentId}:${input.deposit}`),
      }),
    );
    transaction.partialSign(this.settler);
    return { transaction, lastValidBlockHeight: this.height + 150 };
  }
  /** Withdrawals go out through the same submit path as top-ups. */
  async prepareWithdrawal(input: { withdrawalId: string; agentId: string; owner: string; amount: number; remaining: number }) {
    const transaction = new Transaction({
      feePayer: this.settler.publicKey,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: this.height + 150,
    }).add(
      new TransactionInstruction({
        programId: FAKE_PROGRAM,
        keys: [{ pubkey: new PublicKey(input.owner), isSigner: true, isWritable: true }],
        data: Buffer.from(`out:${input.agentId}:${-input.amount}`),
      }),
    );
    transaction.partialSign(this.settler);
    return { transaction, lastValidBlockHeight: this.height + 150 };
  }
  async prepareDeposit(input: { agentId: string; owner: string; amount: number }) {
    const transaction = new Transaction({
      feePayer: this.settler.publicKey,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: this.height + 150,
    }).add(
      new TransactionInstruction({
        programId: FAKE_PROGRAM,
        keys: [{ pubkey: new PublicKey(input.owner), isSigner: true, isWritable: true }],
        data: Buffer.from(`top:${input.agentId}:${input.amount}`),
      }),
    );
    transaction.partialSign(this.settler);
    return { transaction, lastValidBlockHeight: this.height + 150 };
  }
  /** Top-ups and withdrawals both go out through this in the real client. */
  async submitWithdrawal(raw: Uint8Array) {
    const tx = Transaction.from(raw);
    const data = Buffer.from(tx.instructions[0]!.data);
    if (tx.instructions[0]!.programId.equals(PROGRAM_ID) && data.subarray(0, 8).equals(BUDGET_DISCRIMINATOR)) {
      this.applyBudget(data);
      return "sig-budget";
    }
    const [, agentId, amount] = tx.instructions[0]!.data.toString().split(":");
    this.vaults.set(agentId!, (this.vaults.get(agentId!) ?? 0) + Number(amount));
    return `sig-top-${agentId}`;
  }
  async submitRental(raw: Uint8Array) {
    const tx = Transaction.from(raw);
    const [agentId, deposit] = tx.instructions[0]!.data.toString().split(":");
    this.vaults.set(agentId!, Number(deposit));
    return `sig-${agentId}`;
  }
  async blockHeightPassed(h: number) {
    return this.height > h;
  }
  async vaultBalance(agentId: string) {
    return this.vaults.get(agentId) ?? null;
  }
}

let db: Db;
let closeDb: () => Promise<void>;
let url: string;
let closeServer: () => Promise<void>;
const chain = new FakeChain();

const seedOf = (label: string) => createHash("sha256").update(label).digest();
const keypairFor = (label: string) => Keypair.fromSeed(seedOf(label));
const walletOf = (label: string) => keypairFor(label).publicKey.toBase58();
const tokens = new Map<string, string>();
/**
 * Wallets on the deposit flow; everyone else keeps the seed flow. One per test,
 * because a wallet may only hold one agent at a time and every rental here
 * leaves one behind.
 */
const DEPOSITORS = ["dep-tells-apart", "dep-unplayable", "dep-funds", "dep-refuses", "dep-private", "dep-topup", "dep-guard", "dep-chips", "dep-withdraw", "dep-partial", "dep-floor", "dep-retire", "dep-unpaid", "dep-limit", "dep-budget", "dep-budget-forge"] as const;
const onDepositFlow = new Set(DEPOSITORS.map(walletOf));

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

const api = async (path: string, init: { method?: string; body?: unknown; as: string }, base = url) => {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${await tokenFor(init.as)}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

beforeAll(async () => {
  ({ db, close: closeDb } = await connect());
  await migrate(db);
  ({ url, close: closeServer } = await listen({
    db,
    deposit: { chain, fee: FEE, allow: (o) => onDepositFlow.has(o) },
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

describe("renting over HTTP", () => {
  it("says which flow it took, so a caller never has to guess from the shape", async () => {
    const who = DEPOSITORS[0];
    const seeded = await api("/agents", { method: "POST", body: { presetName: "Anchor" }, as: "sam" });
    expect(seeded.status).toBe(201);
    expect(seeded.body.funding).toBe("seed");
    expect(seeded.body.rental).toBeNull();
    // A seed agent can play the moment it is rented.
    expect(seeded.body.agent.canPlay).toBe(true);

    const deposited = await api("/agents", {
      method: "POST",
      body: { presetName: "Hammer", deposit: 5_600 },
      as: who,
    });
    expect(deposited.status).toBe(201);
    expect(deposited.body.funding).toBe("deposit");
    expect(deposited.body.rental).not.toBeNull();
  });

  it("hands back a transaction to sign, and an agent that cannot play yet", async () => {
    const who = DEPOSITORS[1];
    const out = await api("/agents", { method: "POST", body: { presetName: "Mirage", deposit: 5_100 }, as: "erin2" });
    // erin2 is not on the allowlist, so this is the seed flow. Use the depositor.
    expect(out.body.funding).toBe("seed");

    const rented = await api("/agents", { method: "POST", body: { presetName: "Bully", deposit: 5_100 }, as: who });
    const { rental, agent } = rented.body;
    expect(typeof rental.transaction).toBe("string");
    expect(rental.depositChips).toBe(5_100);
    expect(rental.deposit).toBe(baseUnits(5_100, RATE));
    expect(rental.feeChips).toBe(200);
    // The two things the screen has to say plainly.
    expect(rental.playable).toBe(false);
    expect(agent.canPlay).toBe(false);
    // And it has nothing in it until the transaction lands.
    expect(await balanceOf(db, agent.id)).toBe(0);
  });

  it("funds the agent once the owner's signature comes back", async () => {
    const who = DEPOSITORS[2];
    const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_600 }, as: who });
    const { rental, agent } = rented.body;

    const tx = Transaction.from(Buffer.from(rental.transaction, "base64"));
    tx.partialSign(keypairFor(who));
    const sent = await api(`/rentals/${rental.rentalId}/submit`, {
      method: "POST",
      body: { transaction: tx.serialize().toString("base64") },
      as: who,
    });
    expect(sent.status).toBe(201);
    expect(sent.body.rental.status).toBe("confirmed");
    expect(sent.body.rental.playable).toBe(true);
    expect(await balanceOf(db, agent.id)).toBe(baseUnits(3_600, RATE));

    // And it can be asked about afterwards.
    const looked = await api(`/rentals/${rental.rentalId}`, { as: who });
    expect(looked.body.rental).toMatchObject({ status: "confirmed", playable: true, agentId: agent.id });
  });

  it("refuses a deposit that is missing or not a number", async () => {
    const who = DEPOSITORS[3];
    for (const body of [{ presetName: "Anchor" }, { presetName: "Anchor", deposit: 0 }, { presetName: "Anchor", deposit: "lots" }]) {
      const out = await api("/agents", { method: "POST", body, as: who });
      expect(out.status).toBe(400);
      expect(String(out.body.error)).toMatch(/deposit is required/);
    }
  });

  it("refuses a deposit below the $20 minimum, and says what it needs", async () => {
    const who = DEPOSITORS[3];
    const out = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_599 }, as: who });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toMatch(/at least 3600 chips \(\$20\)/);
    const enough = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_600 }, as: who });
    expect(enough.status).toBe(201);
  });

  it("keeps a rental private to its owner", async () => {
    const who = DEPOSITORS[4];
    const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_600 }, as: who });
    const id = rented.body.rental.rentalId;
    expect((await api(`/rentals/${id}`, { as: "mallory" })).status).toBe(404);
    const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
    tx.partialSign(keypairFor(who));
    const stolen = await api(`/rentals/${id}/submit`, {
      method: "POST",
      body: { transaction: tx.serialize().toString("base64") },
      as: "mallory",
    });
    expect(stolen.status).toBe(403);
  });

  describe("topping up", () => {
    /** Rents on the deposit flow and lands it, so there is something to top up. */
    async function funded(who: string, chips: number) {
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: chips }, as: who });
      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      return rented.body.agent.id as string;
    }

    it("puts the owner's money in, and the balance says so", async () => {
      const who = "dep-topup";
      const agentId = await funded(who, 3_600);
      expect(await balanceOf(db, agentId)).toBe(baseUnits(3_600, RATE));

      const prepared = await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 500 }, as: who });
      expect(prepared.status).toBe(201);
      expect(prepared.body.deposit.chips).toBe(500);

      const tx = Transaction.from(Buffer.from(prepared.body.deposit.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      const sent = await api(`/deposits/${prepared.body.deposit.depositId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      expect(sent.body.deposit.status).toBe("confirmed");
      // This is the gap the seed flow could not close: an agent can be given more.
      expect(await balanceOf(db, agentId)).toBe(baseUnits(4_100, RATE));
    });

    it("refuses a top-up for an agent rented before deposits existed", async () => {
      // A seed agent's vault holds the frozen program's mint; there is nowhere
      // to put a deposit denominated in the other one.
      const seeded = await api("/agents", { method: "POST", body: { presetName: "Bully" }, as: "seed-owner" });
      const out = await api(`/agents/${seeded.body.agent.id}/deposits`, { method: "POST", body: { amount: 100 }, as: "seed-owner" });
      expect(out.status).toBe(409);
      expect(String(out.body.error)).toMatch(/rented before deposits/);
    });

    it("refuses a top-up before the rental is paid for, and says so on the owner's view", async () => {
      // Declined at the wallet, or not landed yet: the agent is on the owner's
      // page, but there is no vault for the money to go into.
      const who = "dep-unpaid";
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_600 }, as: who });
      const agentId = rented.body.agent.id as string;

      const out = await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 100 }, as: who });
      expect(out.status).toBe(409);
      expect(String(out.body.error)).toMatch(/hasn't been paid for yet/);
      expect((await api(`/agents/${agentId}`, { as: who })).body.agent.depositBlocked).toMatch(/hasn't been paid for yet/);

      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      expect((await api(`/agents/${agentId}`, { as: who })).body.agent.depositBlocked).toBeNull();
    });

    it("refuses anyone but the owner, and an amount of nothing", async () => {
      const who = "dep-guard";
      const agentId = await funded(who, 3_600);
      expect((await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 100 }, as: "mallory" })).status).toBe(403);
      expect((await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 0 }, as: who })).status).toBe(400);
      expect(await balanceOf(db, agentId)).toBe(baseUnits(3_600, RATE));
    });
  });



  describe("the owner's daily loss budget", () => {
    /** Rents on the deposit flow and lands it. */
    async function landed(who: string, chips: number) {
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: chips }, as: who });
      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      return rented.body.agent.id as string;
    }
    /** Asks for a change, signs it as `signer`, sends it as `who`. */
    async function change(agentId: string, who: string, chips: number, signer = keypairFor(who)) {
      const prepared = await api(`/agents/${agentId}/loss-budget`, { method: "POST", body: { chips }, as: who });
      if (prepared.status !== 201) return prepared;
      const tx = Transaction.from(Buffer.from(prepared.body.lossBudget.transaction, "base64"));
      tx.partialSign(signer);
      return api(`/agents/${agentId}/loss-budget/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64"), lastValidBlockHeight: prepared.body.lossBudget.lastValidBlockHeight },
        as: who,
      });
    }

    it("starts at a third of the deposit, raises at once, and cuts from tomorrow", async () => {
      const who = "dep-budget";
      const agentId = await landed(who, 3_600);
      // Read from the agent object, as the page does.
      const view = async () => (await api(`/agents/${agentId}`, { as: who })).body.agent.lossBudget;
      expect(await view()).toMatchObject({ perDayChips: 1_200, lostTodayChips: 0, nextPerDayChips: null });

      const raised = await change(agentId, who, 1_500);
      expect(raised.body.lossBudget).toMatchObject({ status: "confirmed", perDayChips: 1_500 });
      expect(await view()).toMatchObject({ perDayChips: 1_500, nextPerDayChips: null });

      // A cut: today keeps 1,500, tomorrow is 100, and the owner sees both.
      const cut = await change(agentId, who, 100);
      expect(cut.body.lossBudget.status).toBe("confirmed");
      expect(await view()).toMatchObject({ perDayChips: 1_500, nextPerDayChips: 100, nextFromDay: utcDay(new Date()) + 1 });
    });

    it("sends only a change this server built, signed by the agent's owner", async () => {
      const who = "dep-budget-forge";
      const agentId = await landed(who, 3_600);

      // Someone else's agent: refused before anything is built.
      expect((await change(agentId, "mallory", 10)).status).toBe(403);

      // The owner's own transaction carrying the same instruction, without the
      // settler's signature: not one this server built, so not one it sends.
      const prepared = await api(`/agents/${agentId}/loss-budget`, { method: "POST", body: { chips: 5 }, as: who });
      const ours = Transaction.from(Buffer.from(prepared.body.lossBudget.transaction, "base64"));
      const theirs = new Transaction({ feePayer: keypairFor(who).publicKey, blockhash: ours.recentBlockhash!, lastValidBlockHeight: 1 })
        .add(ours.instructions[0]!);
      theirs.sign(keypairFor(who));
      const forged = await api(`/agents/${agentId}/loss-budget/submit`, {
        method: "POST",
        body: { transaction: theirs.serialize({ requireAllSignatures: false }).toString("base64") },
        as: who,
      });
      expect(forged.status).toBe(400);
      expect(String(forged.body.error)).toMatch(/built here/);
      expect(chain.budgets.get(agentId)).toBeUndefined();
    });

    it("has nothing to change on an agent rented before deposits", async () => {
      const seeded = await api("/agents", { method: "POST", body: { presetName: "Bully" }, as: "seed-budget" });
      const out = await api(`/agents/${seeded.body.agent.id}/loss-budget`, { method: "POST", body: { chips: 10 }, as: "seed-budget" });
      expect(out.status).toBe(409);
      expect(String(out.body.error)).toMatch(/no loss budget/);
    });
  });

  describe("the deposit limit", () => {
    // Its own server, with room for one rental and one top-up an hour.
    let tight: string;
    let closeTight: () => Promise<void>;
    beforeAll(async () => {
      ({ url: tight, close: closeTight } = await listen({
        db,
        deposit: { chain, fee: FEE, allow: (o) => onDepositFlow.has(o) },
        rentRateLimit: { limit: 2, windowMs: 3_600_000 },
        rentAddressRateLimit: { limit: 1000, windowMs: 60_000 },
        nonceRateLimit: { limit: 1000, windowMs: 60_000 },
      }));
    });
    afterAll(async () => closeTight());

    it("is not spent by a top-up refused before anything was attempted on chain", async () => {
      const who = "dep-limit";
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 3_600 }, as: who }, tight);
      const agentId = rented.body.agent.id as string;
      // Pressing a button that cannot work, over and over, costs nothing.
      for (let i = 0; i < 5; i++) {
        const out = await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 100 }, as: who }, tight);
        expect(out.status).toBe(409);
      }

      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      }, tight);
      // The allowance the refusals did not touch is still there for the real one.
      expect((await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 100 }, as: who }, tight)).status).toBe(201);
      expect((await api(`/agents/${agentId}/deposits`, { method: "POST", body: { amount: 100 }, as: who }, tight)).status).toBe(429);
    });
  });

  describe("what a client is told about money", () => {
    // The ledger holds base units because it has to reconcile with a vault.
    // Everything a player reads is chips. A view that forgets to convert is not
    // slightly wrong: 3,600 chips is 3,600,000,000 base units.
    it("reports a deposit-funded balance in chips, not base units", async () => {
      const who = "dep-chips";
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: 5_600 }, as: who });
      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      const agentId = rented.body.agent.id as string;
      // The ledger, in base units.
      expect(await balanceOf(db, agentId)).toBe(baseUnits(5_600, RATE));

      // The view, in chips - and able to cover every band, which a view that
      // read base units as chips would also say, so the figure is the test.
      const view = await api(`/agents/${agentId}`, { as: who });
      expect(view.body.agent.balance).toBe(5_600);
      expect(view.body.agent.balanceBaseUnits).toBe(baseUnits(5_600, RATE));
      expect(view.body.agent.canPlay).toBe(true);
      expect(view.body.agent.minToPlay).toBe(MIN_FUNDING_CHIPS);

      // And the movements, which are ledger rows and so the easiest to miss.
      const ledger = await api(`/agents/${agentId}/ledger`, { as: who });
      expect(ledger.body.balance).toBe(5_600);
      expect(ledger.body.movements.map((m: { amount: number }) => m.amount)).toEqual([5_600]);
    });

    it("leaves a seed-funded balance alone, because a chip is a base unit there", async () => {
      const seeded = await api("/agents", { method: "POST", body: { presetName: "Mirage" }, as: "seed-chips" });
      const id = seeded.body.agent.id as string;
      const view = await api(`/agents/${id}`, { as: "seed-chips" });
      // The frozen programme's mint has no decimals: one token was one chip.
      expect(view.body.agent.balance).toBe(await balanceOf(db, id));
      expect(view.body.agent.balance).toBe(4_500);
    });
  });


  describe("withdrawing from a deposit-funded agent", () => {
    async function funded(who: string, chipsIn: number) {
      const rented = await api("/agents", { method: "POST", body: { presetName: "Anchor", deposit: chipsIn }, as: who });
      const tx = Transaction.from(Buffer.from(rented.body.rental.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/rentals/${rented.body.rental.rentalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      return rented.body.agent.id as string;
    }

    it("quotes what can be taken in chips, not base units", async () => {
      const who = "dep-withdraw";
      const agentId = await funded(who, 5_600);
      const state = await api(`/agents/${agentId}/withdrawable`, { as: who });
      expect(state.body.withdrawable.balance).toBe(5_600);
      expect(state.body.withdrawable.withdrawable).toBe(5_600);
      expect(state.body.withdrawable.locked).toBe(0);
      // The floor is the cheapest band's worst match, in chips.
      expect(state.body.withdrawable.minStake).toBe(3_600);
      expect(state.body.withdrawable.maxPartial).toBe(2_000);
      expect(state.body.withdrawable.reason).toBeNull();
    });

    it("takes a part of it, and leaves the rest playable", async () => {
      const who = "dep-partial";
      const agentId = await funded(who, 5_600);
      const prepared = await api(`/agents/${agentId}/withdrawals`, { method: "POST", body: { amount: 500 }, as: who });
      expect(prepared.status).toBe(201);
      // Quoted back in chips, both sides.
      expect(prepared.body.withdrawal.amount).toBe(500);
      expect(prepared.body.withdrawal.remaining).toBe(5_100);
      expect(prepared.body.withdrawal.retire).toBe(false);

      const tx = Transaction.from(Buffer.from(prepared.body.withdrawal.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      const sent = await api(`/withdrawals/${prepared.body.withdrawal.withdrawalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      expect(sent.body.withdrawal.status).toBe("confirmed");
      // The ledger moved by the right number of base units, not of chips.
      expect(await balanceOf(db, agentId)).toBe(baseUnits(5_100, RATE));
      const after = await api(`/agents/${agentId}`, { as: who });
      expect(after.body.agent.balance).toBe(5_100);
      expect(after.body.agent.canPlay).toBe(true);
    });

    it("refuses to leave less than the minimum to play, saying the figure in chips", async () => {
      const who = "dep-floor";
      const agentId = await funded(who, 3_600);
      const out = await api(`/agents/${agentId}/withdrawals`, { method: "POST", body: { amount: 3_590 }, as: who });
      expect(out.status).toBe(400);
      // 10 left, not 10000000 left.
      expect(String(out.body.error)).toMatch(/would leave 10,? too little/);
      expect(String(out.body.error)).toMatch(/at least 3600/);
    });

    it("takes the lot and retires the agent, which is how a wallet frees its slot", async () => {
      const who = "dep-retire";
      const agentId = await funded(who, 3_600);
      const prepared = await api(`/agents/${agentId}/withdrawals`, { method: "POST", body: { amount: "all" }, as: who });
      expect(prepared.body.withdrawal.amount).toBe(3_600);
      expect(prepared.body.withdrawal.retire).toBe(true);

      const tx = Transaction.from(Buffer.from(prepared.body.withdrawal.transaction, "base64"));
      tx.partialSign(keypairFor(who));
      await api(`/withdrawals/${prepared.body.withdrawal.withdrawalId}/submit`, {
        method: "POST",
        body: { transaction: tx.serialize().toString("base64") },
        as: who,
      });
      expect(await balanceOf(db, agentId)).toBe(0);
      // And the wallet can rent again, which is the point of retiring.
      const again = await api("/agents", { method: "POST", body: { presetName: "Bully", deposit: 3_600 }, as: who });
      expect(again.status).toBe(201);
    });
  });

});
