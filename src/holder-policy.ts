/** Live $20 eligibility is separate from the season's fixed game chip rate. */
let live = false;
let quote: { minimum: number; priceUsd: number; decimals: number; at: number } | null = null;
export function useLiveHolderPricing(enabled: boolean) { live = enabled; quote = null; }
export function liveHolderPricing() { return live; }
export function holderPriceReady(now = Date.now()) { return !live || !!quote && now - quote.at <= 15 * 60_000; }
export function holderQuote() { return quote; }
export function adoptHolderPrice(priceUsd: number, decimals: number, at = Date.now()) {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error("Invalid holder price");
  const minimum = Math.ceil(20 * 10 ** decimals / priceUsd);
  if (!Number.isSafeInteger(minimum) || minimum <= 0) throw new Error("Holder minimum is outside the supported range");
  quote = { minimum, priceUsd, decimals, at };
}
export function liveHolderMinimum(fallback: number) { return live ? quote?.minimum ?? Number.MAX_SAFE_INTEGER : fallback; }
