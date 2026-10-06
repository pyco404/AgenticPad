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

## Wallet-approved execution

The executor prepares real mainnet swaps and winner transfers. **Approval records
a plan only.** Start the approved plan, then use **Check progress / approve next
step**. Each swap and each winner transfer needs a wallet transaction signature;
there are no server-held private keys. Choose Phantom or Solflare and switch that
extension to the source reward wallet. The admin session may remain on the
operator's wallet: admin authorization and the reward wallet's spending signature
are checked independently. An embedded wallet can sign only if it is itself the
source reward wallet.

Set these on Railway's **web** service, or `web/.env.local` locally:

- `PUMP_RPC_URL`: verified Solana mainnet RPC.
- `PUMP_DAILY_REWARDS_WALLET`, `PUMP_WEEKLY_REWARDS_WALLET`: actual signing-wallet addresses.
- `PAYOUT_AGP_MINT`: real mainnet $AGP mint; preview again after changing it.
- `JUPITER_API_KEY`: server-only key from Jupiter's developer portal.
- `PUMP_LAUNCH_DB_PATH`: SQLite file on one persistent volume, retaining launches and payout journals.
- `PAYOUT_EXECUTION_ENABLED=true`: enable preparation and confirmation processing.
- `PAYOUT_FEE_RESERVE_SOL=0.05`: minimum SOL beyond the payout budget for costs.
- `PAYOUT_MAX_TX_COST_SOL=0.01`: maximum extra SOL cost per simulated transaction.
- `PAYOUT_MAX_PRICE_IMPACT_BPS=200`: maximum absolute quoted price impact (2%).

Do not put reward-wallet keys in Railway or a `NEXT_PUBLIC_*` variable. The RPC,
mint and a viable liquid Jupiter route must be verified before real payments;
the automated tests use fake providers and do not send funds. The initial wallet
balance must cover the full budget plus reserve. Fees/rent consume that extra
reserve; they do not give the platform a share of retained rewards. Insufficient
funds pause the process. One unfinished payout reserves each source wallet, and
an approved period stays unique even after payment completes.

Standard SPL tokens and Token-2022 metadata extensions are supported. Transfer-fee,
transfer-hook and confidential-transfer mints are rejected rather than miscounting
recipient receipts. The worker checks finalized receipts every five seconds while
enabled. It may re-submit an already wallet-signed transaction, but it cannot
prepare or sign another payment without the operator using the dashboard.

The executor processes one batch at a time:

1. Confirm the approved source wallet, SOL budget and network-fee reserve.
2. Get a fresh SOL-to-$AGP quote only when the batch is ready. Enforce the
   approved spending, slippage and price-impact limits, or pause for review.
3. Submit through a managed/protected transaction path, not a public fallback.
4. Wait for finalized confirmation and measure actual $AGP received from the transaction's token-balance changes.
5. Distribute that batch to the snapshotted winners, with integer token amounts.
6. Confirm every transfer, persist its signature and wait at least the approved
   delay plus a randomized 0–15 seconds before the next swap.

Persist signed bytes and identifiers before submission. A timeout leaves a
batch pending; resume/check its original signatures rather than creating another
buy or payment. Never mark a swap or payout complete based only on a browser
assertion. A partial payout spends only the completed batches; all remaining
SOL stays in the reward wallet. There is no platform transfer from rewards.
Pause/resume retains signed bytes. Fresh transaction bytes are permitted only
after a finalized failure or finalized block-height expiry with no transaction
status. Expired unsigned wallet prompts can be refreshed without sending anything.
History retains failed attempt signatures. Confirmed transfer totals include
partial payouts exactly once. There is no fee-claim operation: payout sources
must already contain their accumulated SOL.

Batching limits individual order size and can reduce price impact, but does not
guarantee protection from front-running. Use conservative slippage, fresh quotes,
liquidity/price-impact checks and managed transaction submission together.
Jupiter's [Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute)
supports managed landing and swap confirmation. Its
[Swap API overview](https://developers.jup.ag/docs/swap)
describes the available routing and MEV protection. Those services and a liquid
mainnet $AGP market must be verified before enabling payments.
