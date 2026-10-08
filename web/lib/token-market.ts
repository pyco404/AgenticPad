import { launchStore, type LaunchStore } from "./launchpad-store";

export const INACTIVITY_MS = 4 * 60 * 60_000;
const HOUR = 60 * 60_000;
export type Market = {
  mint: string; checkedAt: number; observedAt: number | null;
  zeroSince: number | null; inactiveAt: number | null;
  marketCapUsd: number | null; volume24hUsd: number | null;
  priceUsd: number | null; health: "ok" | "unknown";
};
export type Pair = {
  chainId: string; pairAddress: string; baseToken: { address: string }; quoteToken: { address: string };
  priceUsd?: string; marketCap?: number; liquidity?: { usd?: number };
  volume?: { h1?: number; h24?: number }; txns?: { h1?: { buys?: number; sells?: number } };
};
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** A complete hourly zero window can extend the prior window only while they overlap. */
export function observeMarket(mint: string, createdAt: number, pairs: Pair[], prev: Market | null, now = Date.now()): Market {
  const relevant = [...new Map(pairs.filter((p) => p.chainId === "solana" && (p.baseToken?.address === mint || p.quoteToken?.address === mint)).map((p) => [p.pairAddress, p])).values()];
  const empty: Market = { mint, checkedAt: now, observedAt: prev?.observedAt ?? null, zeroSince: null, inactiveAt: prev?.inactiveAt ?? null, marketCapUsd: prev?.marketCapUsd ?? null, volume24hUsd: prev?.volume24hUsd ?? null, priceUsd: prev?.priceUsd ?? null, health: "unknown" };
  if (!relevant.length || relevant.some((p) => !number(p.volume?.h1) || !number(p.volume?.h24) || !number(p.txns?.h1?.buys) || !number(p.txns?.h1?.sells))) return empty;
  const quiet = relevant.every((p) => p.volume!.h1 === 0 && p.txns!.h1!.buys === 0 && p.txns!.h1!.sells === 0);
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
    return row ? JSON.parse(row.data) : null;
  }
  save(market: Market) { this.store.db.prepare("INSERT INTO token_market(mint, data) VALUES (?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data").run(market.mint, JSON.stringify(market)); }
  visible(mint: string) { return !this.get(mint)?.inactiveAt; }
}
let running = false;
export async function refreshTokenMarkets(store = launchStore()) {
  if (running) return;
  running = true;
  try {
    const markets = new MarketStore(store);
    for (const launch of store.list().filter((l) => l.confirmed)) {
      const prev = markets.get(launch.mint);
      if (prev && Date.now() - prev.checkedAt < 5 * 60_000) continue;
      try {
        const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${launch.mint}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("Market provider unavailable");
        const pairs = await response.json() as Pair[];
        if (!Array.isArray(pairs)) throw new Error("Invalid market response");
        markets.save(observeMarket(launch.mint, launch.createdAt, pairs, prev));
      } catch {
        markets.save(observeMarket(launch.mint, launch.createdAt, [], prev));
      }
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
