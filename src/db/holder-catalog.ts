import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import type { Db } from "./client.js";
import { holderTokens } from "./schema.js";
import { holdingOf, readHolding, refreshHolders, type HoldingsChain } from "./holdings.js";
import { activateHolder } from "./holder-activation.js";

export type HolderToken = { mint: string; symbol: string; name: string };
export type HolderCatalog = {
  tokens(): Promise<HolderToken[]>;
  chain(mint: string): Promise<HoldingsChain | null>;
  refreshWallet(wallet: string): Promise<void>;
  stop(): void;
};

/** Only the operator's configured launch service can add mints, never a submitted wallet list. */
export function startHolderCatalog(db: Db, options: {
  url: string; primaryMint: string; chainFor: (mint: string) => HoldingsChain;
  intervalMs?: number; onError?: (error: unknown) => void;
}): HolderCatalog {
  const origin = new URL(options.url);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Holder launch service requires HTTPS");
  const chains = new Map<string, HoldingsChain>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let importedAt = 0;
  let pending: Promise<void> | null = null;
  async function sync() {
    if (Date.now() - importedAt < 60_000) return;
    if (pending) return pending;
    pending = (async () => {
      const url = new URL("/api/launchpad/holder-tokens", origin);
      let offset = 0;
      for (let page = 0; page < 1000; page++) {
        url.searchParams.set("offset", String(offset));
        const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("Confirmed launch catalog unavailable");
        const body = await response.json() as { network?: string; tokens?: HolderToken[]; nextOffset?: number | null };
        if (body.network !== "mainnet-beta" || !Array.isArray(body.tokens) || body.tokens.length > 100) throw new Error("Invalid confirmed launch catalog");
        for (const item of body.tokens) {
          const mint = new PublicKey(item.mint).toBase58();
          if (typeof item.name !== "string" || typeof item.symbol !== "string" || item.name.length > 100 || item.symbol.length > 30) throw new Error("Invalid launch token metadata");
          if (mint === options.primaryMint) continue;
          await db.insert(holderTokens).values({ mint, name: item.name, symbol: item.symbol })
            .onConflictDoUpdate({ target: holderTokens.mint, set: { name: item.name, symbol: item.symbol } });
        }
        if (body.nextOffset === null) { importedAt = Date.now(); return; }
        if (!Number.isInteger(body.nextOffset) || body.nextOffset! <= offset) throw new Error("Invalid catalog pagination");
        offset = body.nextOffset!;
      }
      throw new Error("Launch catalog exceeded page limit");
    })().finally(() => { pending = null; });
    return pending;
  }
  async function tokens() {
    try { await sync(); } catch (error) { options.onError?.(error); }
    return db.select().from(holderTokens);
  }
  async function chain(mint: string) {
    const [token] = await db.select().from(holderTokens).where(eq(holderTokens.mint, mint));
    if (!token) return null;
    if (!chains.has(mint)) chains.set(mint, options.chainFor(mint));
    return chains.get(mint)!;
  }
  async function refreshWallet(wallet: string) {
    for (const token of await tokens()) {
      try {
        const reader = (await chain(token.mint))!;
        const last = await holdingOf(db, wallet, token.mint);
        if (!last || Date.now() - last.readAt.getTime() > 60_000) await readHolding(db, reader, wallet);
        await activateHolder(db, wallet, token.mint);
      } catch (error) { options.onError?.(error); }
    }
  }
  async function pass() {
    for (const token of await tokens()) {
      if (stopped) break;
      try { await refreshHolders(db, (await chain(token.mint))!); }
      catch (error) { options.onError?.(error); }
    }
    if (!stopped) timer = setTimeout(() => void pass(), options.intervalMs ?? 10 * 60_000);
  }
  void pass().catch((error) => options.onError?.(error));
  return { tokens, chain, refreshWallet, stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
