import { PayoutStore } from "./payout-store";
import { ExecutionStore } from "./payout-execution-store";
import { planPeriod } from "./payout-plan";

export type PaidWinner = { name: string; wallet: string; amount: number; signature: string | null };
export type PaidPayout = {
  id: string; kind: "daily" | "weekly"; period: string; completed: boolean; at: string | null;
  total: number; winners: PaidWinner[]; signatures: string[];
};

/**
 * Every payout that has sent anything, newest first, from the payout records the admin panel keeps
 * (payout-store.ts, payout-execution-store.ts): only transfers confirmed on chain are counted, each
 * with the transaction that paid it. Drafts and approvals that never started are not payouts.
 */
export function payoutHistory(limit = 20, db?: PayoutStore["db"]): PaidPayout[] {
  try {
    const plans = db ? new PayoutStore(db) : new PayoutStore();
    const runs = new ExecutionStore(plans.db);
    const out: PaidPayout[] = [];
    for (const plan of plans.list()) {
      const run = runs.get(plan.id);
      if (!run) continue;
      const names = new Map(plan.winners.map((w) => [w.wallet, w.name]));
      const winners: PaidWinner[] = [];
      const signatures: string[] = [];
      for (const batch of run.batches) {
        for (const transfer of batch.transfers ?? []) {
          if (!transfer.confirmed) continue;
          const signature = transfer.tx?.signature ?? null;
          if (signature) signatures.push(signature);
          for (const i of transfer.payments) {
            const p = batch.payments[i]!;
            winners.push({ name: names.get(p.wallet) ?? p.wallet, wallet: p.wallet, amount: Number(p.amount) / 10 ** run.decimals, signature });
          }
        }
      }
      if (!winners.length) continue;
      out.push({ id: plan.id, kind: plan.kind, period: planPeriod(plan), completed: run.status === "completed", at: run.completedAt ?? run.startedAt,
        total: winners.reduce((sum, w) => sum + w.amount, 0), winners: winners.sort((a, b) => b.amount - a.amount), signatures });
    }
    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, limit);
  } catch {
    // No payout database on this host (a preview build, say): no history to show.
    return [];
  }
}
