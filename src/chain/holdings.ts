import { adoptHolderPrice } from "../holder-policy.js";
import { holdingMinimum } from "../db/holdings.js";
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

export function rpcHoldings(connection: Connection, mint: PublicKey, options: { discoveryRpc?: string; livePricing?: boolean; tokenScoped?: boolean } = {}): HoldingsChain {
  let priceReadAt = 0;
  let quote: { minimum: number; priceUsd: number; decimals: number; at: number } | null = null;
  return {
    mint: options.tokenScoped ? mint.toBase58() : "",
    quote: () => quote,
    ...(options.livePricing ? { async refreshMinimum() {
      if (Date.now() - priceReadAt < 60_000) return;
      const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint.toBase58()}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Holder pricing provider unavailable");
      const pairs = await response.json() as { chainId: string; baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
      const pair = pairs.filter((p) => p.chainId === "solana" && p.baseToken.address === mint.toBase58() && Number(p.priceUsd) > 0).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (!pair) throw new Error("No verified market price for this token yet");
      const { value } = await connection.getTokenSupply(mint, "confirmed");
      const priceUsd = Number(pair.priceUsd);
      const minimum = Math.ceil(20 * 10 ** value.decimals / priceUsd);
      if (!Number.isSafeInteger(minimum) || minimum <= 0) throw new Error("Invalid token minimum");
      quote = { minimum, priceUsd, decimals: value.decimals, at: Date.now() };
      if (!options.tokenScoped) adoptHolderPrice(priceUsd, value.decimals);
      priceReadAt = Date.now();
    } } : {}),
    ...(options.discoveryRpc ? { async discoverWallets() {
      const balances = new Map<string, bigint>();
      const seen = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 1000; page++) {
        if (page > 0) await new Promise((resolve) => setTimeout(resolve, 125));
        const response = await fetch(options.discoveryRpc!, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({ jsonrpc: "2.0", id: "holders", method: "getTokenAccounts", params: { mint: mint.toBase58(), limit: 1000, ...(cursor ? { cursor } : {}) } }) });
        if (!response.ok) throw new Error("Holder discovery unavailable");
        const body = await response.json() as { error?: unknown; result?: { cursor?: string; token_accounts: { address: string; mint: string; owner: string; amount: number }[] } };
        if (body.error || !body.result || !Array.isArray(body.result.token_accounts)) throw new Error("Invalid holder discovery response");
        for (const account of body.result.token_accounts) {
          if (seen.has(account.address)) continue;
          if (account.mint !== mint.toBase58() || !Number.isSafeInteger(account.amount) || account.amount < 0) throw new Error("Invalid token account");
          seen.add(account.address);
          if (!PublicKey.isOnCurve(new PublicKey(account.owner).toBytes())) continue;
          balances.set(account.owner, (balances.get(account.owner) ?? 0n) + BigInt(account.amount));
        }
        if (!body.result.token_accounts.length || !body.result.cursor) return [...balances].filter(([, amount]) => amount >= BigInt(options.tokenScoped ? quote?.minimum ?? Number.MAX_SAFE_INTEGER : holdingMinimum())).map(([wallet]) => wallet);
        cursor = body.result.cursor;
        if (cursors.has(cursor)) throw new Error("Holder discovery cursor repeated");
        cursors.add(cursor);
      }
      throw new Error("Holder discovery exceeded page limit");
    } } : {}),
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
