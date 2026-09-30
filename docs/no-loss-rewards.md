# No-loss play

**Status: decided 2026-09-30, not built.** This replaces the staked model in [economy.md](economy.md) once it is built: matches stop moving money between players, and the prize pool becomes the only way to earn. Until then, economy.md describes what runs on devnet. Nothing here goes to mainnet before the legal review ([Legal](#legal)).

## In one paragraph

An owner rents an agent for a week ($2 of $CLASH, burned) and funds it with at least $20 of $CLASH. The agent then plays other players' agents at Bluff & Fold, and nothing it holds is ever at risk: a lost match costs nothing. Winners share the reward wallets, funded by the token's creator fees, by a score that multiplies what they won by the weight of a deposit they have kept in play. The owner can withdraw whenever the agent is not busy, which takes it out of the game and out of the rewards not yet paid.

## Decided

| # | Decision |
|---|---|
| 1 | **Nobody loses anything.** A lost match costs the owner nothing. The deposit is never staked. |
| 2 | **Rent: $2 of $CLASH, burned, for one week** - the season, Monday to Monday UTC, as built. |
| 3 | **Minimum funding: $20 of $CLASH**, up from $5. It is never spent; it is the owner's, and it is what the reward weight reads. |
| 4 | **One agent in play per wallet at a time**, as today. Retired agents do not count. |
| 5 | **One game: Bluff & Fold.** Mining was designed and dropped the same day ([Mining, dropped](#mining-dropped)). The other games on the games page stay in design. |
| 6 | **Rewards come only from the reward wallets**, funded by pump.fun creator fees, and are paid in $CLASH. The split stays as decided: 10% daily wallet, 50% weekly wallet, 40% platform, each payout releasing half its wallet ([economy.md](economy.md#creator-fees-and-prizes)). |
| 7 | **No lock.** The owner can withdraw whenever the agent is not busy, which means between matches: a match lasts seconds. |
| 8 | **Withdrawing everything, or below the $20 minimum, takes the agent out** of the game and out of every reward not yet paid. It can come back by funding again. |
| 9 | **To be in the rewards, the agent must be active** - playing by hand or on autoplay - and still in when the reward is paid. |
| 10 | **Latecomers take part.** An agent joins a reward period whenever it starts playing, and is paid for what it did in the time it had. |
| 11 | **A deposit counts only once it has been in play for a full day** (the counted deposit, below). This is what stops a large deposit arriving just before a payout from buying a large share. |

## The score

Each day, every qualifying agent gets a score, and the day's payout is shared in proportion to it; the weekly payout adds up the days ([Daily and weekly](#daily-and-weekly)):

    score  = points × weight
    weight = min(4, √(counted deposit ÷ $20))

- **Points** are what the agent won in the period: one per win against another player's agent.
- **Counted deposit** is the lowest balance the agent held over the last 24 hours in play. An agent in play for less than 24 hours - or topped up within them - counts at the $20 minimum for whatever it has not held a full day. A withdrawal and redeposit starts the day again.
- **The weight grows with the square root of the deposit and stops at ×4**, which $320 reaches. Four times the deposit is twice the weight, not four times, so money helps a winner without letting it outweigh winning.
- **No points, no reward**, however large the deposit.

Examples, one day:

| Agent | In play | Deposit | Wins | Counted as | Weight | Score |
|---|---|---|---|---|---|---|
| A | all day | $20 | 10 | $20 | ×1 | 10 |
| B | all day | $80 | 10 | $80 | ×2 | 20 |
| C | 12 hours | $20 | 6 | $20 | ×1 | 6 |
| D | last 2 hours | $20 | 3 | $20 | ×1 | 3 |
| E | last 2 hours | $2,000 | 3 | $20 | ×1 | 3 |
| F | all day, for days | $2,000 | 2 | $2,000 | ×4 (cap) | 8 |

E's money buys nothing on its first day; F's buys the cap, which any owner with $320 reaches too, and F still trails A for want of wins.

## Daily and weekly

Two payouts, from the two reward wallets, on the same score:

| | Daily | Weekly |
|---|---|---|
| **Wallet** | daily reward wallet, 10% of creator fees | weekly reward wallet, 50% of creator fees |
| **Paid** | every day, 00:00 UTC | at the season boundary, Monday 00:00 UTC |
| **Score** | that day's points × that day's weight | **the sum of the agent's daily scores across the season** |
| **To qualify** | 3 points that day | 20 points across the season |
| **Must be in** | at that day's payout | at the boundary |
| **Share cap** | 10% of the payout | 10% of the payout |

- **The weekly score adds up the days**, so each day's points carry the weight that day's counted deposit had. A latecomer's week is simply shorter; a large deposit that arrives mid-week counts from the day after, exactly as it does daily. No second formula to explain or to game.
- **An agent earns both.** A day's points count toward that day's payout and toward the week's; the two come from different wallets and never share a pool.
- **The weekly is the larger prize** - five times the daily wallet's share of fees - which is what makes staying in for the whole week worth more than dipping in for days.
- **Withdrawing out before the boundary forfeits the week**, as it forfeits any day not yet paid. Days already paid stay paid.
- **Each payout releases half its wallet**, as decided, so a quiet week still pays and neither wallet empties.

## Guards

- **Only wins against other players' agents score.** House agents are fixed presets whose weaknesses are exactly computable (`src/exact.ts`); a win over one measures nothing, as today.
- **Beating the same opponent scores once a day.** Losing is free, so a second wallet can hand out wins; this holds a puppet opponent to one point a day, at the cost of its $2 rent and a $20 deposit.
- **No agent takes more than 10% of a period's payout.** The backstop if anything not foreseen here lets one agent score far above the rest; what is left over stays in the wallet for the next period.
- **A minimum to qualify:** 3 points in a day, 20 in a season - the season figure is `MIN_RANKED_MATCHES_FOR_PRIZE` as built.
- **Anomaly detection stays**, flagging rather than pre-blocking ([economy.md](economy.md#anti-farming)).

## Mining, dropped

Mining - agents digging hills on the field for hours, for a find or nothing, scoring points as a win does - was designed on 2026-09-30 and dropped the same day: one game is enough for now. It would have let agents earn without an opponent in thin early weeks; against that, a dig partly decided by luck and paying $CLASH to renters was the hardest part of this design to defend ([Legal](#legal)), and the most to build. If it returns, the design was: the playbook decides which hill and when to dig deeper against a collapse, every dig is seeded and published like a match, and a find is worth points.

## What this replaces

In [economy.md](economy.md):

- **Funding and stakes.** Stakes are no longer zero-sum between two agents; nothing moves between players. The $5 minimum becomes $20.
- **Bands.** A band's scale set how much a match could move. With nothing staked, bands either go or become only a way to group opponents.
- **Autoplay's balance floor, loss budget and survival figures.** All exist because a balance could shrink; none applies when it cannot.
- **Placement's "net per chip staked".** Replaced by the score above.
- **"No pay-to-win: a larger balance must never help."** Reversed in part, on purpose: a larger deposit raises a winner's share, capped and only after a day in play. It still never makes an agent play better; the decision table decides every action.

In the program and [mainnet.md](mainnet.md):

- **Stays:** rent (burned), deposit, withdrawal, the non-custodial exit, the chip rate for converting dollar amounts, `set_admin`.
- **Unused once nothing is staked:** `settle` and `settle_net` between players' vaults, the clearing account, the per-agent loss budget, `max_settlement`, and the hourly outflow cap as the brake on a stolen settler key.
- **New:** paying rewards from the reward wallets to owners, and whatever records a period's scores so the payout can be checked against them.

This is a large change to the mainnet plan, and easier to make before the program is deployed and initialised than after.

## Legal

Real rewards for a paid rental, where chance plays a part, are what most places treat as gambling: payment, chance and a prize of value together. Two parts need the lawyer in particular, before either pays real $CLASH:

- **Bluff & Fold's prizes.** Each round's edges are drawn at random; the decision table is what argues for skill, and whether skill or chance mostly decides a match is the question.
- **A deposit that raises a share of token rewards**, which may read as an investment return.

This is [economy.md](economy.md#open-questions)'s open question 5, extended.

## Still open

1. **The payout curve** for each period, within the 10% cap: proportional to score, as above, or top places weighted.
2. **Early weeks.** Rewards need player opponents, and at launch there will be few: the pool pays a handful of agents until more arrive, and each payout releases only half its wallet, so nothing is wasted meanwhile.
3. **What happens to bands**, now that nothing is staked.
