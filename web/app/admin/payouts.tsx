"use client";

import { useCallback, useEffect, useState } from "react";
import type { PayoutInput, PayoutPlan } from "@/lib/payout-plan";

type Overview = { plans: PayoutPlan[]; agpMint: string | null; executionConnected: boolean };
const sol = (value: string) => {
  const n = BigInt(value);
  return `${n / 1_000_000_000n}.${(n % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"}`;
};

export function PayoutPanel({ token }: { token: string }) {
  const [input, setInput] = useState<PayoutInput>({ kind: "daily", period: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), budgetSol: "", rewardPercent: "90", batchSol: "0.25", delaySeconds: 60, slippageBps: 50 });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plan, setPlan] = useState<PayoutPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/api/admin/payouts/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Payout request failed.");
    return value as T;
  }, [token]);
  const load = useCallback(async () => setOverview(await call<Overview>("plans")), [call]);
  useEffect(() => { setPlan(null); setOverview(null); void load().catch((e) => setError(e.message)); }, [load]);
  async function act(approve = false) {
    setBusy(true); setError(null);
    try {
      const result = approve && plan ? await call<PayoutPlan>(`${plan.id}/approve`, {}) : await call<PayoutPlan>("preview", input);
      setPlan(result); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function change<K extends keyof PayoutInput>(key: K, value: PayoutInput[K]) { setInput((old) => ({ ...old, [key]: value })); setPlan(null); }
  const control = "mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-text";
  return <section className="rounded-panel border border-line bg-panel p-4 text-[13px]">
    <h2 className="text-accent uppercase tracking-wider">Reward payout plans</h2>
    <p className="mt-2 text-muted">Hold SOL until payout. Swap a small batch into $AGP, send it to winners, then wait before the next batch. Approval here records a plan; it does not send funds.</p>
    <p className="mt-2 text-gold">Swap execution is not connected yet.{!overview?.agpMint ? " Set PAYOUT_AGP_MINT before approving plans." : " Approved plans wait for the payout executor."}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label>Reward wallet<select className={control} value={input.kind} onChange={(e) => change("kind", e.target.value as PayoutInput["kind"])}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
      <label>{input.kind === "daily" ? "Completed UTC day" : "Completed season (Monday UTC)"}<input type="date" className={control} value={input.period} onChange={(e) => change("period", e.target.value)} /></label>
      <label>SOL budget (excluding network fees)<input className={control} inputMode="decimal" value={input.budgetSol} onChange={(e) => change("budgetSol", e.target.value)} placeholder="10" /></label>
      <label>Payout percentage<input className={control} inputMode="decimal" value={input.rewardPercent} onChange={(e) => change("rewardPercent", e.target.value)} /><span className="text-muted">The remaining SOL stays in this reward wallet for future payouts. The platform takes no cut.</span></label>
      <label>Maximum SOL per swap batch<input className={control} inputMode="decimal" value={input.batchSol} onChange={(e) => change("batchSol", e.target.value)} /></label>
      <label>Minimum delay between batches (seconds)<input type="number" min={30} className={control} value={input.delaySeconds} onChange={(e) => change("delaySeconds", Number(e.target.value))} /></label>
      <label>Maximum slippage (basis points)<input type="number" min={1} max={500} className={control} value={input.slippageBps} onChange={(e) => change("slippageBps", Number(e.target.value))} /><span className="text-muted">50 basis points = 0.5%. Batching cannot guarantee protection from bots.</span></label>
    </div>
    {error ? <p className="mt-3 text-loss" role="alert">{error}</p> : null}
    <button disabled={busy} onClick={() => void act()} className="mt-4 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">{busy ? "Working…" : "Preview payout plan"}</button>
    {plan ? <div className="mt-4 border-t border-line pt-4">
      <p>{plan.kind} · {plan.period} · {plan.status}</p>
      <p className="mt-2">Swap allocation: {sol(plan.allocatedLamports)} SOL · Retained in reward wallet: {sol(plan.carryoverLamports)} SOL</p>
      {BigInt(plan.platformLamports) > 0n ? <p className="mt-2 text-gold">This older plan includes a platform cut. Preview a new plan before approval.</p> : null}
      <p className="mt-2 text-muted">{plan.batchLamports.length} batches, waiting at least {plan.delaySeconds} seconds between them. Each winner keeps the existing 10% cap; unallocated rewards remain in the reward wallet. Final $AGP amounts depend on each confirmed swap.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Winner</th><th>Wallet</th><th>SOL allocation</th></tr></thead><tbody>{plan.winners.map((winner) => <tr key={winner.agentId} className="border-t border-line"><td className="py-2">{winner.name}</td><td className="font-mono">{winner.wallet.slice(0, 6)}…{winner.wallet.slice(-4)}</td><td>{sol(winner.lamports)}</td></tr>)}</tbody></table></div>
      <button disabled={busy || !plan.agpMint || BigInt(plan.platformLamports) > 0n || plan.status === "approved"} onClick={() => void act(true)} className="mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">{plan.status === "approved" ? "Plan approved · awaiting execution" : "Approve plan"}</button>
    </div> : null}
    {overview?.plans.length ? <div className="mt-4 border-t border-line pt-3"><h3>Payout plan history</h3>{overview.plans.map((item) => <button key={item.id} onClick={() => setPlan(item)} className="block w-full border-b border-line py-2 text-left text-muted">{item.kind} · {item.period} · {item.status} · {sol(item.budgetLamports)} SOL budget</button>)}</div> : null}
  </section>;
}
