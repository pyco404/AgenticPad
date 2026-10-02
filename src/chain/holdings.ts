import { PublicKey, type Connection } from "@solana/web3.js";
import type { HoldingsChain } from "../db/holdings.js";

/**
 * The chain side of holdings: what a wallet holds of one token, read over RPC.
 *
 * No program and no key are involved. A holder agent's tokens stay in its
 * owner's wallet (docs/holder-agents.md), so all the server ever does is look.
 *
 * Every account the wallet owns for the mint is counted, not only the
 * associated one: tokens in a second account are still the owner's, and an
 * owner should not lose their agent for where a wallet app happened to put
 * them. The RPC finds the accounts by mint, so SPL Token and Token-2022 mints
 * read the same way.
 */

/** A base-unit amount as the RPC gives it, a decimal string, refused rather than rounded past 2^53. */
function amountOf(raw: string, what: string): number {
  const value = BigInt(raw);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is ${raw}, more than a JavaScript number holds exactly`);
  return Number(value);
}

export function rpcHoldings(connection: Connection, mint: PublicKey): HoldingsChain {
  return {
    async balanceOf(wallet: string): Promise<number> {
      const { value } = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint }, "confirmed");
      let total = 0n;
      for (const { account } of value) {
        const parsed = account.data.parsed as { info?: { tokenAmount?: { amount?: string } } };
        const amount = parsed.info?.tokenAmount?.amount;
        if (amount === undefined) throw new Error(`an account of ${wallet} for ${mint.toBase58()} did not parse as a token account`);
        total += BigInt(amount);
      }
      return amountOf(total.toString(), `${wallet}'s holding`);
    },
    async supply(): Promise<number> {
      const { value } = await connection.getTokenSupply(mint, "confirmed");
      return amountOf(value.amount, `${mint.toBase58()}'s supply`);
    },
  };
}
