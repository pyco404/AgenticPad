import { Keypair } from "@solana/web3.js";
import { mulberry32, nextUint32, PRESET_NAMES, PRESETS, type Agent, type Action } from "../src/index.js";
import { EDGE_KEYS, SITUATIONS, type Policy, type Situation } from "../src/agents/policy.js";
import type { Db } from "../src/db/client.js";
import { createAgent, type CreateAgentInput } from "../src/db/runner.js";
import { holdingMinimum, readHolding } from "../src/db/holdings.js";

/** Agent that picks uniformly at random from its own seeded stream (independent of the match RNG). */
export function randomAgent(seed: number): Agent {
  const rng = mulberry32(seed);
  const actions: Action[] = ["fold", "call", "raise"];
  return () => actions[Math.floor(rng() * 3)]!;
}

export function constantAgent(action: Action): Agent {
  return () => action;
}

/** A pool mixing presets, constant agents and random agents. */
export function agentPool(seed: number): Agent[] {
  const rng = mulberry32(seed);
  return [
    ...PRESET_NAMES.map((n) => PRESETS[n]),
    constantAgent("fold"),
    constantAgent("call"),
    constantAgent("raise"),
    randomAgent(nextUint32(rng)),
    randomAgent(nextUint32(rng)),
  ];
}

/** A wallet key to own a test agent with. Agent ids are derived from it (src/agent-id.ts). */
export function someWallet(): string {
  return Keypair.generate().publicKey.toBase58();
}

/** A table from one row pattern per situation, written weakest edge first: "r c c c r". */
export function table(rows: Partial<Record<Situation, string>>, fallback = "c c c c c"): Policy {
  const letter = { f: "fold", c: "call", r: "raise" } as const;
  return Object.fromEntries(
    SITUATIONS.map((s) => {
      const acts = (rows[s] ?? fallback).split(" ").map((l) => letter[l as "f" | "c" | "r"]) as Action[];
      return [s, Object.fromEntries(EDGE_KEYS.map((k, i) => [k, acts[i]!]))];
    }),
  ) as Policy;
}

/**
 * A player's agent, in play: created on the holder flow, with its owner's
 * wallet read holding `holds` base units - the minimum unless told otherwise
 * (docs/holder-agents.md). Holding is the agent, so a player's agent with no
 * reading is out of play, and most tests want one that can play.
 */
export async function createPlayer(db: Db, input: Omit<CreateAgentInput, "ownerId"> & { ownerId?: string | null; holds?: number }) {
  const { holds, ...rest } = input;
  const ownerId = rest.ownerId ?? someWallet();
  const agent = await createAgent(db, { ...rest, ownerId });
  await holdFor(db, ownerId, holds ?? holdingMinimum());
  return agent;
}

/** Records a reading of a wallet holding `amount` base units, as the scheduled read would. */
export async function holdFor(db: Db, wallet: string, amount: number, at = new Date()) {
  return readHolding(db, { balanceOf: async () => amount, supply: async () => 1_000_000_000 * 10 ** 6 }, wallet, at);
}

/**
 * A holdings reader for a test server: every wallet holds the minimum unless
 * `held` says otherwise. Holding is the only way to an agent, so a server that
 * hands agents out needs one (src/http/server.ts, `holder`).
 */
export function everyoneHolds(held = new Map<string, number>()) {
  return {
    held,
    chain: {
      balanceOf: async (wallet: string) => held.get(wallet) ?? holdingMinimum(),
      supply: async () => 1_000_000_000 * 10 ** 6,
    },
    allow: () => true,
  };
}
