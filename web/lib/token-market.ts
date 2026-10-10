import { launchStore, type LaunchStore } from "./launchpad-store";
import { AGP_MINT } from "./agp";

export const INACTIVITY_MS = 4 * 60 * 60_000;
const HOUR = 60 * 60_000;
export type Market = {
  mint: string; checkedAt: number; observedAt: number | null;
  zeroSince: number | null; inactiveAt: number | null;
  marketCapUsd: number | null; volume24hUsd: number | null;
  priceUsd: number | null; health: "ok" | "unknown";
  /** Wallets holding the token, how far along pump.fun's bonding curve it is (0–100), and agents in play. */
  holders?: number | null; bondingProgress?: number | null; agentsInPlay?: number;
};

/** pump.fun's own progress: the share of the curve's sellable tokens already bought, 100 once graduated. */
export function curveProgress(curve: { realTokenReserves: { toString(): string }; complete: boolean }, initialRealTokenReserves: { toString(): string }): number {
  if (curve.complete) return 100;
  const initial = Number(initialRealTokenReserves.toString()), left = Number(curve.realTokenReserves.toString());
  if (!(initial > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - left / initial) * 100)));
}
export type Pair = {
  chainId: string; pairAddress: string; baseToken: { address: string }; quoteToken: { address: string };
  priceUsd?: string; marketCap?: number; liquidity?: { usd?: number };
  volume?: { h1?: number; h24?: number }; txns?: { h1?: { buys?: number; sells?: number } };
};
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** A complete hourly zero window can extend the prior window only while they overlap. */
export function observeMarket(mint: string, createdAt: number, pairs: Pair[], prev: Market | null, now = Date.now()): Market {
  // The platform token stays listed; exemption is by mint, never by ticker.
  const exempt = mint === AGP_MINT;
  if (exempt && prev) prev = { ...prev, zeroSince: null, inactiveAt: null };
  const relevant = [...new Map(pairs.filter((p) => p.chainId === "solana" && (p.baseToken?.address === mint || p.quoteToken?.address === mint)).map((p) => [p.pairAddress, p])).values()];
  const empty: Market = { mint, checkedAt: now, observedAt: prev?.observedAt ?? null, zeroSince: null, inactiveAt: prev?.inactiveAt ?? null, marketCapUsd: prev?.marketCapUsd ?? null, volume24hUsd: prev?.volume24hUsd ?? null, priceUsd: prev?.priceUsd ?? null, health: "unknown" };
  if (!relevant.length || relevant.some((p) => !number(p.volume?.h1) || !number(p.volume?.h24) || !number(p.txns?.h1?.buys) || !number(p.txns?.h1?.sells))) return empty;
  const quiet = !exempt && relevant.every((p) => p.volume!.h1 === 0 && p.txns!.h1!.buys === 0 && p.txns!.h1!.sells === 0);
  const zeroSince = quiet ? prev?.health === "ok" && prev.zeroSince !== null && prev.observedAt !== null && now - prev.observedAt <= HOUR ? prev.zeroSince : Math.max(createdAt, now - HOUR) : null;
  const base = relevant.filter((p) => p.baseToken.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  return { mint, checkedAt: now, observedAt: now, zeroSince, inactiveAt: prev?.inactiveAt ?? (zeroSince !== null && now - zeroSince >= INACTIVITY_MS ? now : null), marketCapUsd: number(base?.marketCap) ? base.marketCap : null, volume24hUsd: relevant.reduce((sum, p) => sum + p.volume!.h24!, 0), priceUsd: Number(base?.priceUsd) > 0 ? Number(base!.priceUsd) : null, health: "ok" };
}
export class MarketStore {
  constructor(readonly store: LaunchStore = launchStore()) {
    store.db.exec("CREATE TABLE IF NOT EXISTS token_market (mint TEXT PRIMARY KEY, data TEXT NOT NULL)");
  }
  get(mint: string): Market | null {
    const row = this.store.db.prepare("SELECT data FROM token_market WHERE mint = ?").get(mint) as { data: string } | undefined;
    const market: Market | null = row ? JSON.parse(row.data) : null;
    // Restore visibility immediately even before the next monitoring pass.
    return market && mint === AGP_MINT ? { ...market, zeroSince: null, inactiveAt: null } : market;
  }
  save(market: Market) { this.store.db.prepare("INSERT INTO token_market(mint, data) VALUES (?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data").run(market.mint, JSON.stringify(market)); }
  visible(mint: string) { return !this.get(mint)?.inactiveAt; }
}
/**
 * On-chain figures the market provider does not give: holders (owners with a balance, read through
 * Helius's token-account index, so only when the launch RPC is Helius) and bonding-curve progress.
 */
export async function chainFigures(mint: string): Promise<{ holders: number | null; bondingProgress: number | null }> {
  const rpc = process.env.PUMP_RPC_URL;
  if (!rpc) return { holders: null, bondingProgress: null };
  let bondingProgress: number | null = null, holders: number | null = null;
  try {
    const { pump } = await import("./pump-sdk");
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
    const key = new PublicKey(mint);
    const [curveAccount, global] = await Promise.all([connection.getAccountInfo(pump.bondingCurvePda(key)), new pump.OnlinePumpSdk(connection).fetchGlobal()]);
    if (curveAccount) bondingProgress = curveProgress(pump.PUMP_SDK.decodeBondingCurve(curveAccount), global.initialRealTokenReserves);
    // The curve's own token account is a pool, not a holder.
    const pools = new Set([pump.bondingCurvePda(key).toBase58()]);
    if (rpc.includes("helius")) {
      const owners = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ jsonrpc: "2.0", id: "holders", method: "getTokenAccounts", params: { mint, limit: 1000, ...(cursor ? { cursor } : {}) } }) });
        const body = await response.json() as { result?: { token_accounts?: { owner: string; amount: number }[]; cursor?: string } };
        const accounts = body.result?.token_accounts;
        if (!response.ok || !accounts) throw new Error("holder index unavailable");
        for (const a of accounts) if (a.amount > 0 && !pools.has(a.owner)) owners.add(a.owner);
        cursor = body.result?.cursor;
        if (!cursor || accounts.length < 1000) { holders = owners.size; break; }
      }
    }
  } catch { /* leave what could not be read unknown */ }
  return { holders, bondingProgress };
}

/** Agents in play per launch token, from the game server (src/http/server.ts /stats). */
async function agentCounts(): Promise<Record<string, number> | null> {
  const backend = process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  try {
    const response = await fetch(`${backend}/stats`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.json() as { agentsByMint?: Record<string, number> };
    return body.agentsByMint && typeof body.agentsByMint === "object" ? body.agentsByMint : null;
  } catch { return null; }
}

let running = false;
export async function refreshTokenMarkets(store = launchStore()) {
  if (running) return;
  running = true;
  try {
    const markets = new MarketStore(store);
    const agents = await agentCounts();
    for (const launch of store.list().filter((l) => l.confirmed)) {
      const prev = markets.get(launch.mint);
      if (prev && Date.now() - prev.checkedAt < 5 * 60_000) continue;
      let next: Market;
      try {
        const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${launch.mint}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("Market provider unavailable");
        const pairs = await response.json() as Pair[];
        if (!Array.isArray(pairs)) throw new Error("Invalid market response");
        next = observeMarket(launch.mint, launch.createdAt, pairs, prev);
      } catch {
        next = observeMarket(launch.mint, launch.createdAt, [], prev);
      }
      const chain = await chainFigures(launch.mint);
      markets.save({ ...next,
        holders: chain.holders ?? prev?.holders ?? null,
        bondingProgress: chain.bondingProgress ?? prev?.bondingProgress ?? null,
        agentsInPlay: agents ? agents[launch.mint] ?? 0 : prev?.agentsInPlay ?? 0 });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally { running = false; }
}
export function startTokenMarkets() {
  const pass = () => void refreshTokenMarkets().catch(() => console.error("Market refresh unavailable"));
  pass();
  const timer = setInterval(pass, 5 * 60_000);
  timer.unref();
}
