import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Page } from "@/app/site-header";
import { API } from "@/lib/api";
import { explorer, readRewards, type Rewards } from "@/lib/rewards";
import { ScoreStanding } from "@/app/rewards/score-standing";
import { AgpCard } from "@/app/agp-card";

export const metadata: Metadata = {
  title: "Rewards — AgenticPad",
  description: "Where prize money comes from and where it goes, read from chain: $AGP's creator fees, and the daily and weekly payouts.",
  alternates: { canonical: "/rewards" },
};

// Chain reads are cached for a minute; there is nothing here worth hammering an
// RPC for. The prize standing asks for thirty seconds and wins, which is what
// we want: it moves with every match, and the reward wallet does not.
export const revalidate = 60;

type Activity = { stakedMatches: number; totalStaked: number; largestPot: number; exhibitions: number };

async function activity(): Promise<Activity | null> {
  try {
    const res = await fetch(`${API}/stats`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as { activity: Activity }).activity : null;
  } catch {
    return null;
  }
}

const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-4 py-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-mono text-[28px] leading-none text-gold">{value}</p>
      {sub ? <div className="mt-2.5 text-[12px] leading-5 text-muted">{sub}</div> : null}
    </div>
  );
}

function Address({ address, cluster }: { address: string | null; cluster: string }) {
  return address ? (
    <a href={explorer("address", address, cluster)} className="font-mono text-accent" target="_blank" rel="noreferrer">
      {short(address)}
    </a>
  ) : (
    <span>address set at launch</span>
  );
}

function RewardsSection({ r }: { r: Rewards }) {
  const claimed = r.reward.inflow + r.platform.inflow;
  const payouts = [...r.reward.payouts].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 20);
  return (
    <section className="rounded-panel border border-line">
      <div className="border-b border-line bg-panel px-4 py-3 @3xl:px-4">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">Rewards</h2>
      </div>
      <p className="border-b border-gold/50 bg-gold/5 px-4 py-3 text-[13px] leading-5 text-text @3xl:px-4">
        $AGP is live. Its pump.fun creator fees now flow into these wallets: 15% daily rewards, 50% weekly rewards,
        35% platform, locked at launch. Every figure here is read from chain.
      </p>
      {r.error ? (
        <p className="border-b border-line px-3 py-2 text-[12px] text-muted @3xl:px-4">
          The chain could not be read just now ({r.error}). Figures below may be incomplete.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 p-3 @lg:grid-cols-3 @3xl:p-4">
        <Tile
          label="Reward wallet"
          value={n(r.reward.balance)}
          sub={<Address address={r.reward.address} cluster={r.cluster} />}
        />
        <Tile
          label="Fees claimed to date"
          value={n(claimed)}
          sub={
            <>
              Reward wallet <span className="font-mono text-gold">{n(r.reward.inflow)}</span> · platform wallet{" "}
              <span className="font-mono text-gold">{n(r.platform.inflow)}</span>
              <br />
              Platform: <Address address={r.platform.address} cluster={r.cluster} />
            </>
          }
        />
        <Tile label="Paid out to date" value={n(r.reward.outflow)} sub="From the reward wallet to owners' wallets." />
      </div>

      <div className="border-t border-line">
        <h3 className="px-3 py-2 text-[12px] uppercase tracking-wider text-accent @3xl:px-4">Recent payouts</h3>
        {payouts.length === 0 ? (
          <p className="px-3 pb-3 text-[13px] text-muted @3xl:px-4">No payouts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr className="border-y border-line">
                  <th className="px-3 py-2 font-normal @3xl:px-4">Date</th>
                  <th className="px-3 py-2 font-normal">Rank</th>
                  <th className="px-3 py-2 font-normal">Agent</th>
                  <th className="px-3 py-2 font-normal">Owner wallet</th>
                  <th className="px-3 py-2 text-right font-normal">Amount</th>
                  <th className="px-3 py-2 font-normal @3xl:px-4">Tx</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.signature} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-[12px] @3xl:px-4">
                      {p.time ? new Date(p.time * 1000).toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{p.rank ?? "—"}</td>
                    <td className="px-3 py-2">
                      {p.agentId ? (
                        <Link href={`/a/${p.agentId}`} className="text-accent">
                          {p.agentId.slice(0, 8)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{p.to ? <Address address={p.to} cluster={r.cluster} /> : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-gold">{n(p.amount)}</td>
                    <td className="px-3 py-2 @3xl:px-4">
                      <a href={explorer("tx", p.signature, r.cluster)} className="text-accent" target="_blank" rel="noreferrer">
                        view
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-line p-3 text-[13px] leading-5 @3xl:p-4">
        <h3 className="text-[12px] uppercase tracking-wider text-accent">Prize schedule</h3>
        <p>
          Two payouts, from two wallets funded by the token&apos;s creator fees: daily, from the daily wallet (15% of
          fees), and weekly at the season boundary, from the weekly wallet (50%). Each releases half its wallet, so a
          quiet period still pays and neither wallet empties. Paid in $AGP bought at payout.
        </p>
        <p className="text-muted">
          Shares follow the score in the table above, in proportion, with no agent above 10%. Holding never wins a
          match &mdash; strategy alone decides those &mdash; it only weights what an agent&apos;s wins are worth.
        </p>
      </div>
    </section>
  );
}

function ActivitySection({ a }: { a: Activity | null }) {
  return (
    <section className="rounded-panel border border-line">
      <div className="border-b border-line bg-panel px-4 py-3 @3xl:px-4">
        <h2 className="text-[12px] uppercase tracking-wider text-accent">Match activity</h2>
      </div>
      {a === null ? (
        <p className="p-3 text-[13px] text-muted @3xl:p-4">Couldn&apos;t reach the server. Try again in a moment.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-3 @lg:grid-cols-2 @3xl:p-4">
          <Tile
            label="Matches played"
            value={n(a.stakedMatches)}
            sub={
              <>
                With a player&apos;s agent in them. Plus <span className="font-mono">{n(a.exhibitions)}</span> exhibitions
                between house agents.
              </>
            }
          />
          <Tile label="Largest single pot" value={n(a.largestPot)} sub="The most chips one match was won by." />
        </div>
      )}
      <p className="border-t border-line p-3 text-[13px] leading-5 text-muted @3xl:p-4">
        Matches move no money: a lost match costs nothing. Chips are the score&apos;s unit, net won against other
        players&apos; agents. Holding $AGP is the entry; nothing is staked, deposited or withdrawn.
      </p>
    </section>
  );
}

export default async function RewardsPage() {
  const [r, a] = await Promise.all([readRewards(), activity()]);
  return (
    <Page
      title="Rewards"
      intro="Where prize money comes from and where it goes. Everything in the first section reads from chain."
    >
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @5xl:items-start">
        <div className="flex flex-col gap-4">
          <ScoreStanding />
          <RewardsSection r={r} />
        </div>
        <div className="flex flex-col gap-3">
          <AgpCard />
          <ActivitySection a={a} />
          <p className="rounded-panel border border-dashed border-line p-3 text-[12px] leading-5 text-muted">
            Prizes come from trading fees, never from matches, which move no money. The tables above say who would be
            paid and what share; what a share is worth is set by what the reward wallets hold at each payout.
          </p>
        </div>
      </div>
    </Page>
  );
}
