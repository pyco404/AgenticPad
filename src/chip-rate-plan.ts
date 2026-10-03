import { STAKE_DECIMALS } from "./chips.js";

/**
 * The arithmetic of a season's chip rate, apart from anything that writes it,
 * so the numbers can be checked first (scripts/set-season-rate.ts). The rate
 * pegs the holder minimum to dollars (docs/holder-agents.md); docs/economy.md,
 * The chip rate, has the reasoning.
 */

/** The peg: 900 chips, the reference starting balance, is $5. */
export const USD_PER_CHIP = 5 / 900;

/** The ceiling: 1,000 whole tokens a chip. Past it the peg is let go, so a bad price reading cannot push the minimum without limit. */
export const MAX_CHIP_RATE = 1_000 * 10 ** STAKE_DECIMALS;

/**
 * The rate that keeps the peg at a token price, in base units a chip:
 * (5/900) / price x 10^6. Rounded to the nearest base unit and clamped to the
 * program's range, so it is always a rate the program would accept on its own.
 */
export function rateForPrice(usdPerToken: number): { rate: number; clamped: boolean } {
  if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) throw new Error(`not a price: ${usdPerToken}`);
  const exact = (USD_PER_CHIP / usdPerToken) * 10 ** STAKE_DECIMALS;
  const rate = Math.min(MAX_CHIP_RATE, Math.max(1, Math.round(exact)));
  return { rate, clamped: exact > MAX_CHIP_RATE };
}
