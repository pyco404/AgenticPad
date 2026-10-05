import { describe, expect, it } from "vitest";
import { buildPayoutPlan, percentBps, type PayoutInput } from "../lib/payout-plan";
import { PayoutStore } from "../lib/payout-store";
import { LaunchStore } from "../lib/launchpad-store";

const settings: PayoutInput = { kind: "daily", period: "2026-10-04", budgetSol: "10", rewardPercent: "90", batchSol: "0.25", delaySeconds: 60, slippageBps: 50 };
const winners = Array.from({ length: 10 }, (_, index) => ({ agentId: `agent-${index}`, name: `Winner ${index}`, wallet: `wallet-${index}`, share: 0.1 }));
const plan = (input = settings, recipients = winners) => buildPayoutPlan(input, recipients, "daily", "platform", "admin");

describe("SOL reward payout planning (no swaps or payments)", () => {
  it("splits a 90% reward budget from a 10% SOL platform share and bounds every batch", () => {
    const result = plan();
    expect(result.allocatedLamports).toBe("9000000000");
    expect(result.platformLamports).toBe("1000000000");
    expect(result.carryoverLamports).toBe("0");
    expect(result.batchLamports).toHaveLength(36);
    expect(result.batchLamports.every((amount) => BigInt(amount) <= 250_000_000n)).toBe(true);
    expect(result.batchLamports.reduce((sum, amount) => sum + BigInt(amount), 0n)).toBe(9_000_000_000n);
    expect(result.approvedAt).toBeNull();
  });
  it("keeps capped rewards in the reward wallet instead of increasing the platform share", () => {
    const result = plan(settings, winners.slice(0, 1));
    expect(result.allocatedLamports).toBe("900000000");
    expect(result.platformLamports).toBe("1000000000");
    expect(result.carryoverLamports).toBe("8100000000");
  });
  it("preserves every lamport with decimal percentages and a final short batch", () => {
    const result = plan({ ...settings, budgetSol: "0.000000019", rewardPercent: "90.25", batchSol: "0.000000003" });
    const total = BigInt(result.allocatedLamports) + BigInt(result.platformLamports) + BigInt(result.carryoverLamports);
    expect(total).toBe(19n);
    expect(result.batchLamports.at(-1)).toBe("1");
  });
  it.each(["-1", "101", "NaN", "90.001", "0"])("rejects invalid percentages: %s", (value) => expect(() => percentBps(value)).toThrow());
  it("rejects repeated receiving wallets, excessive shares and unbounded batch counts", () => {
    expect(() => plan(settings, [winners[0]!, winners[0]!])).toThrow("only once");
    expect(() => plan(settings, [{ ...winners[0]!, share: 0.5 }])).toThrow("capped");
    expect(() => plan({ ...settings, batchSol: "0.000000001" })).toThrow("100 batches");
    expect(() => plan({ ...settings, delaySeconds: 0 })).toThrow("Wait");
    expect(() => plan({ ...settings, slippageBps: 1000 })).toThrow("Slippage");
  });
  it("stores immutable approval details and prevents a second approved plan for the same period", () => {
    const launches = new LaunchStore(":memory:");
    const store = new PayoutStore(launches.db);
    const first = plan(); const second = plan();
    store.insert(first); store.insert(second);
    const approved = store.approve(first.id, "operator");
    expect(approved.approvedBy).toBe("operator");
    expect(store.approve(first.id, "another-operator")).toEqual(approved);
    expect(() => store.approve(second.id, "operator")).toThrow("already approved");
    expect(store.get(second.id)?.status).toBe("draft");
    expect(store.list()).toHaveLength(2);
    launches.db.close();
  });
});
