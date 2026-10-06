import { randomUUID } from "node:crypto";
import { launchStore } from "./launchpad-store";
import { executionView, resumeExecution, type PayoutExecution } from "./payout-execution";

export class ExecutionStore {
  constructor(readonly db = launchStore().db) {
    db.exec(`CREATE TABLE IF NOT EXISTS payout_execution (
      plan_id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
      lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    ); CREATE UNIQUE INDEX IF NOT EXISTS payout_wallet_execution
      ON payout_execution(source) WHERE status <> 'completed';`);
  }
  get(id: string): PayoutExecution | null {
    const row = this.db.prepare("SELECT data FROM payout_execution WHERE plan_id = ?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  views() {
    return (this.db.prepare("SELECT data FROM payout_execution ORDER BY rowid DESC LIMIT 50").all() as { data: string }[])
      .map(row => executionView(JSON.parse(row.data)));
  }
  insert(run: PayoutExecution) {
    this.db.prepare("INSERT INTO payout_execution(plan_id, source, status, data) VALUES (?, ?, ?, ?)")
      .run(run.planId, run.source, run.status, JSON.stringify(run));
  }
  due() { return (this.db.prepare("SELECT plan_id FROM payout_execution WHERE status = 'running'").all() as { plan_id: string }[]).map(r => r.plan_id); }
  claim(id: string, now = Date.now()) {
    const owner = randomUUID();
    const result = this.db.prepare("UPDATE payout_execution SET lease_owner = ?, lease_until = ? WHERE plan_id = ? AND lease_until < ? AND status = 'running'")
      .run(owner, now + 300_000, id, now);
    return result.changes ? owner : null;
  }
  save(run: PayoutExecution, owner: string) {
    const result = this.db.prepare("UPDATE payout_execution SET status = ?, data = ? WHERE plan_id = ? AND lease_owner = ? AND lease_until > ?")
      .run(run.status, JSON.stringify(run), run.planId, owner, Date.now());
    if (!result.changes) throw new Error("Payout execution lease expired.");
  }
  release(id: string, owner: string) { this.db.prepare("UPDATE payout_execution SET lease_owner = NULL, lease_until = 0 WHERE plan_id = ? AND lease_owner = ?").run(id, owner); }
  control(id: string, action: "pause" | "resume") {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT lease_until FROM payout_execution WHERE plan_id = ?").get(id) as { lease_until: number } | undefined;
      if (!row) throw new Error("Payout execution not found.");
      if (row.lease_until > Date.now()) throw new Error("A batch step is in progress. Try again shortly.");
      const run = this.get(id)!;
      if (run.status !== "completed") {
        if (action === "resume") resumeExecution(run);
        else run.status = "paused";
        this.db.prepare("UPDATE payout_execution SET status = ?, data = ? WHERE plan_id = ?").run(run.status, JSON.stringify(run), id);
      }
      this.db.exec("COMMIT"); return executionView(run);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** All confirmed transfers, including partially finished payouts, exactly once. */
  paidUnits(mint: string): bigint {
    const rows = this.db.prepare("SELECT data FROM payout_execution").all() as { data: string }[];
    return rows.reduce((sum, row) => {
      const run = JSON.parse(row.data) as PayoutExecution;
      return run.mint !== mint ? sum : sum + run.batches.reduce((subtotal, batch) => subtotal + batch.payments.reduce((paid, p) => paid + (p.confirmed ? BigInt(p.amount) : 0n), 0n), 0n);
    }, 0n);
  }
  paidAgp(mint: string): number {
    const runs = (this.db.prepare("SELECT data FROM payout_execution").all() as { data: string }[])
      .map(row => JSON.parse(row.data) as PayoutExecution).filter(run => run.mint === mint);
    if (!runs.length) return 0;
    if (runs.some(run => run.decimals !== runs[0]!.decimals)) throw new Error("Payout mint decimals do not agree.");
    return Number(this.paidUnits(mint)) / 10 ** runs[0]!.decimals;
  }
}
