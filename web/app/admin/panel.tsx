"use client";

import { useCallback, useEffect, useState } from "react";
import { API, api, ApiError, type AdminHealth } from "@/lib/api";
import { useWallet } from "@/app/wallet-context";
import { TokenMonitor } from "./tokens";
import { PayoutPanel } from "./payouts";
import { CopyButton } from "@/app/copy-button";

/**
 * Operational health, for the operator.
 *
 * Under holder agents nothing here watches money move: there is no program and
 * no vault (docs/holder-agents.md). What can go quietly wrong is the reading of
 * wallets - every holder left on an old figure - and the freezing of each
 * day's scores, which payouts are made from. Those come first; activity is at
 * the bottom because it is what you read when nothing is wrong.
 *
 * Every figure comes from the API. Nothing here computes anything, on purpose:
 * a dashboard that does its own arithmetic is a second implementation that can
 * disagree with the first.
 */

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function Row({ label, value, tone = "plain", sub }: { label: string; value: string; tone?: "plain" | "good" | "bad"; sub?: string }) {
  const colour = tone === "bad" ? "text-loss" : tone === "good" ? "text-gold" : "text-text";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="text-right">
        <span className={`font-mono text-[13px] ${colour}`}>{value}</span>
        {sub ? <span className="ml-2 text-[11px] text-muted">{sub}</span> : null}
      </span>
    </div>
  );
}

function Card({ title, state, children }: { title: string; state?: "ok" | "warn" | "unknown"; children: React.ReactNode }) {
  const dot = state === "warn" ? "bg-loss" : state === "ok" ? "bg-gold" : "bg-line";
  return (
    <section className="rounded-panel border border-line bg-panel">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">
        {state ? <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden /> : null}
        {title}
      </h2>
      <div className="px-4 py-2">{children}</div>
    </section>
  );
}

export function AdminPanel() {
  const { session } = useWallet();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setHealth(await api.admin(session.token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: String(e) });
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    // Read again on a timer: this page is opened when something looks wrong,
    // which is exactly when a figure that stopped updating is worst.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!session) {
    return (
      <section className="hud-card p-5">
        <h2 className="text-lg font-semibold text-text">Admin wallet required</h2>
        <p className="mt-2 text-[13px] leading-6 text-muted">Use Sign in in the top bar to connect your admin wallet. Only wallets configured in the API service’s ADMIN_WALLETS can view the dashboard.</p>
      </section>
    );
  }
  if (error?.status === 404) {
    // Keep the API's access check intact; show only the caller's own connection.
    return (
      <section className="hud-card space-y-3 p-5">
        <h2 className="text-lg font-semibold text-text">Admin access unavailable</h2>
        <p className="text-[13px] leading-6 text-muted">This API has not granted admin access to your signed-in wallet, or its admin route is unavailable.</p>
        <dl className="space-y-2 text-[12px]">
          <div><dt className="text-muted">API</dt><dd className="break-all font-mono text-text">{API}</dd></div>
          <div><dt className="text-muted">Signed-in wallet</dt><dd className="break-all font-mono text-text">{session.ownerId}</dd><dd className="mt-2"><CopyButton value={session.ownerId} label="Copy wallet address" /></dd></div>
        </dl>
        <p className="text-[13px] leading-6 text-muted">Check ADMIN_WALLETS on this API. Local settings belong in the project root .env and are loaded when the API starts. Restart the API after changing them.</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-panel border border-hud-line px-3 py-2 text-[13px] text-accent disabled:opacity-50">{loading ? "Checking…" : "Check access again"}</button>
      </section>
    );
  }
  if (error) {
    return (
      <p className="text-[13px] text-loss">
        {error.message} <button onClick={() => void load()} className="ml-2 underline">retry</button>
      </p>
    );
  }
  if (!health) return <p className="text-[13px] text-muted">Reading…</p>;

  const { holdings, scores, matches } = health;

  return (
    <div className="flex flex-col gap-4">
      <PayoutPanel token={session.token} />
      <TokenMonitor token={session.token} />
      <p className="text-[11px] text-muted">
        Read {new Date(health.at).toISOString().replace("T", " ").slice(0, 19)}Z, again every 30s
        {loading ? " · reading…" : ""}
      </p>

      <Card title="Wallet readings" state={holdings.stale ? "warn" : holdings.wallets === 0 ? "unknown" : "ok"}>
        <Row label="Holders in play" value={num(health.holders)} />
        <Row label="Wallets read" value={num(holdings.wallets)} />
        <Row
          label="Oldest reading"
          value={holdings.oldestAgeMs === null ? "none yet" : duration(holdings.oldestAgeMs)}
          tone={holdings.stale ? "bad" : "plain"}
          sub={`stale past ${duration(holdings.staleAfterMs)}`}
        />
        {holdings.stale ? (
          <p className="py-2 text-[12px] leading-5 text-loss">
            Wallets have not been read for three passes. Holders are being judged on old figures: check the RPC.
          </p>
        ) : null}
      </Card>

      <Card title="Score freeze" state={scores.behind > 0 ? "warn" : "ok"}>
        <Row label="Last day frozen" value={scores.lastFrozen ?? "none yet"} />
        <Row label="Days over, not frozen" value={num(scores.behind)} tone={scores.behind > 0 ? "bad" : "good"} />
      </Card>

      <Card title="Today">
        <Row label="Matches" value={num(matches.today)} />
        <Row label="Ranked" value={num(matches.rankedToday)} />
      </Card>
    </div>
  );
}
