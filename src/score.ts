/**
 * The holder score (docs/holder-agents.md, Scoring), as arithmetic only.
 *
 *   score  = points × weight
 *   points = max(0, Σ over opponents of min(cap, net chips won against that opponent))
 *   weight = 1 + 3 × power
 *   power  = 0.85 × conviction + 0.15 × position
 *
 * Power weights the reward and never a match: nothing here is read by the
 * engine, the matchmaker or the runner. It is computed from matches already
 * played and holdings already read.
 */

/** Against any one opponent, at most this many net chips a day count: one match's widest net. */
export const OPPONENT_CAP = 40;
/** Conviction stops growing here. */
export const CONVICTION_CAP_DAYS = 180;
/** The share of supply at which position reaches 1: 1%, as a fraction. */
export const POSITION_REFERENCE = 0.01;
export const POWER_WEIGHTS = { conviction: 0.85, position: 0.15 } as const;
/** The weight at full power. At no power it is 1. */
export const MAX_WEIGHT = 4;
/** No agent takes more than this fraction of one payout. */
export const SHARE_CAP = 0.1;

/**
 * The qualifying minimums and the per-opponent cap: parameters, not constants
 * (no-loss-rewards.md, decision 15, carried over). Every frozen day records
 * the values it was scored with, so a day's bar can be read afterwards
 * whatever they are set to later.
 */
export type ScoreParams = { opponentCap: number; minDailyMatches: number; minSeasonMatches: number };

/**
 * The values in force: the launch values, 3 ranked matches a day and 15 a
 * season. Ten a day assumes opponents are there to play; on a thin roster
 * autoplay waits, nobody would qualify and the daily pool would pay nobody.
 * They rise as the roster grows (decided figures: 10 and 50), and each change
 * is recorded in docs/holder-agents.md's parameter log as well as on every
 * day frozen under it.
 */
export const SCORE_PARAMS: ScoreParams = { opponentCap: OPPONENT_CAP, minDailyMatches: 3, minSeasonMatches: 15 };

/**
 * A day's points from the net chips won against each opponent. A win counts up
 * to the cap against any one opponent; a loss counts in full; the total is
 * floored at zero, so a bad day costs nothing from a good one.
 */
export function points(netByOpponent: Iterable<number>, cap: number = OPPONENT_CAP): number {
  let total = 0;
  for (const net of netByOpponent) total += Math.min(cap, net);
  return Math.max(0, total);
}

/** Conviction, 0 to 1: days held as a fraction of the cap. */
export function conviction(days: number): number {
  return Math.min(CONVICTION_CAP_DAYS, Math.max(0, days)) / CONVICTION_CAP_DAYS;
}

/**
 * Position, 0 to 1, from the fraction of supply held. The square root makes
 * four times the holding twice the position; 1% of supply reaches the cap.
 */
export function position(shareOfSupply: number): number {
  if (!(shareOfSupply > 0)) return 0;
  return Math.min(1, Math.sqrt(shareOfSupply / POSITION_REFERENCE));
}

export type PowerInputs = { convictionDays: number; shareOfSupply: number };

/** Power, 0 to 1. */
export function power(inputs: PowerInputs): number {
  return POWER_WEIGHTS.conviction * conviction(inputs.convictionDays) + POWER_WEIGHTS.position * position(inputs.shareOfSupply);
}

/** The weight a power earns: ×1 at none, ×4 at full, linear between. */
export function weight(p: number): number {
  return 1 + (MAX_WEIGHT - 1) * Math.min(1, Math.max(0, p));
}

/**
 * Each agent's fraction of a payout: proportional to score, none above the
 * cap. What the cap holds back is not handed to anyone else - it stays in the
 * wallet for the next payout - so the fractions can sum to less than one.
 */
export function shares<T extends { score: number }>(rows: readonly T[], cap: number = SHARE_CAP): number[] {
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.score), 0);
  return rows.map((r) => (total > 0 ? Math.min(cap, Math.max(0, r.score) / total) : 0));
}
