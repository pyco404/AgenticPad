"use client";

import { useCallback, useEffect, useState } from "react";
import { planPeriod, type HeldPayoutInput, type PayoutInput, type PayoutPlan } from "@/lib/payout-plan";
import type { PayoutExecutionView } from "@/lib/payout-execution";
import { useWallet } from "@/app/wallet-context";
import { signTransactionWith, type WalletName } from "@/lib/wallet";
import { CopyButton } from "@/app/copy-button";

type Overview = { plans: PayoutPlan[]; agpMint: string | null; executionConnected: boolean; swapsConnected: boolean; executionMissing: string[]; executions: PayoutExecutionView[] };
const units = (value: string, decimals: number) => {
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  const fraction = decimals ? (n % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${(n / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
const sol = (value: string) => units(value, 9);
/** A plan's amount in its own unit: SOL for a swap plan, $AGP for a held one. */
const amount = (plan: PayoutPlan, value: string) => plan.funding === "held" ? `${units(value, plan.decimals ?? 0)} $AGP` : `${sol(value)} SOL`;

export function PayoutPanel({ token }: { token: string }) {
  const { session, signTransaction } = useWallet();
  const [signer, setSigner] = useState<WalletName>("Phantom");
  const [input, setInput] = useState<PayoutInput>({ kind: "daily", period: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), budgetSol: "", rewardPercent: "90", batchSol: "0.25", delaySeconds: 60, slippageBps: 50 });
  const [funding, setFunding] = useState<"held" | "swap">("held");
  const [budgetAgp, setBudgetAgp] = useState("");
  const [minScore, setMinScore] = useState("0");
  const [periodEnd, setPeriodEnd] = useState("");
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
      const held: HeldPayoutInput & { funding: "held" } = { funding: "held", kind: input.kind, period: input.period, budgetAgp, rewardPercent: input.rewardPercent };
      const result = approve && plan ? await call<PayoutPlan>(`${plan.id}/approve`, {}) : await call<PayoutPlan>("preview", { ...(funding === "held" ? held : input), minScore, ...(input.kind === "daily" && periodEnd ? { periodEnd } : {}) });
      setPlan(result); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function change<K extends keyof PayoutInput>(key: K, value: PayoutInput[K]) { setInput((old) => ({ ...old, [key]: value })); setPlan(null); }
  const control = "mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-text";
  return <section className="rounded-panel border border-line bg-panel p-4 text-[13px]">
    <h2 className="text-accent uppercase tracking-wider">Reward payout plans</h2>
    <p className="mt-2 text-muted">Buy $AGP into the reward wallet yourself, then pay winners from it: each winner transfer is approved in the reward wallet. Or let the payout swap SOL into $AGP in small batches (needs a Jupiter API key). Approving a plan does not send funds.</p>
    {!overview?.executionConnected ? <p className="mt-2 text-gold">Payout execution needs configuration: {overview?.executionMissing?.join(", ") || "loading settings…"}. Reward-wallet private keys stay in your wallet.</p> : <p className="mt-2 text-muted">Wallet approval is connected. Payments count only after finalized on-chain confirmation.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2">Funding<select className={control} value={funding} onChange={(e) => { setFunding(e.target.value as "held" | "swap"); setPlan(null); }}>
        <option value="held">$AGP already in the reward wallet</option>
        <option value="swap" disabled={!overview?.swapsConnected}>Swap SOL into $AGP during the payout{overview?.swapsConnected ? "" : " (needs JUPITER_API_KEY)"}</option>
      </select>{funding === "held" ? <span className="text-muted">Swap SOL for $AGP in the reward wallet first and keep the swap signature. Unallocated $AGP stays in the wallet.</span> : null}</label>
      <label>Reward wallet<select className={control} value={input.kind} onChange={(e) => change("kind", e.target.value as PayoutInput["kind"])}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
      <label>{input.kind === "daily" ? "Completed UTC day" : "Completed season (Monday UTC)"}<input type="date" className={control} value={input.period} onChange={(e) => change("period", e.target.value)} />{input.kind === "weekly" ? <span className="text-muted">Select the Monday that started the completed week.</span> : null}</label>
      {input.kind === "daily" ? <label>Through (optional, for a catch-up)<input type="date" className={control} value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setPlan(null); }} /><span className="text-muted">Pays every frozen day from the first date through this one at once, on each agent&apos;s summed score. Leave empty for one day.</span></label> : null}
      {funding === "held"
        ? <label>$AGP to pay out<input className={control} inputMode="decimal" value={budgetAgp} onChange={(e) => { setBudgetAgp(e.target.value); setPlan(null); }} placeholder="1000000" /><span className="text-muted">At most what the reward wallet holds; checked again before any transfer.</span></label>
        : <label>SOL budget (excluding network fees)<input className={control} inputMode="decimal" value={input.budgetSol} onChange={(e) => change("budgetSol", e.target.value)} placeholder="10" /></label>}
      <label>Minimum score<input className={control} inputMode="decimal" value={minScore} onChange={(e) => { setMinScore(e.target.value); setPlan(null); }} /><span className="text-muted">Winners scoring less are not paid. Only agents still in play are paid (an agent ends when its wallet sells to zero), and each wallet must hold $20 of its token now. Dropped shares are re-shared among the rest.</span></label>
      <label>Payout percentage<input className={control} inputMode="decimal" value={input.rewardPercent} onChange={(e) => change("rewardPercent", e.target.value)} /><span className="text-muted">The rest stays in this reward wallet for future payouts. The platform takes no cut.</span></label>
      {funding === "swap" ? <>
      <label>Maximum SOL per swap batch<input className={control} inputMode="decimal" value={input.batchSol} onChange={(e) => change("batchSol", e.target.value)} /></label>
      <label>Minimum delay between batches (seconds)<input type="number" min={30} className={control} value={input.delaySeconds} onChange={(e) => change("delaySeconds", Number(e.target.value))} /></label>
      <label>Maximum slippage (basis points)<input type="number" min={1} max={500} className={control} value={input.slippageBps} onChange={(e) => change("slippageBps", Number(e.target.value))} /><span className="text-muted">50 basis points = 0.5%. Batching cannot guarantee protection from bots.</span></label>
      </> : null}
    </div>
    {error ? <p className="mt-3 text-loss" role="alert">{error}</p> : null}
    <button disabled={busy} onClick={() => void act()} className="mt-4 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">{busy ? "Working…" : "Preview payout plan"}</button>
    {plan ? <div className="mt-4 border-t border-line pt-4">
      <p>{plan.kind} · {planPeriod(plan)} · {plan.status}</p>
      <p className="mt-2">{plan.funding === "held" ? "Paid to winners" : "Swap allocation"}: {amount(plan, plan.allocatedLamports)} · Retained in reward wallet: {amount(plan, plan.carryoverLamports)}</p>
      {plan.dropped?.length ? <details className="mt-2 text-muted"><summary>{plan.dropped.length} winning agents not paid ({(["agent ended", "holds under $20", "below minimum score", "reward wallet"] as const).map(reason => [reason, plan.dropped!.filter(d => d.reason === reason).length] as const).filter(([, n]) => n).map(([reason, n]) => `${n} ${reason}`).join(", ")}); their shares were re-shared.</summary>
        <ul className="mt-1">{plan.dropped.map(d => <li key={d.agentId} className="font-mono">{d.wallet.slice(0, 6)}…{d.wallet.slice(-4)} · score {Math.round(d.score)} · {d.reason}</li>)}</ul></details> : null}
      {BigInt(plan.platformLamports) > 0n ? <p className="mt-2 text-gold">This older plan includes a platform cut. Preview a new plan before approval.</p> : null}
      <p className="mt-2 text-muted">{plan.funding === "held" ? `Paid from the $AGP in the reward wallet, up to 8 winners per wallet approval (${Math.ceil(plan.winners.length / 8)} approvals). ` : `${plan.batchLamports.length} batches, waiting at least ${plan.delaySeconds} seconds between them. Final $AGP amounts depend on each confirmed swap. `}Each winner keeps the existing 10% cap; unallocated rewards remain in the reward wallet.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Winner</th><th>Token</th><th>Wallet</th><th>{plan.funding === "held" ? "$AGP" : "SOL allocation"}</th></tr></thead><tbody>{plan.winners.map((winner) => <tr key={winner.agentId} className="border-t border-line"><td className="py-2">{winner.name}</td><td className="font-mono">{winner.mint ? `${winner.mint.slice(0, 4)}…${winner.mint.slice(-4)}` : "-"}</td><td className="font-mono">{winner.wallet.slice(0, 6)}…{winner.wallet.slice(-4)} <CopyButton value={winner.wallet} label="Copy wallet" /></td><td>{amount(plan, winner.lamports)}</td></tr>)}</tbody></table></div>
      <button disabled={busy || !plan.agpMint || BigInt(plan.platformLamports) > 0n || plan.status === "approved"} onClick={() => void act(true)} className="mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">{plan.status === "approved" ? "Plan approved" : "Approve plan"}</button>
      {plan.status === "approved" && !execution ? <button disabled={busy || !overview?.executionConnected || (plan.funding !== "held" && !overview?.swapsConnected)} onClick={() => void execute("start")} className="ml-3 mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">Start wallet-approved payout</button> : null}
      {execution ? <div className="mt-4 border-t border-line pt-3">
        <p>{execution.status} · Batch {Math.min(execution.batch + 1, execution.batches.length)} of {execution.batches.length}</p>
        <p className="mt-2 break-all text-muted">Signing wallet: {plan.source}. Switch the selected wallet extension to this reward account; your admin session stays signed in.</p>
        <div className="mt-2"><CopyButton value={plan.source} label="Copy reward wallet" /></div>
        <label className="mt-2 block">Signing extension<select className={control} value={signer} onChange={e => setSigner(e.target.value as WalletName)}><option>Phantom</option><option>Solflare</option></select></label>
        {execution.error ? <p className="mt-2 text-loss">{execution.error}</p> : null}
        {execution.status === "running" ? <>
          <p className="mt-2 text-muted">{execution.nextAt > Date.now() ? `Next batch available after ${new Date(execution.nextAt).toLocaleTimeString()}.` : "Check progress and approve the next unsigned step. Pending transactions are checked before another payment is prepared."}</p>
          <button disabled={busy || execution.nextAt > Date.now()} onClick={() => void execute("prepare")} className="mt-3 rounded border border-line px-4 py-2 text-accent disabled:opacity-50">Check progress / approve next step</button>
          <button disabled={busy} onClick={() => void execute("pause")} className="ml-3 mt-3 rounded border border-line px-4 py-2">Pause</button>
        </> : execution.status === "paused" ? <button disabled={busy} onClick={() => void execute("resume")} className="mt-3 rounded border border-line px-4 py-2 text-accent">Resume saved payout</button> : <p className="mt-2 text-live">All batches and winner transfers confirmed.</p>}
        <div className="mt-3 space-y-2 text-muted">{execution.batches.map((batch, index) => <div key={index}>
          <p>{execution.batches.length > 1 ? `Batch ${index + 1}: ` : ""}{batch.completedAt ? "complete" : batch.output ? "distributing" : batch.swap?.signature ? "swap pending" : "awaiting wallet approval"}</p>
          {batch.swap?.signature ? <a target="_blank" rel="noreferrer" className="text-accent" href={`https://solscan.io/tx/${batch.swap.signature}`}>Swap transaction</a> : null}
          {batch.transfers.length ? <p>{batch.transfers.filter(t => t.confirmed).length} of {batch.transfers.length} transfer transactions paid ({batch.payments.filter(p => p.confirmed).length} of {batch.payments.length} winners)</p> : null}
          {batch.transfers.filter(t => t.tx?.signature).map((transfer, i) => <p key={transfer.tx!.signature}><a target="_blank" rel="noreferrer" className="text-accent" href={`https://solscan.io/tx/${transfer.tx!.signature}`}>Transfer {i + 1} · {transfer.payments.length} winners · {transfer.confirmed ? "paid" : "pending"}</a></p>)}
        </div>)}</div>
        {execution.failedAttempts?.length ? <div className="mt-3 text-muted"><p>Previous failed or expired attempts:</p>{execution.failedAttempts.map((attempt, index) => <p key={index}>{attempt.signature ? <a className="text-accent" href={`https://solscan.io/tx/${attempt.signature}`} target="_blank" rel="noreferrer">Batch {attempt.batch + 1} · {attempt.outcome}</a> : attempt.outcome}</p>)}</div> : null}
      </div> : null}
    </div> : null}
    {overview?.plans.length ? <div className="mt-4 border-t border-line pt-3"><h3>Payout plan history</h3>{overview.plans.map((item) => <button key={item.id} onClick={() => setPlan(item)} className="block w-full border-b border-line py-2 text-left text-muted">{item.kind} · {planPeriod(item)} · {item.status} · {amount(item, item.budgetLamports)} {item.funding === "held" ? "held" : "budget"}</button>)}</div> : null}
  </section>;
}
