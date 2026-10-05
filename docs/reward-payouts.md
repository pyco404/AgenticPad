# Reward payout batches

Decided 2026-10-05: accumulate creator fees as SOL in the daily and weekly
reward wallets. At payout, swap SOL into $AGP and distribute $AGP to
winners in small batches, instead of buying the whole pool at once.

The `/admin` dashboard now supports payout-plan previews, per-plan percentages,
approval records and history. Its API checks signed wallet sessions and the
backend's existing `ADMIN_WALLETS` permissions. Recipient wallets and shares
come from frozen game scores, never from an administrator's submitted list.
SQLite stores each plan and the approving wallet. Only one plan can be
approved per daily/weekly period; approving the same plan again is idempotent.

Set `ADMIN_WALLETS` in the backend's root `.env` to a comma-separated list of
operator public addresses, then restart the backend. It is intentionally empty
by default; the platform receiving address is not automatically made an admin.

The administrator selects a SOL budget, the percentage allocated to rewards,
the maximum SOL per batch, minimum delay and maximum slippage. Defaults shown
for review are 90% rewards, 0.25 SOL per batch, 60 seconds between batches,
and 50 basis points (0.5%) slippage. These are starting settings, not liquidity
estimates or promises that a trade will succeed.

For a 10 SOL budget at 80%, up to 8 SOL is allocated to winners and at least
2 SOL stays in the same reward wallet, accumulating alongside new fees for
future payouts. The platform takes no cut from reward wallets. The existing
10% per-winner cap still applies; capped or rounded allocations also stay in
the reward wallet. Rent, transaction costs and swap fees must be accounted for
separately. The Pump 15% daily / 50% weekly / 35% platform split is unchanged.
Older plans with a platform cut remain in history but cannot be approved;
preview a new plan using these rules.

## Execution still to connect

Approval currently records a plan only. **No swap, fee claim, SOL transfer or
$AGP payment is executed by this dashboard yet.** It labels this limitation
explicitly. Set `PAYOUT_AGP_MINT` to the real mainnet mint before approving a
plan; a plan records its mint and must be previewed again after a mint change.
`JUPITER_API_KEY` is reserved for the forthcoming server-side swap adapter.

The executor must process one batch at a time:

1. Confirm the approved source wallet, SOL budget and network-fee reserve.
2. Get a fresh SOL-to-$AGP quote only when the batch is ready. Enforce the
   approved spending, slippage and price-impact limits, or pause for review.
3. Submit through a managed/protected transaction path, not a public fallback.
4. Confirm the swap on chain and measure the actual $AGP received after fees.
5. Distribute that batch to the snapshotted winners, with integer token amounts.
6. Confirm transfers, persist their signatures and wait at least the approved
   delay plus a randomized interval before the next swap.

Persist signed bytes and identifiers before submission. A timeout leaves a
batch pending; resume/check its original signatures rather than creating another
buy or payment. Never mark a swap or payout complete based only on a browser
assertion. A partial payout spends only the completed batches; all remaining
SOL stays in the reward wallet. There is no platform transfer from rewards.

Batching limits individual order size and can reduce price impact, but does not
guarantee protection from front-running. Use conservative slippage, fresh quotes,
liquidity/price-impact checks and managed transaction submission together.
Jupiter's [Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute)
supports managed landing and swap confirmation. Its
[Swap API overview](https://developers.jup.ag/docs/swap)
describes the available routing and MEV protection. Those services and a liquid
mainnet $AGP market must be verified before enabling payments.
