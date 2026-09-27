import { PublicKey, Transaction } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, chainOps } from "./schema.js";
import { lossBudgetOn } from "./runner.js";
import { utcDay, uuidBytes, type PreparedWithdrawal } from "../chain/common.js";
import { PROGRAM_ID, pdas, type LossBudgetState } from "../chain/settlement.js";
import idl from "../chain/idl.json" with { type: "json" };

/**
 * Changing an agent's daily loss budget: the owner signs, the settler pays.
 *
 * The program is the authority here, as it is for exits: the ledger's copy is
 * read back from the chain once a change lands. Only a cut is written ahead of
 * it, and only to the stricter value - the ledger may stop pairing an agent
 * before the chain would, never after, because a match the ledger records past
 * the chain's limit is a settlement the chain will refuse for good.
 */

export type LossBudgetChain = {
  /** The settler: a change it did not sign was not built here. */
  readonly signer: { publicKey: PublicKey };
  prepareLossBudget(input: { agentId: string; owner: string; perDay: number }): Promise<PreparedWithdrawal>;
  submitWithdrawal(raw: Uint8Array, lastValidBlockHeight: number): Promise<string>;
  lossBudgetOf(agentId: string): Promise<LossBudgetState | null>;
};

export class LossBudgetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DISCRIMINATOR = Buffer.from(idl.instructions.find((i) => i.name === "set_loss_budget")!.discriminator);

/** The agent, if it is this owner's and its vault is open on chain - which is where a budget lives. */
async function budgetable(db: Db, agentId: string, ownerId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new LossBudgetError(404, "no such agent");
  if (agent.ownerId !== ownerId) throw new LossBudgetError(403, "that agent belongs to someone else");
  if (agent.funding !== "deposit") {
    throw new LossBudgetError(409, "this agent was rented before deposits: its program has no loss budget");
  }
  if (agent.retiredAt !== null) throw new LossBudgetError(409, "this agent is retired");
  const [vault] = await db
    .select({ id: chainOps.id })
    .from(chainOps)
    .where(and(eq(chainOps.agentId, agentId), eq(chainOps.kind, "open_vault"), eq(chainOps.status, "confirmed")))
    .limit(1);
  if (!vault) throw new LossBudgetError(409, "this agent's rental hasn't landed yet, so it has no budget to change");
  return agent;
}

/** Builds a budget change for the owner to sign. `perDay` in base units. */
export async function prepareLossBudget(
  db: Db,
  chain: LossBudgetChain,
  input: { agentId: string; ownerId: string; perDay: number },
) {
  if (!Number.isSafeInteger(input.perDay) || input.perDay < 0) {
    throw new LossBudgetError(400, "the budget must be a whole number of base units, zero or more");
  }
  await budgetable(db, input.agentId, input.ownerId);
  const prepared = await chain.prepareLossBudget({ agentId: input.agentId, owner: input.ownerId, perDay: input.perDay });
  return {
    transaction: prepared.transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  };
}

/**
 * The one instruction a budget change may carry, checked against what the
 * program will do with it: this agent's budget, this owner's signature.
 * Returns the base units asked for.
 */
function readChange(tx: Transaction, agentId: string, owner: string, settler: PublicKey): number {
  if (!tx.feePayer?.equals(settler)) throw new LossBudgetError(400, "that transaction wasn't built here");
  // Every signature valid over this exact message, the settler's included:
  // the settler only ever signs what this server built, so this is ours,
  // unaltered, with the owner's signature added and nothing else changed.
  if (!tx.verifySignatures()) throw new LossBudgetError(400, "the transaction isn't fully signed");
  if (tx.instructions.length !== 1) throw new LossBudgetError(400, "a budget change is one instruction");
  const [ix] = tx.instructions;
  const data = Buffer.from(ix!.data);
  if (!ix!.programId.equals(PROGRAM_ID) || !data.subarray(0, 8).equals(DISCRIMINATOR) || data.length !== 32) {
    throw new LossBudgetError(400, "that isn't a budget change");
  }
  if (!data.subarray(8, 24).equals(Buffer.from(uuidBytes(agentId)))) {
    throw new LossBudgetError(400, "that change is for another agent");
  }
  const [, , ownerKey, , budgetKey] = ix!.keys;
  if (ownerKey?.pubkey.toBase58() !== owner || !budgetKey?.pubkey.equals(pdas.budget(agentId))) {
    throw new LossBudgetError(400, "that change isn't signed by this agent's owner");
  }
  return Number(data.readBigUInt64LE(24));
}

/** Writes the chain's budget into the ledger's copy, exactly. */
async function mirror(db: Db, agentId: string, state: LossBudgetState) {
  await db
    .update(agents)
    .set({
      lossBudget: state.perDay,
      lossBudgetNext: state.nextPerDay,
      lossBudgetNextFromDay: state.nextFromDay === 0 ? null : state.nextFromDay,
    })
    .where(eq(agents.id, agentId));
}

/**
 * Sends the owner-signed change, then reads the budget back from the chain.
 *
 * A cut is written to the ledger *before* it is sent, at the day the program
 * will give it: the ledger then stops pairing the agent no later than the
 * chain would. A raise is written only once the chain has it.
 */
export async function submitLossBudget(
  db: Db,
  chain: LossBudgetChain,
  input: { agentId: string; ownerId: string; signedTx: string; lastValidBlockHeight: number },
  now = new Date(),
): Promise<{ status: "confirmed" | "submitted"; budget: LossBudgetState | null }> {
  const agent = await budgetable(db, input.agentId, input.ownerId);
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedTx, "base64"));
  } catch {
    throw new LossBudgetError(400, "not a transaction");
  }
  const asked = readChange(tx, input.agentId, input.ownerId, chain.signer.publicKey);

  const today = utcDay(now);
  const inForce = lossBudgetOn(agent, today);
  if (inForce !== null && asked < inForce) {
    await db
      .update(agents)
      .set({ lossBudgetNext: asked, lossBudgetNextFromDay: today + 1 })
      .where(eq(agents.id, input.agentId));
  }

  try {
    await chain.submitWithdrawal(Buffer.from(input.signedTx, "base64"), input.lastValidBlockHeight);
  } catch {
    // It may have landed with its confirmation lost. What the chain holds is
    // the answer either way, so ask it rather than guessing.
  }
  const state = await chain.lossBudgetOf(input.agentId);
  if (state && state.nextPerDay === asked) {
    await mirror(db, input.agentId, state);
    return { status: "confirmed", budget: state };
  }
  return { status: "submitted", budget: state };
}
