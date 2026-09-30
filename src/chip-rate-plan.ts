import { STAKE_DECIMALS } from "./chips.js";

/**
 * The arithmetic of setting a season's chip rate, apart from anything that
 * sends it, so the numbers can be checked before a key signs them.
 *
 * All of it follows docs/economy.md, The chip rate, and docs/mainnet.md,
 * decision 9. The rule it plans around is the program's own `rate_change_ok`:
 * a rate may rise by any amount under the ceiling and fall to no less than half
 * of what it was, per instruction.
 */

/** The peg: 900 chips, the reference starting balance, is $5. */
export const USD_PER_CHIP = 5 / 900;

/** Renting an agent costs $2 (docs/mainnet.md, decision 9): 360 chips at the peg. */
export const RENT_USD = 2;
export const RENT_CHIPS = Math.round(RENT_USD / USD_PER_CHIP);

/** The program's `MAX_CHIP_RATE`: 1,000 whole tokens a chip. Past it the peg is let go. */
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

/**
 * The instructions it takes to go from `current` to `target`: one step for a
 * rise, and for a fall as many halvings as it needs, each the smallest the
 * program allows (2 x next >= previous), the last landing on `target` exactly.
 * Empty when there is nothing to change.
 */
export function rateSteps(current: number, target: number): number[] {
  if (!Number.isSafeInteger(current) || current <= 0) throw new Error(`not a rate: ${current}`);
  if (!Number.isSafeInteger(target) || target <= 0 || target > MAX_CHIP_RATE) throw new Error(`not a rate the program accepts: ${target}`);
  if (target === current) return [];
  if (target > current) return [target];
  const steps: number[] = [];
  let at = current;
  while (at > target) {
    at = Math.max(target, Math.ceil(at / 2));
    steps.push(at);
  }
  return steps;
}

/** The rent the program should demand at a rate: $2 in base units. */
export function rentFor(rate: number): number {
  return RENT_CHIPS * rate;
}
