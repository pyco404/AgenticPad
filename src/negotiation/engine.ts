import { mulberry32 } from "../rng.js";
import type { Seat } from "../types.js";
import {
  BOTTOM_LINES,
  claimOf,
  other,
  potIn,
  ROUNDS,
  situationOf,
  validateNegotiationPolicy,
  type BottomLine,
  type Claim,
  type Move,
  type NegotiationPolicy,
  type Situation,
} from "./rules.js";

/**
 * Plays one Negotiation match (docs/negotiation.md). Deterministic: the same two tables and the same
 * seed give the same log, move for move. The seed decides only the two bottom lines and who proposes
 * first; everything after is the tables.
 */

/** One round: a claim on the current pot, and the other side's answer to it. */
export type NegotiationRound = {
  round: number;
  pot: number;
  proposer: Seat;
  claim: Claim;
  /** The responder's situation and move. A counter becomes the next round's claim. */
  situation: Situation;
  response: Move;
};

export type NegotiationOutcome =
  | { kind: "deal"; round: number; split: Record<Seat, number> }
  | { kind: "walk"; round: number; by: Seat }
  /** Six rounds and no deal. */
  | { kind: "timeout" };

export type NegotiationLog = {
  seed: number;
  /** Private during play; revealed in the log once the match is over. */
  bottomLines: Record<Seat, BottomLine>;
  firstProposer: Seat;
  /** The opening claim, then each round's claim and answer. */
  rounds: NegotiationRound[];
  outcome: NegotiationOutcome;
  /** What each side ends with: its share of the pot, or its bottom line without a deal. */
  payoff: Record<Seat, number>;
  /**
   * The result: my payoff against an even split of the first pot (FAIR_SHARE). A quick fair deal nets
   * 0 each; delay shrinks the pot and costs both; no deal leaves each its bottom line, 20 below even on
   * average; squeezing a soft opponent to 70/30 nets +20 and -20. The two nets never add up to more
   * than 0, so two agents working together cannot create points, only pass up to 20 between them.
   */
  net: Record<Seat, number>;
};

/** Half the first pot: what an even split is worth, the line each payoff is scored against. */
export const FAIR_SHARE = 50;

/** The two draws a match depends on, in a fixed order: A's bottom line, B's, then who proposes first. */
export function drawNegotiation(seed: number): { bottomLines: Record<Seat, BottomLine>; firstProposer: Seat } {
  const rng = mulberry32(seed);
  const draw = () => BOTTOM_LINES[Math.floor(rng() * BOTTOM_LINES.length)]!;
  const A = draw(), B = draw();
  return { bottomLines: { A, B }, firstProposer: rng() < 0.5 ? "A" : "B" };
}

/** A match from given draws: what drawNegotiation's seed would pick, or every case in turn (exactNegotiation). */
export function negotiate(tables: Record<Seat, NegotiationPolicy>, bottomLines: Record<Seat, BottomLine>, firstProposer: Seat, seed = 0): NegotiationLog {
  const table = { A: validateNegotiationPolicy(tables.A), B: validateNegotiationPolicy(tables.B) };
  const move = (seat: Seat, situation: Situation) => table[seat][situation][String(bottomLines[seat])]!;
  const rounds: NegotiationRound[] = [];
  let proposer = firstProposer;
  let claim = claimOf(move(proposer, "open"))!;
  let outcome: NegotiationOutcome = { kind: "timeout" };
  for (let round = 1; round <= ROUNDS; round++) {
    const pot = potIn(round);
    const responder = other(proposer);
    const situation = situationOf(round, claim);
    const response = move(responder, situation);
    rounds.push({ round, pot, proposer, claim, situation, response });
    if (response === "accept") {
      const taken = Math.round((pot * claim) / 100);
      outcome = { kind: "deal", round, split: { [proposer]: taken, [responder]: pot - taken } as Record<Seat, number> };
      break;
    }
    if (response === "walk") { outcome = { kind: "walk", round, by: responder }; break; }
    // A counter: the responder proposes its claim next round, on the smaller pot.
    proposer = responder;
    claim = claimOf(response)!;
  }
  const payoff = outcome.kind === "deal" ? outcome.split : { A: bottomLines.A, B: bottomLines.B };
  return { seed, bottomLines, firstProposer, rounds, outcome, payoff, net: { A: payoff.A - FAIR_SHARE, B: payoff.B - FAIR_SHARE } };
}

/** One seeded match: the seed draws the bottom lines and the first proposer. */
export function playNegotiation(a: NegotiationPolicy, b: NegotiationPolicy, options: { seed: number }): NegotiationLog {
  const { bottomLines, firstProposer } = drawNegotiation(options.seed);
  return negotiate({ A: a, B: b }, bottomLines, firstProposer, options.seed);
}

/**
 * A's expected net against B, exactly: the average over every equally likely draw - 5 bottom lines
 * each and 2 first proposers, 50 cases. No sampling, so presets can be balanced to the chip.
 */
export function exactNegotiation(a: NegotiationPolicy, b: NegotiationPolicy): number {
  let total = 0, cases = 0;
  for (const bottomA of BOTTOM_LINES) for (const bottomB of BOTTOM_LINES) for (const first of ["A", "B"] as const) {
    total += negotiate({ A: a, B: b }, { A: bottomA, B: bottomB }, first).net.A;
    cases++;
  }
  return total / cases;
}
