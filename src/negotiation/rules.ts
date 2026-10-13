import type { Seat } from "../types.js";

/**
 * Negotiation's rules (docs/negotiation.md): two agents split a pot that shrinks each round without a
 * deal, each with a private bottom line it keeps if there is none. Data and pure functions only.
 */

/** The pot in round 1, and what it loses each round without a deal. */
export const POT = 100;
export const POT_SHRINK = 10;
export const ROUNDS = 6;
/** From round LATE_ROUND on, a table answers in its "late" situations. */
export const LATE_ROUND = 4;
/** The bottom lines an agent can draw, equally likely: what it keeps if there is no deal. */
export const BOTTOM_LINES = [10, 20, 30, 40, 50] as const;
export type BottomLine = (typeof BOTTOM_LINES)[number];
/** The shares of the current pot a proposal can claim, in percent. */
export const CLAIMS = [70, 60, 50] as const;
export type Claim = (typeof CLAIMS)[number];

export const MOVES = ["claim70", "claim60", "claim50", "accept", "walk"] as const;
export type Move = (typeof MOVES)[number];

export const SITUATIONS = ["open", "counterHigh", "counterFair", "counterEven", "lateHigh", "lateEven"] as const;
export type Situation = (typeof SITUATIONS)[number];

export const SITUATION_NOTES: Record<Situation, string> = {
  open: "you propose first, in round 1",
  counterHigh: "the other side just claimed 70% of the pot",
  counterFair: "the other side just claimed 60% of the pot",
  counterEven: "the other side just claimed 50% of the pot",
  lateHigh: "round 4 or later, and the other side claimed 60% or more",
  lateEven: "round 4 or later, and the other side claimed 50%",
};

/** Bottom lines as table keys: "10" .. "50". */
export const BOTTOM_KEYS = BOTTOM_LINES.map(String) as readonly string[];

/** A filled table: one move for each situation and bottom line. 6 × 5 = 30 cells, as Bluff & Fold's. */
export type NegotiationPolicy = Record<Situation, Record<string, Move>>;

export const potIn = (round: number) => POT - POT_SHRINK * (round - 1);
export const claimOf = (move: Move): Claim | null => move === "claim70" ? 70 : move === "claim60" ? 60 : move === "claim50" ? 50 : null;

/** The situation a responder is in, from the round and the claim it faces. */
export function situationOf(round: number, facing: Claim | null): Situation {
  if (facing === null) return "open";
  if (round >= LATE_ROUND) return facing >= 60 ? "lateHigh" : "lateEven";
  return facing === 70 ? "counterHigh" : facing === 60 ? "counterFair" : "counterEven";
}

export class InvalidNegotiationPolicyError extends Error {}

/**
 * Checks every cell holds a move and returns a frozen copy. Opening, there is nothing to accept or
 * walk from, so those read as the most modest claim rather than being refused.
 */
export function validateNegotiationPolicy(policy: unknown): NegotiationPolicy {
  if (typeof policy !== "object" || policy === null) throw new InvalidNegotiationPolicyError("policy is not an object");
  const out = {} as NegotiationPolicy;
  for (const situation of SITUATIONS) {
    const row = (policy as Record<string, unknown>)[situation];
    if (typeof row !== "object" || row === null) throw new InvalidNegotiationPolicyError(`missing situation ${situation}`);
    const cells: Record<string, Move> = {};
    for (const key of BOTTOM_KEYS) {
      const move = (row as Record<string, unknown>)[key];
      if (!(MOVES as readonly unknown[]).includes(move)) throw new InvalidNegotiationPolicyError(`${situation}.${key} is not a move: ${String(move)}`);
      cells[key] = situation === "open" && (move === "accept" || move === "walk") ? "claim50" : move as Move;
    }
    out[situation] = Object.freeze(cells);
  }
  return Object.freeze(out);
}

/** A table from a rule: the move for each situation and bottom line. */
export function tableFrom(rule: (situation: Situation, bottom: BottomLine) => Move): NegotiationPolicy {
  const rows = {} as NegotiationPolicy;
  for (const situation of SITUATIONS) {
    rows[situation] = Object.fromEntries(BOTTOM_LINES.map((b) => [String(b), rule(situation, b)]));
  }
  return validateNegotiationPolicy(rows);
}

/** One line per situation, e.g. "open: 70 70 60 60 50". */
export function describeNegotiationPolicy(policy: NegotiationPolicy): string {
  const short: Record<Move, string> = { claim70: "70", claim60: "60", claim50: "50", accept: "ok", walk: "go" };
  return SITUATIONS.map((s) => `${s}: ${BOTTOM_KEYS.map((k) => short[policy[s][k]!]).join(" ")}`).join("\n");
}

export const other = (seat: Seat): Seat => (seat === "A" ? "B" : "A");
