"use client";
import { useEffect, useState } from "react";
import { usd } from "@/lib/launchpad";
import type { Market } from "@/lib/token-market";
type Row = { mint: string; name: string; ticker: string; market: Market | null };
export function TokenMonitor({ token }: { token: string }) {
  const [tokens, setTokens] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let gone = false;
    const read = async () => { try { const res = await fetch("/api/admin/tokens", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }); if (!res.ok) throw new Error(); const data = await res.json(); if (!gone) { setTokens(data.tokens); setError(false); } } catch { if (!gone) setError(true); } };
    void read(); const timer = setInterval(() => void read(), 30_000);
    return () => { gone = true; clearInterval(timer); };
  }, [token]);
  return <section className="hud-card px-4 py-3"><h2 className="text-accent">Launch token monitoring</h2><p className="mt-1 text-[12px] text-muted">Tokens with 12 verified hours of zero buys, sells and volume are archived from public pages and totals. Records remain here.</p>{error ? <p className="text-loss">Monitoring unavailable.</p> : !tokens ? <p>Loading…</p> : !tokens.length ? <p className="text-muted">No confirmed launches yet.</p> : <ul className="divide-y divide-line">{tokens.map((t) => <li key={t.mint} className="py-3 text-[12px]"><p>{t.name} (${t.ticker}) · <span className={t.market?.inactiveAt ? "text-loss" : "text-accent"}>{t.market?.inactiveAt ? "Archived: inactive 12h" : t.market?.health === "ok" ? "Active" : "Market data unavailable"}</span></p><p className="break-all font-mono text-[10px] text-muted">{t.mint}</p><p>Market cap {usd(t.market?.marketCapUsd ?? null)} · 24h volume {usd(t.market?.volume24hUsd ?? null)}</p>{t.market?.observedAt ? <p className="text-muted">Last verified {new Date(t.market.observedAt).toLocaleString()}</p> : null}</li>)}</ul>}</section>;
}
