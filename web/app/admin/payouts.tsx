"use client";

import { useCallback, useEffect, useState } from "react";
import type { PayoutInput, PayoutPlan } from "@/lib/payout-plan";
import type { PayoutExecutionView } from "@/lib/payout-execution";
import { useWallet } from "@/app/wallet-context";
import { signTransactionWith, type WalletName } from "@/lib/wallet";

type Overview = { plans: PayoutPlan[]; agpMint: string | null; executionConnected: boolean; executionMissing: string[]; executions: PayoutExecutionView[] };
const sol = (value: string) => {
  const n = BigInt(value);
  return `${n / 1_000_000_000n}.${(n % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"}`;
};

export function PayoutPanel({ token }: { token: string }) {
  const { session, signTransaction } = useWallet();
  const [signer, setSigner] = useState<WalletName>("Phantom");
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
  const load = useCallback(async (quiet = false) => {
    setOverview(await call<Overview>("plans"));
    if (!quiet) setError(null);
  }, [call]);
  useEffect(() => { setPlan(null); setOverview(null); void load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(true).catch(() => {}), 5_000);
    return () => clearInterval(timer);
  }, [load]);
  const execution = overview?.executions?.find(item => item.planId === plan?.id);
  async function execute(action: "start" | "pause" | "resume" | "prepare") {
    if (!plan || !session) return;
    setBusy(true); setError(null);
    try {
      const result = await call<{ transaction?: { prepared: string; source: string } | null }>(`${plan.id}/${action}`, {});
      if (action === "prepare" && result.transaction) {
        // The operator session authorizes the API; only the reward wallet signs spending.
        const signed = session.wallet === "Privy" && session.ownerId === result.transaction.source
          ? await signTransaction(result.transaction.prepared)
          : await signTransactionWith({ ...session, wallet: signer, ownerId: result.transaction.source }, result.transaction.prepared);
        await call(`${plan.id}/submit`, { signed });
      }
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
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
    <p className="mt-2 text-muted">Hold SOL until payout. Swap a small batch into $AGP, send it to winners, then wait before the next batch. Approving a plan does not send funds. Start it, then approve each swap and winner transfer in the reward wallet.</p>
    {!overview?.executionConnected ? <p className="mt-2 text-gold">Payout execution needs configuration: {overview?.executionMissing?.join(", ") || "loading settings…"}. Reward-wallet private keys stay in your wallet.</p> : <p className="mt-2 text-muted">Wallet approval is connected. Payments count only after finalized on-chain confirmation.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label>Reward wallet<select className={control} value={input.kind} onChange={(e) => change("kind", e.target.value as PayoutInput["kind"])}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
      <label>{input.kind === "daily" ? "Completed UTC day" : "Completed season (Monday UTC)"}<input type="date" className={control} value={input.period} onChange={(e) => change("period", e.target.value)} />{input.kind === "weekly" ? <span className="text-muted">Select the Monday that started the completed week.</span> : null}</label>
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
      <button disabled={busy || !plan.agpMint || BigInt(plan.platformLamports) > 0n || plan.status === "approved"} onClick={() => void act(true)} className="mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">{plan.status === "approved" ? "Plan approved" : "Approve plan"}</button>
      {plan.status === "approved" && !execution ? <button disabled={busy || !overview?.executionConnected} onClick={() => void execute("start")} className="ml-3 mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">Start wallet-approved payout</button> : null}
      {execution ? <div className="mt-4 border-t border-line pt-3">
        <p>{execution.status} · Batch {Math.min(execution.batch + 1, execution.batches.length)} of {execution.batches.length}</p>
        <p className="mt-2 break-all text-muted">Signing wallet: {plan.source}. Switch the selected wallet extension to this reward account; your admin session stays signed in.</p>
        <label className="mt-2 block">Signing extension<select className={control} value={signer} onChange={e => setSigner(e.target.value as WalletName)}><option>Phantom</option><option>Solflare</option></select></label>
        {execution.error ? <p className="mt-2 text-loss">{execution.error}</p> : null}
        {execution.status === "running" ? <>
          <p className="mt-2 text-muted">{execution.nextAt > Date.now() ? `Next batch available after ${new Date(execution.nextAt).toLocaleTimeString()}.` : "Check progress and approve the next unsigned step. Pending transactions are checked before another payment is prepared."}</p>
          <button disabled={busy || execution.nextAt > Date.now()} onClick={() => void execute("prepare")} className="mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">Check progress / approve next step</button>
          <button disabled={busy} onClick={() => void execute("pause")} className="ml-3 mt-3 rounded border border-line px-4 py-2">Pause</button>
        </> : execution.status === "paused" ? <button disabled={busy} onClick={() => void execute("resume")} className="mt-3 rounded border border-line px-4 py-2 text-accent">Resume saved payout</button> : <p className="mt-2 text-live">All batches and winner transfers confirmed.</p>}
        <div className="mt-3 space-y-2 text-muted">{execution.batches.map((batch, index) => <div key={index}>
          <p>Batch {index + 1}: {batch.completedAt ? "complete" : batch.output ? "distributing" : batch.swap?.signature ? "swap pending" : "awaiting wallet approval"}</p>
          {batch.swap?.signature ? <a target="_blank" rel="noreferrer" className="text-accent" href={`https://solscan.io/tx/${batch.swap.signature}`}>Swap transaction</a> : null}
          {batch.payments.filter(p => p.tx?.signature).map(payment => <p key={payment.wallet}><a target="_blank" rel="noreferrer" className="text-accent" href={`https://solscan.io/tx/${payment.tx!.signature}`}>{payment.wallet.slice(0, 6)}… · {payment.confirmed ? "paid" : "pending"}</a></p>)}
        </div>)}</div>
        {execution.failedAttempts?.length ? <div className="mt-3 text-muted"><p>Previous failed or expired attempts:</p>{execution.failedAttempts.map((attempt, index) => <p key={index}>{attempt.signature ? <a className="text-accent" href={`https://solscan.io/tx/${attempt.signature}`} target="_blank" rel="noreferrer">Batch {attempt.batch + 1} · {attempt.outcome}</a> : attempt.outcome}</p>)}</div> : null}
      </div> : null}
    </div> : null}
    {overview?.plans.length ? <div className="mt-4 border-t border-line pt-3"><h3>Payout plan history</h3>{overview.plans.map((item) => <button key={item.id} onClick={() => setPlan(item)} className="block w-full border-b border-line py-2 text-left text-muted">{item.kind} · {item.period} · {item.status} · {sol(item.budgetLamports)} SOL budget</button>)}</div> : null}
  </section>;
}
