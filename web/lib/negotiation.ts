/**
 * Negotiation matches as the API serves them (src/db/negotiation.ts, docs/negotiation.md), and the
 * words for them. Kept apart from Bluff & Fold's types: a different game with a different transcript.
 */
export type NegotiationSeat = "A" | "B";
export type NegotiationMove = "claim70" | "claim60" | "claim50" | "accept" | "walk";
export type NegotiationRound = { round: number; pot: number; proposer: NegotiationSeat; claim: 70 | 60 | 50; situation: string; response: NegotiationMove };
export type NegotiationOutcome =
  | { kind: "deal"; round: number; split: Record<NegotiationSeat, number> }
  | { kind: "walk"; round: number; by: NegotiationSeat }
  | { kind: "timeout" };
export type NegotiationLog = {
  seed: number; bottomLines: Record<NegotiationSeat, number>; firstProposer: NegotiationSeat;
  rounds: NegotiationRound[]; outcome: NegotiationOutcome; payoff: Record<NegotiationSeat, number>; net: Record<NegotiationSeat, number>;
};
type Side = { id: string; name: string; preset: string; net: number };
export type NegotiationMatch = { id: string; playedAt: string; scored: boolean; a: Side; b: Side; log: NegotiationLog };

export const sideOf = (m: NegotiationMatch, seat: NegotiationSeat) => (seat === "A" ? m.a : m.b);
export const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;

/** One line for a list: how it ended. */
export function negotiationSummary(m: NegotiationMatch): string {
  const o = m.log.outcome;
  if (o.kind === "deal") {
    const last = m.log.rounds.at(-1)!;
    return `Deal in round ${o.round}: ${sideOf(m, last.proposer).name} got ${o.split[last.proposer]}, ${sideOf(m, last.proposer === "A" ? "B" : "A").name} ${o.split[last.proposer === "A" ? "B" : "A"]}`;
  }
  if (o.kind === "walk") return `${sideOf(m, o.by).name} walked away in round ${o.round}`;
  return "No deal after six rounds";
}

/** One round in words: the claim, and the answer to it. */
export function roundLine(m: NegotiationMatch, r: NegotiationRound): { claim: string; answer: string } {
  const proposer = sideOf(m, r.proposer).name, responder = sideOf(m, r.proposer === "A" ? "B" : "A").name;
  const amount = Math.round((r.pot * r.claim) / 100);
  const answer = r.response === "accept" ? `${responder} accepts.`
    : r.response === "walk" ? `${responder} walks away.`
    : `${responder} counters with ${r.response.slice(5)}%.`;
  return { claim: `${proposer} claims ${r.claim}% (${amount} of ${r.pot}).`, answer };
}

/** The short line a speech bubble or a row shows for a move. */
export const MOVE_LINES: Record<NegotiationMove, string> = {
  claim70: "Seventy, not a chip less.",
  claim60: "Sixty. That's fair.",
  claim50: "Even split.",
  accept: "Done.",
  walk: "I'll find another buyer.",
};
