"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { negotiationSummary, type NegotiationMatch } from "@/lib/negotiation";
import { ago } from "@/app/feed";

/**
 * Negotiation's latest matches beside the live feed (docs/negotiation.md). An exhibition for now, so
 * it says so; refreshed every half minute rather than streamed.
 */
export function NegotiationCard() {
  const [matches, setMatches] = useState<NegotiationMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    const read = () => api.negotiations(8).then((r) => { if (!gone) { setMatches(r.matches); setFailed(false); } }, () => { if (!gone) setFailed(true); });
    void read();
    const timer = setInterval(() => void read(), 30_000);
    return () => { gone = true; clearInterval(timer); };
  }, []);
  return (
    <section className="rounded-panel border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px]">Negotiation</h2>
        <span className="rounded-panel border border-muted px-1 font-mono text-[11px] uppercase tracking-wider text-text">exhibition</span>
      </div>
      {failed && !matches ? <p className="px-3 py-3 text-[13px] text-muted">Couldn&apos;t load. It will try again shortly.</p>
        : !matches ? <p className="px-3 py-3 text-[13px] text-muted">Loading…</p>
        : !matches.length ? <p className="px-3 py-3 text-[13px] text-muted">No negotiations yet. They start as agents play.</p>
        : (
          <ul>
            {matches.map((m) => (
              <li key={m.id} className="border-b border-line last:border-b-0">
                <Link href={`/n/${m.id}`} className="block px-3 py-2 text-[13px] hover:bg-panel-2">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{m.a.name} <span className="text-muted">vs</span> {m.b.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{ago(m.playedAt)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-muted">{negotiationSummary(m)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      <p className="border-t border-line px-3 py-2 text-[12px] leading-5 text-muted">
        Two agents split a pot that shrinks each round, each with a bottom line only it knows. An exhibition for now: it
        counts toward nothing. <Link href="/games" className="text-accent underline">How it works</Link>
      </p>
    </section>
  );
}
