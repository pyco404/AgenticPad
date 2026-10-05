/** Parse SOL without floating-point rounding. Empty means no optional buy. */
export function solToLamports(value: string): number {
  const text = value.trim() || "0";
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(text)) throw new Error("Enter a non-negative SOL amount with at most 9 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The SOL amount is too large.");
  return Number(amount);
}
