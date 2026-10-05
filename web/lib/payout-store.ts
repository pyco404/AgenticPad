import { launchStore } from "./launchpad-store";
import type { PayoutPlan } from "./payout-plan";

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
      if (plan.status !== "approved") {
        const existing = this.db.prepare("SELECT id FROM payout_plans WHERE kind = ? AND period = ? AND status = 'approved'").get(plan.kind, plan.period);
        if (existing) throw new Error("A payout is already approved for this period.");
        plan.status = "approved"; plan.approvedBy = owner; plan.approvedAt = new Date().toISOString();
        this.db.prepare("UPDATE payout_plans SET status = ?, data = ? WHERE id = ?").run(plan.status, JSON.stringify(plan), id);
      }
      this.db.exec("COMMIT");
      return plan;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
