# No-loss play and mining

**Status: decided 2026-09-30, not built.** This replaces the staked model in [economy.md](economy.md) once it is built: matches stop moving money between players, and the prize pool becomes the only way to earn. Until then, economy.md describes what runs on devnet. Nothing here goes to mainnet before the legal review ([Legal](#legal)).

## In one paragraph

An owner rents an agent for a week ($2 of $CLASH, burned) and funds it with at least $20 of $CLASH. The agent then plays other players' agents or mines hills on the field - the system decides which - and nothing it holds is ever at risk: a lost match or an empty dig costs nothing. Winners share the reward wallets, funded by the token's creator fees, by a score that multiplies what they won by the weight of a deposit they have kept in play. The owner can withdraw whenever the agent is not busy, which takes it out of the game and out of the rewards not yet paid.

## Decided

| # | Decision |
|---|---|
| 1 | **Nobody loses anything.** A lost match or a dig that finds nothing costs the owner nothing. The deposit is never staked. |
| 2 | **Rent: $2 of $CLASH, burned, for one week** - the season, Monday to Monday UTC, as built. |
| 3 | **Minimum funding: $20 of $CLASH**, up from $5. It is never spent; it is the owner's, and it is what the reward weight reads. |
| 4 | **One agent in play per wallet at a time**, as today. Retired agents do not count. |
| 5 | **Two activities, play and mine; the owner picks play, mine or anything.** With anything, the system decides which the agent does at each moment - play when a player opponent is free, mine when not. An agent is always doing one or the other. |
| 6 | **Rewards come only from the reward wallets**, funded by pump.fun creator fees, and are paid in $CLASH. The split stays as decided: 10% daily wallet, 50% weekly wallet, 40% platform, each payout releasing half its wallet ([economy.md](economy.md#creator-fees-and-prizes)). |
| 7 | **No lock.** The owner can withdraw whenever the agent is not busy: between matches, which last seconds, or by stopping a dig, which then finds nothing. |
| 8 | **Withdrawing everything, or below the $20 minimum, takes the agent out** of the game and out of every reward not yet paid. It can come back by funding again. |
| 9 | **To be in the rewards, the agent must be active** - playing by hand or on autoplay - and still in when the reward is paid. |
| 10 | **Latecomers take part.** An agent joins a reward period whenever it starts playing, and is paid for what it did in the time it had. |
| 11 | **A deposit counts only once it has been in play for a full day** (the counted deposit, below). This is what stops a large deposit arriving just before a payout from buying a large share. |
| 12 | **Mining can pay $CLASH.** This is the operator's decision, recorded against the legal caution in [Legal](#legal). |

## The score

Each reward period - a day for the daily wallet, the season for the weekly one - every qualifying agent gets a score, and the period's payout is shared in proportion to score:

    score  = points × weight
    weight = min(4, √(counted deposit ÷ $20))

- **Points** are what the agent won in the period: one per win against another player's agent, and a set number per mining find ([Mining](#mining)).
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

## Guards

- **Only wins against other players' agents score.** House agents are fixed presets whose weaknesses are exactly computable (`src/exact.ts`); a win over one measures nothing, as today.
- **Beating the same opponent scores once a day.** Losing is free, so a second wallet can hand out wins; this holds a puppet opponent to one point a day, at the cost of its $2 rent and a $20 deposit.
- **No agent takes more than 10% of a period's payout.** The backstop if anything not foreseen here lets one agent score far above the rest; what is left over stays in the wallet for the next period.
- **A minimum to qualify:** 3 points in a day, 20 in a season - the season figure is `MIN_RANKED_MATCHES_FOR_PRIZE` as built.
- **Anomaly detection stays**, flagging rather than pre-blocking ([economy.md](economy.md#anti-farming)).

## Mining

Design to settle; nothing is built.

- **Hills on the field**, which agents walk to and dig. A dig takes hours and ends in a find or in nothing; hills shrink as they are dug and are replaced.
- **The agent's playbook decides how it mines** - which hill, and when to dig deeper against the risk of a collapse that loses the haul - so a careful agent and a greedy one mine differently. This is what keeps mining from being a draw decided by luck alone, and it matters for [Legal](#legal).
- **Every dig is seeded and published**, like a match: the same seed and the same playbook give the same result, and anyone can check it.
- **A find is worth points**, larger finds more, so play and mining feed one score and one pool. How many points a find is worth against a win is the lever that keeps the arena from emptying into the hills, or the reverse, and it is still to set.
- **Stopping a dig to withdraw ends it with nothing.**

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

- **Mining for $CLASH**, where a dig's outcome is partly luck. The playbook's choices are what argue for skill; whether they argue enough is the question.
- **A deposit that raises a share of token rewards**, which may read as an investment return.

This is [economy.md](economy.md#open-questions)'s open question 5, extended.

## Still open

1. **Mining in detail:** dig length, find sizes, what a find is worth in points against a win, how hills are replaced.
2. **The payout curve** for each period, within the 10% cap: proportional to score, as above, or top places weighted.
3. **Early weeks.** Rewards need player opponents, and at launch there will be few; mining is the part that earns without them.
4. **What happens to bands**, now that nothing is staked.
5. **"Busy"** precisely: a match in flight, and a dig until it is stopped - and what the exit page does to an agent mid-dig.
