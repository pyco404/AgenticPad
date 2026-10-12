import { launchStore } from "./launchpad-store";
import { planDays, planPeriod, type PayoutPlan } from "./payout-plan";

function decodePlan(data: string): PayoutPlan {
  const plan = JSON.parse(data) as PayoutPlan & { clashMint?: string | null };
  if (plan.agpMint === undefined) plan.agpMint = plan.clashMint ?? null;
  delete plan.clashMint;
  return plan;
}

export class PayoutStore {
  constructor(readonly db = launchStore().db) {
    db.exec(`CREATE TABLE IF NOT EXISTS payout_plans (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, period TEXT NOT NULL,
      status TEXT NOT NULL, data TEXT NOT NULL
    ); CREATE UNIQUE INDEX IF NOT EXISTS payout_approved_period
      ON payout_plans(kind, period) WHERE status = 'approved';`);
  }
  list(): PayoutPlan[] {
    return (this.db.prepare("SELECT data FROM payout_plans ORDER BY rowid DESC LIMIT 50").all() as { data: string }[]).map(({ data }) => decodePlan(data));
  }
  get(id: string): PayoutPlan | null {
    const row = this.db.prepare("SELECT data FROM payout_plans WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? decodePlan(row.data) : null;
  }
  insert(plan: PayoutPlan) {
    this.db.prepare("INSERT INTO payout_plans(id, kind, period, status, data) VALUES (?, ?, ?, ?, ?)").run(plan.id, plan.kind, plan.period, plan.status, JSON.stringify(plan));
  }
  approve(id: string, owner: string): PayoutPlan {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const plan = this.get(id);
      if (!plan) throw new Error("Payout plan not found.");
      if (BigInt(plan.platformLamports) !== 0n) throw new Error("This older plan includes a platform cut. Preview a new plan that retains unpaid SOL in the reward wallet.");
      if (plan.status === "cancelled") throw new Error("This plan was cancelled. Preview a new plan for these days.");
      if (plan.status !== "approved") {
        const existing = this.db.prepare("SELECT id FROM payout_plans WHERE kind = ? AND period = ? AND status = 'approved'").get(plan.kind, plan.period);
        if (existing) throw new Error("A payout is already approved for this period.");
        // A day is paid once: a catch-up and a single day's plan may not both cover it.
        if (plan.kind === "daily") {
          const days = new Set(planDays(plan));
          const approved = (this.db.prepare("SELECT data FROM payout_plans WHERE kind = 'daily' AND status = 'approved'").all() as { data: string }[]).map(({ data }) => decodePlan(data));
          const overlap = approved.find((other) => planDays(other).some((day) => days.has(day)));
          if (overlap) throw new Error(`A payout is already approved for ${planPeriod(overlap)}, which overlaps these days.`);
        }
        plan.status = "approved"; plan.approvedBy = owner; plan.approvedAt = new Date().toISOString();
        this.db.prepare("UPDATE payout_plans SET status = ?, data = ? WHERE id = ?").run(plan.status, JSON.stringify(plan), id);
      }
      this.db.exec("COMMIT");
      return plan;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /**
   * Withdraws an approval before anything was sent, freeing its days for another plan. Once a payout
   * has started, transfers may already be on chain: pause it instead.
   */
  cancel(id: string, owner: string): PayoutPlan {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const plan = this.get(id);
      if (!plan) throw new Error("Payout plan not found.");
      if (plan.status !== "approved") throw new Error("Only an approved plan can be cancelled.");
      const started = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payout_execution'").get()
        && this.db.prepare("SELECT plan_id FROM payout_execution WHERE plan_id = ?").get(id);
      if (started) throw new Error("This payout has already started, so it cannot be cancelled. Pause it instead.");
      plan.status = "cancelled"; plan.cancelledBy = owner; plan.cancelledAt = new Date().toISOString();
      this.db.prepare("UPDATE payout_plans SET status = ?, data = ? WHERE id = ?").run(plan.status, JSON.stringify(plan), id);
      this.db.exec("COMMIT");
      return plan;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** Removes a draft. Approved, cancelled and paid plans are the payout record and are never removed. */
  remove(id: string): void {
    const plan = this.get(id);
    if (!plan) throw new Error("Payout plan not found.");
    if (plan.status !== "draft") throw new Error("Only a draft can be deleted; approved and paid plans stay on record.");
    this.db.prepare("DELETE FROM payout_plans WHERE id = ? AND status = 'draft'").run(id);
  }
}
