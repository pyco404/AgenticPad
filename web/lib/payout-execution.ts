import type { PayoutPlan } from "./payout-plan";

export type PaymentTransaction = {
  prepared: string; signed: string | null; signature: string | null; lastValidBlockHeight: number;
  requestId?: string; minimumOutput?: string;
  outcome?: "failed" | "expired";
};
export type PayoutExecution = {
  planId: string; source: string; mint: string; decimals: number;
  status: "running" | "paused" | "completed";
  startedBy: string; startedAt: string; completedAt: string | null;
  error: string | null; nextAt: number; batch: number;
  failedAttempts?: { signature: string | null; outcome: "failed" | "expired"; batch: number; wallet: string | null }[];
  batches: {
    swap: PaymentTransaction | null; output: string | null;
    payments: { wallet: string; amount: string; tx: PaymentTransaction | null; confirmed: boolean }[];
    completedAt: string | null;
  }[];
};

export type TransactionResult = { status: "pending" | "confirmed" | "failed" | "expired"; output?: string };
export interface PayoutAdapter {
  validate(plan: PayoutPlan): Promise<{ decimals: number }>;
  prepareSwap(plan: PayoutPlan, lamports: string, remaining: string): Promise<PaymentTransaction>;
  prepareTransfer(plan: PayoutPlan, wallet: string, amount: string): Promise<PaymentTransaction>;
  inspect(plan: PayoutPlan, tx: PaymentTransaction, swap: boolean): Promise<TransactionResult>;
  submit(tx: PaymentTransaction, swap: boolean): Promise<void>;
}

/** Cumulative integer allocation conserves every output unit, even for tiny batches. */
export function splitOutput(output: string, winners: PayoutPlan["winners"]) {
  const total = winners.reduce((sum, w) => sum + BigInt(w.lamports), 0n);
  if (total <= 0n || BigInt(output) <= 0n) throw new Error("Invalid payout allocation.");
  let cumulative = 0n; let assigned = 0n;
  return winners.map((winner) => {
    cumulative += BigInt(winner.lamports);
    const end = BigInt(output) * cumulative / total;
    const amount = end - assigned; assigned = end;
    return { wallet: winner.wallet, amount: amount.toString(), tx: null, confirmed: amount === 0n };
  });
}

/** One durable step. Always persist signed bytes BEFORE any external submission. */
export async function advancePayout(plan: PayoutPlan, run: PayoutExecution, adapter: PayoutAdapter,
  save: (run: PayoutExecution) => void, now = Date.now(), jitter = () => Math.floor(Math.random() * 15_001), allowPrepare = false) {
  if (run.status !== "running" || now < run.nextAt) return;
  const batch = run.batches[run.batch];
  if (!batch) throw new Error("Invalid payout batch.");
  if (!batch.swap) {
    if (!allowPrepare) return;
    batch.swap = await adapter.prepareSwap(plan, plan.batchLamports[run.batch]!, plan.batchLamports.slice(run.batch).reduce((sum, n) => sum + BigInt(n), 0n).toString());
    save(run);
    return;
  }
  if (!batch.swap.signed) return;
  if (batch.output === null) {
    const result = await adapter.inspect(plan, batch.swap, true);
    if (result.status === "pending") { await adapter.submit(batch.swap, true); return; }
    if (result.status !== "confirmed") {
      batch.swap.outcome = result.status;
      (run.failedAttempts ??= []).push({ signature: batch.swap.signature, outcome: result.status, batch: run.batch, wallet: null });
      run.status = "paused"; run.error = "Swap failed or expired without confirmation. Review and resume to retry this batch.";
      save(run); return;
    }
    if (!result.output || BigInt(result.output) <= 0n) throw new Error("Confirmed swap output could not be verified.");
    batch.output = result.output; batch.payments = splitOutput(result.output, plan.winners); save(run); return;
  }
  const payment = batch.payments.find(p => !p.confirmed);
  if (payment) {
    if (!payment.tx) {
      if (!allowPrepare) return;
      payment.tx = await adapter.prepareTransfer(plan, payment.wallet, payment.amount);
      save(run); return;
    }
    if (!payment.tx.signed) return;
    const result = await adapter.inspect(plan, payment.tx, false);
    if (result.status === "pending") { await adapter.submit(payment.tx, false); return; }
    if (result.status !== "confirmed") {
      payment.tx.outcome = result.status;
      (run.failedAttempts ??= []).push({ signature: payment.tx.signature, outcome: result.status, batch: run.batch, wallet: payment.wallet });
      run.status = "paused"; run.error = "A transfer failed or expired. Review and resume; the confirmed swap will not be repeated.";
      save(run); return;
    }
    payment.confirmed = true; save(run); return;
  }
  batch.completedAt = new Date(now).toISOString();
  if (run.batch + 1 === run.batches.length) {
    run.status = "completed"; run.completedAt = new Date(now).toISOString();
  } else { run.batch++; run.nextAt = now + plan.delaySeconds * 1000 + jitter(); }
  save(run);
}

export function awaitingSignature(run: PayoutExecution) {
  const batch = run.batches[run.batch];
  if (!batch || run.status !== "running") return null;
  if (batch.output === null) return batch.swap && !batch.swap.signed ? { tx: batch.swap, swap: true } : null;
  const payment = batch.payments.find(p => !p.confirmed);
  return payment?.tx && !payment.tx.signed ? { tx: payment.tx, swap: false } : null;
}

/** Only proven on-chain failures/expiry may receive new transaction bytes. */
export function resumeExecution(run: PayoutExecution) {
  if (run.status === "completed") return;
  const batch = run.batches[run.batch]!;
  if (!batch.output && batch.swap?.outcome) batch.swap = null;
  for (const payment of batch.payments) if (!payment.confirmed && payment.tx?.outcome) payment.tx = null;
  run.status = "running"; run.error = null;
}

/** Signed bytes stay server-side; the admin sees progress and public signatures. */
export function executionView(run: PayoutExecution) {
  const publicTx = (tx: PaymentTransaction | null) => tx ? { signature: tx.signature, outcome: tx.outcome ?? null } : null;
  return { ...run, batches: run.batches.map(batch => ({ ...batch, swap: publicTx(batch.swap),
    payments: batch.payments.map(payment => ({ ...payment, tx: publicTx(payment.tx) })) })) };
}
export type PayoutExecutionView = ReturnType<typeof executionView>;
