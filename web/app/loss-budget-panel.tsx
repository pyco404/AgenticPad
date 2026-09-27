"use client";

import { useState } from "react";
import { api, ApiError, type LossBudgetView } from "@/lib/api";
import { useWallet } from "./wallet-context";

type Phase =
  | { at: "idle" }
  | { at: "preparing" | "signing" | "sending" }
  | { at: "done"; message: string }
  | { at: "error"; message: string };

const whole = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The owner's daily loss limit: the most this agent may lose, net, in one UTC
 * day. The settlement program enforces it, so it also bounds what anyone
 * holding the server's settlement key could take from this agent in a day.
 *
 * A raise applies at once. A cut applies from the next UTC day, because a
 * match already played today under the old limit must still be able to settle.
 */
export function LossBudgetPanel({
  agentId,
  budget,
  canChange,
  onChanged,
}: {
  agentId: string;
  budget: LossBudgetView | null | undefined;
  /** False for an agent rented before deposits, or a retired one. */
  canChange: boolean;
  onChanged: () => void;
}) {
  const { session, signTransaction } = useWallet();
  const token = session?.token ?? null;
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "idle" });

  if (!token || !canChange || budget === undefined) return null;

  const chips = Number(amount);
  const ok = amount !== "" && Number.isInteger(chips) && chips >= 0;
  const busy = phase.at === "preparing" || phase.at === "signing" || phase.at === "sending";
  const resets = budget ? new Date(budget.resetsAt).toISOString().slice(11, 16) : "";

  const send = async () => {
    setPhase({ at: "preparing" });
    try {
      const { lossBudget } = await api.prepareLossBudget(token, agentId, chips);
      setPhase({ at: "signing" });
      const signed = await signTransaction(lossBudget.transaction);
      setPhase({ at: "sending" });
      const { lossBudget: out } = await api.submitLossBudget(token, agentId, signed, lossBudget.lastValidBlockHeight);
      setAmount("");
      setPhase({
        at: "done",
        message:
          out.status !== "confirmed"
            ? "Sent, and not confirmed yet. The limit shown updates once it lands."
            : out.nextFromDay !== null
              ? `Lowered to ${whole(chips)} from tomorrow (UTC). Today keeps its current limit.`
              : `Set to ${whole(chips)} a day, from now.`,
      });
      onChanged();
    } catch (error) {
      setPhase({ at: "error", message: error instanceof ApiError ? error.message : (error as Error).message });
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-[12px] uppercase tracking-wider text-accent">Daily loss limit</h3>
      {budget ? (
        <p className="mt-2 text-[13px] leading-5">
          <span className="font-mono">{whole(budget.lostTodayChips > 0 ? budget.lostTodayChips : 0)}</span>
          <span className="text-muted"> of </span>
          <span className="font-mono">{whole(budget.perDayChips)}</span>
          <span className="text-muted"> lost today · resets {resets} UTC</span>
          {budget.nextPerDayChips !== null ? (
            <span className="block text-muted">
              From tomorrow: <span className="font-mono text-text">{whole(budget.nextPerDayChips)}</span> a day.
            </span>
          ) : null}
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-5 text-muted">No limit set: this agent was rented before limits existed.</p>
      )}
      <p className="mt-2 text-[12px] leading-5 text-muted">
        The most this agent can lose, net, in one day. It stops playing when it gets there. The settlement program
        enforces it, so it holds even against someone holding the server&apos;s key. Raising applies now; lowering
        applies from tomorrow.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          placeholder="chips"
          aria-label="Daily loss limit in chips"
          className="rounded-panel w-28 border border-line bg-panel-2 px-3 py-2 font-mono text-[13px]"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !ok}
          className="rounded-panel flex-1 border border-accent px-3 py-2 text-[13px] text-accent disabled:border-line disabled:text-muted"
        >
          {phase.at === "signing" ? "Waiting for your wallet…" : busy ? "Sending…" : "Set limit"}
        </button>
      </div>
      {phase.at === "done" ? <p className="mt-2 text-[12px] text-win">{phase.message}</p> : null}
      {phase.at === "error" ? <p className="mt-2 text-[12px] text-loss">{phase.message}</p> : null}
    </div>
  );
}
