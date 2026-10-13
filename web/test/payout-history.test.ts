import { describe, expect, it } from "vitest";
import { LaunchStore } from "../lib/launchpad-store";
import { PayoutStore } from "../lib/payout-store";
import { ExecutionStore } from "../lib/payout-execution-store";
import { buildHeldPayoutPlan } from "../lib/payout-plan";
import { payoutHistory } from "../lib/payout-history";

describe("public payout history", () => {
  it("lists only confirmed transfers, each winner with the transaction that paid them", () => {
    const launches = new LaunchStore(":memory:");
    const plans = new PayoutStore(launches.db); const runs = new ExecutionStore(launches.db);
    const winners = ["a", "b", "c"].map((w, i) => ({ agentId: w, name: `Agent ${w}`, wallet: `wallet-${w}`, share: [0.5, 0.3, 0.2][i]! }));
    const plan = { ...buildHeldPayoutPlan({ kind: "daily", period: "2026-10-09", budgetAgp: "1000", rewardPercent: "100" }, 6, winners, "daily", "platform", "admin", 10_000), periodEnd: "2026-10-11" };
    const draft = buildHeldPayoutPlan({ kind: "daily", period: "2026-10-12", budgetAgp: "1", rewardPercent: "100" }, 6, winners, "daily", "platform", "admin", 10_000);
    plans.insert(plan); plans.insert(draft); plans.approve(plan.id, "admin");
    const tx = (signature: string) => ({ prepared: "p", signed: "s", signature, lastValidBlockHeight: 1 });
    runs.insert({ planId: plan.id, source: "daily", mint: "m", decimals: 6, status: "running", startedBy: "admin", startedAt: "2026-10-12T09:39:00Z", completedAt: null,
      error: null, nextAt: 0, batch: 0, batches: [{ swap: null, output: "1000000000", completedAt: null,
        payments: [{ wallet: "wallet-a", amount: "500000000", confirmed: true }, { wallet: "wallet-b", amount: "300000000", confirmed: true }, { wallet: "wallet-c", amount: "200000000", confirmed: false }],
        transfers: [{ payments: [0, 1], tx: tx("first"), confirmed: true }, { payments: [2], tx: tx("second"), confirmed: false }] }] });
    const [paid, ...rest] = payoutHistory(20, launches.db);
    expect(rest).toEqual([]); // the draft paid nothing
    expect(paid).toMatchObject({ kind: "daily", period: "2026-10-09 to 2026-10-11", completed: false, total: 800, signatures: ["first"] });
    expect(paid!.winners).toEqual([
      { name: "Agent a", wallet: "wallet-a", amount: 500, signature: "first" },
      { name: "Agent b", wallet: "wallet-b", amount: 300, signature: "first" },
    ]);
    launches.db.close();
  });
});
