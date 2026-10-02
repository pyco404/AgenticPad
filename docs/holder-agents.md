# Holder agents

**Status: design, decided 2026-10-02, nothing built.** This replaces both the staked model in [economy.md](economy.md) and the no-loss model in [no-loss-rewards.md](no-loss-rewards.md). Until it is built, economy.md still describes what runs on devnet. Nothing here pays real $CLASH before the legal review ([Legal](#legal)).

## In one paragraph

Hold $CLASH in your own wallet above a dollar-pegged minimum and you have an agent. Nothing is rented, nothing is deposited, nothing is held for you, and there is nothing to withdraw. The agent plays Bluff & Fold against other holders' agents, with the default strategy or a brief its owner writes, and the strategy alone decides every match. What an owner's holding buys is a weight on the reward, not an edge at the table: each period's score is the net chips the agent won, times a capped weight derived from its **power** - mostly how long the wallet has held, and a little for how much it holds. Playing enough is a gate: an agent below the qualifying minimum of matches does not score at all.

## Decided

| # | Decision |
|---|---|
| 1 | **An agent is a wallet holding at least the minimum.** No rent, no deposit, no vault, no custody, no withdrawal, no exit page. The tokens never leave the owner's wallet. |
| 2 | **No rent.** There is nothing to rent: holding is the entry. It also removes a reason to charge someone before they have seen anything. |
| 3 | **The minimum is pegged in dollars**, retuned at the season boundary, the same shape as [the chip rate](economy.md#the-chip-rate). Not a percentage of market cap, which would move daily. |
| 4 | **Conviction follows the tokens, not the dollar line.** The token amount is recorded when a wallet first qualifies, and only a sell below that amount resets the clock. A price move, or a retune of the minimum, never costs someone their days ([Conviction](#conviction)). |
| 5 | **One game: Bluff & Fold, unchanged.** The default strategy, or a brief the owner writes. |
| 6 | **Power never affects a match.** Matches are decided by strategy alone. Power weights the reward and nothing else. |
| 7 | **Power = 85% conviction + 15% position** ([Power](#power)). Performance is not part of it: net chips appear once, in the score. Activity is not part of it either: autoplay puts every active agent near full activity, so it would be banked on day one. Playing enough is the qualifying gate instead - it decides whether an agent scores, not how much. |
| 8 | **Score = net chips won in the period × weight**, the weight derived from power and capped at ×4 ([Scoring](#scoring)). |
| 9 | **The no-loss model's guards all carry over**: the 40-chip cap per opponent per day, the floor at zero, house matches not scoring, and the qualifying minimums ([Guards](#guards)). |
| 10 | **Rewards are unchanged** ([Rewards](#rewards)). |
| 11 | **The village grows with the holder count.** Presentation only, no mechanics ([The village](#the-village)). |
| 12 | **No on-chain program.** Nothing is left for one to do. Payouts are plain token transfers from the reward wallets, the minimum's peg lives in the ledger, and strategy commitments are published as hashes in the season statement. Decided 2026-10-02; the build order is in [economy.md](economy.md#roadmap). |
| 13 | **Conviction runs on balance snapshots**, with the gap stated: a sell and rebuy between two snapshots is not seen. Indexing transfer history waits until someone has actually exploited that. Decided 2026-10-02. |

## Power

    power      = 0.85 × conviction + 0.15 × position

    conviction = min(180, days held) ÷ 180
    position   = min(1, √(share of supply ÷ 1%))

Each part runs from 0 to 1, so power does too.

- **Conviction is 85%.** It is the clock described below, as a fraction of its 180-day cap. It is the one part of power that cannot be bought on the day: it is earned only by holding.
- **Position is 15%.** The square root and the 1% reference mirror the no-loss weight: four times the holding is twice the position, and 1% of supply (10,000,000 of 1,000,000,000) reaches the cap. A wallet holding just the minimum scores close to nothing here - at $20 and a $1M market cap it holds 0.002% of supply, a position of 0.04 and 0.007 of power. Position is the most a large holding can buy, and it is under a sixth of power.
- **Activity is not in power.** An agent on autoplay plays nearly every match available to it, so a share of matches played would put every active agent near full marks from its first day, and it would mostly narrow the gap conviction is meant to open. How much an agent plays matters only as the qualifying minimum ([Guards](#guards)): below it, no score; above it, no bonus.
- **Power is about commitment, not results or effort.** How well the agent plays is measured once, by the net chips in its score; whether it played enough is the gate.

### Conviction

- **The clock starts when a wallet first qualifies**, and the token amount it holds at that moment is recorded as its **conviction amount**.
- **It runs while the wallet holds at least the conviction amount.** Selling below it sets the clock back to zero. Topping up never resets it, and never raises the conviction amount. Selling down to anything still at or above the conviction amount costs nothing.
- **The dollar line does not touch it.** If $CLASH falls and the minimum is retuned to more tokens, a wallet that has not sold keeps its clock. The minimum is what a new wallet must hold to qualify; once a wallet has qualified, its own recorded amount is what it must keep.
- **After a reset**, the next qualification records a new conviction amount at the minimum as it then stands.
- **At 180 days the clock stops growing.**

## Scoring

    score  = points × weight
    points = max(0, Σ over opponents of min(40, net chips won against that opponent))
    weight = 1 + 3 × power

- **Points are the net chips** the agent won across its ranked matches in the period, less what it lost, with the per-opponent cap and the floor described in [Guards](#guards).
- **The weight runs from ×1 to ×4.** ×4 is the cap the no-loss model chose, and it keeps the gap between the most and least committed agent the same as before. It is linear in power, so it is a sentence to explain.
- **No points, no reward**, whatever the power. Power multiplies winning and never stands in for it.
- **Daily and weekly** stay as the no-loss model has them ([no-loss-rewards.md](no-loss-rewards.md#daily-and-weekly)): a day's score pays from the daily wallet, and the season's score is the sum of its daily scores, each floored on its own and weighted by that day's power.

Examples, one day, each agent with +30 points (a minimum holding's position is taken as 0; it adds about 0.02 to the weight):

| Agent | Held for | Ranked matches | Holding | Power | Weight | Score |
|---|---|---|---|---|---|---|
| A | new today | qualified | minimum | 0.00 | ×1.00 | 30 |
| B | 30 days | qualified | minimum | 0.14 | ×1.43 | 43 |
| C | 90 days | qualified | minimum | 0.43 | ×2.28 | 68 |
| D | 180 days | qualified | minimum | 0.85 | ×3.55 | 107 |
| E | new today | qualified | 1% of supply | 0.15 | ×1.45 | 44 |
| F | 180 days | qualified | 1% of supply | 1.00 | ×4.00 (cap) | 120 |
| G | 180 days | below the minimum | minimum | 0.85 | - | not qualified |

**The spread is 3.55×** between a minimum holder of six months and one who arrived today (D against A), and 2.4× between that six-month holder and a whale who arrived today (D against E). A month's holding is worth about what 1% of supply buys on the day (B against E). G has the power but did not play enough, and scores nothing.

## Guards

All four carry over from [no-loss-rewards.md](no-loss-rewards.md#guards):

- **At most 40 chips against any one opponent a day.** Losing is free again, so feeding wins from a second wallet is back; this holds a puppet opponent to what one match against it could ever earn. Losses against it still count in full.
- **Points are floored at zero** each day. An agent can have a bad day, never a negative one.
- **Only matches against other holders' agents score.** House agents are fixed presets whose weaknesses are exactly computable (`src/exact.ts`); beating one measures nothing.
- **A minimum to qualify, in ranked matches:** 10 a day and 50 a season, set low at launch and raised as the roster grows, each value and each change recorded. This is the only place activity counts: it decides whether an agent scores, not how much.

**Anomaly detection stays**, flagging rather than pre-blocking ([economy.md](economy.md#anti-farming)).

## Rewards

Unchanged from [economy.md](economy.md#creator-fees-and-prizes):

- Funded by the token's creator fees: **10% to the daily reward wallet, 50% to the weekly reward wallet**.
- **Each cycle releases half its wallet's balance**, so a quiet period still pays and neither wallet empties.
- **No agent takes more than 10% of a cycle's payout.**
- **Paid in $CLASH bought at payout.**

## The village

The village grows as the holder count grows: house agents add structures and the land expands. It is presentation only - nothing in the village feeds power, scoring or any match.

## What this drops

Rent, deposits, vaults, custody, withdrawals, the non-custodial exit, `settle`, `settle_net`, the clearing account, the loss budget, `max_settlement`, the outflow cap, and bands.

Most of the program's surface goes with them. This is a large change to [mainnet.md](mainnet.md)'s plan, and, like the no-loss change before it, much easier to make before the program is deployed and initialised than after.

## Legal

A reward weighted by how long and how much someone holds a token may read as a return on holding it, which is a different question from whether Bluff & Fold is a game of skill. Both go to the lawyer before any real $CLASH is paid. This extends [economy.md](economy.md#open-questions)'s open question 5.

## Known properties

### Splitting pays, and the model cannot prevent it

A holder who splits a holding across K wallets, each above the minimum, gets K agents. The same tokens then earn more than one wallet holding them would. This is a property of the model, recorded so it is not mistaken for a bug still to be fixed. It was open question 2 until 2026-10-02.

**Why it pays.** A fix would need one wallet holding N tokens to score more than K wallets holding N/K each, and the model fails that in three places:

- **Position uses a square root**, so splitting raises total position: K wallets of N/K hold √K times the position of one wallet of N (ten wallets, about 3.2 times).
- **Conviction accrues per wallet.** Each wallet's clock runs on its own, so ten wallets at the minimum each reach ×3.55 after six months.
- **Each wallet earns its own points.** Ten wallets play ten sets of matches, so the base the weight multiplies is itself multiplied by K.

The third is why no fix exists inside the model. A different position curve could make concentration pay, and a conviction floor that rises the longer a wallet holds - in tokens, not dollars, as the conviction amount does, so a price move never costs anyone their days - could make splitting cost more tokens. But neither touches the points: whatever the weight does, K wallets that qualify earn K scores. And the floor alone would not have met the condition anyway, since a holder with enough tokens keeps every wallet above it.

**Why it cannot be capped.** A collective cap - agents split from one source sharing one 10% ceiling - needs to know which wallets are related, which is the detection this design cannot do. **The 10% share cap limits one agent, not a fleet.**

**What bounds it.** The pool is fixed. Each payout releases half its wallet, whoever is in it, so splitting creates no new payout: it redistributes the pool toward whoever splits, away from everyone else. The other bounds are per wallet, so they apply K times over without being defeated: every wallet must meet the qualifying minimum of ranked matches, and every wallet's points are capped at 40 chips against any one opponent a day.

## Open

1. **Moving between one's own wallets.** A transfer to a holder's own new wallet looks identical to a sell, and costs the clock unless something links the two. Conviction runs on snapshots for now (decision 13), which reads balances, not transfers, so nothing links them yet.
