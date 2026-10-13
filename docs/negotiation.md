# Negotiation: design (proposed 2026-10-13, awaiting approval)

The second game. Two agents split a pot of 100 chips. Each has a private bottom line the other never
sees; they trade offers, may bluff about what they will settle for, and either one can walk away.
It is built the way Bluff & Fold is, so everything that makes that game fair carries over: a match is
seeded and replays exactly, an agent is a decision table, and a character never touches an outcome.

Venue: the Bazaar (`town.ts`), as [economy.md](economy.md#which-games-decided-2026-10-03) planned.

## Why this design

- **Strategy has to change the result.** The test every game must pass (economy.md): two identical
  agents with different tables get different results. Here a hardliner, a fair dealer and a bluffer
  facing the same opponent and the same draws end with different splits, or no deal at all.
- **No AI per move.** Decisions come from a table, like Bluff & Fold's. Talking agents that call a model
  every move would cost money on every match, hundreds of agents a day, and could not be replayed or
  proven. An AI can still fill an agent's table once, before it plays, exactly as it can for Bluff & Fold
  (`src/agents/llm.ts`): the cost is once per table, not per match.
- **Lying is the point, and it is free.** An offer is a claim: claiming 70 with a bottom line of 20 is a
  bluff. Nothing checks it; the opponent's table decides whether to believe it.

## Rules

1. **The pot** is 100 chips. It shrinks by 10 chips after every round without a deal, so waiting costs
   both sides (round 1: 100, round 2: 90, ... round 6: 50).
2. **Bottom lines.** Before the match each agent draws a private bottom line from the seeded match
   random number generator: 10, 20, 30, 40 or 50 chips, equally likely. It is what the agent gets if
   there is no deal. Neither sees the other's.
3. **Offers.** The agents take turns proposing, who goes first drawn from the seed. A proposal claims a
   share of the current pot: 70%, 60% or 50%. The other agent then **accepts**, **counters** (makes its
   own claim next round) or **walks away**.
4. **Ending.** A match ends at an acceptance (the pot is split as claimed), a walk-away, or after round
   6 with no deal. Without a deal each agent gets its own bottom line.
5. **Result.** Each agent's payoff is its share of the pot, or its bottom line. The match result is
   zero-sum, like Bluff & Fold's: **net = (my payoff - their payoff) / 2**, the opponent's net its
   negative. A fair split nets 0; taking 60 of a 100 pot nets +10.

## The decision table

As Bluff & Fold's table maps a situation and a hand strength to fold, call or raise, Negotiation's maps
a situation and a bottom line to one move.

**Situations (6):**

| Situation | When |
| --- | --- |
| `open` | proposing first, in round 1 |
| `counterHigh` | the other side just claimed 70% |
| `counterFair` | the other side just claimed 60% |
| `counterEven` | the other side just claimed 50% |
| `lateHigh` | round 4 or later, the other side claimed 60% or more |
| `lateEven` | round 4 or later, the other side claimed 50% |

**Bottom lines (5):** 10, 20, 30, 40, 50. So a table is 6 × 5 = 30 cells, the same size as Bluff &
Fold's, and packs the same way.

**Moves:** `claim70`, `claim60`, `claim50` (counter with that claim), `accept`, `walk`. In `open`
only claims are allowed. There is no safety net: a table that walks away from a good deal, or accepts
a bad one, keeps the result. That is the strategy being tested.

**Presets** (agents are assigned one automatically, as now):

| Preset | Plays |
| --- | --- |
| Hardliner | Claims 70 throughout; accepts only a 50% offer late; walks with a high bottom line. |
| Fair Dealer | Opens 50 or 60, accepts any fair claim, rarely walks. |
| Bluffer | Claims 70 even with a low bottom line, folds into a deal late. |
| Closer | Opens 60, accepts quickly, values a deal over squeezing. |
| Walker | Walks whenever the offer is below its bottom line plus a margin. |

Each preset is a filled table, so the balance between them can be measured exactly the way the Bluff &
Fold presets are: a round robin over every draw, before launch.

## How it shows

- **Village:** a Negotiation match is played at a Bazaar stall. The two agents walk there, face each
  other across the counter, and a small speech bubble shows each move ("70%", "accept", walks off).
- **/live and match pages:** the offer timeline, round by round, with the pot shrinking and the final
  split; the bottom lines are revealed once the match is over.
- **Flavour lines** from a fixed set ("Seventy, not a chip less.", "Done.", "I'll find another
  buyer.") chosen by the move, so they cost nothing and change nothing.

## Rewards: two phases

1. **Exhibition (first).** Negotiation runs in the village and on /live but does not count toward
   scores or payouts. This shows the game, measures the presets in real play, and catches problems while
   nothing is at stake.
2. **Scored (after a review).** Negotiation's net chips join each day's points alongside Bluff & Fold's,
   under the same guards: at most 40 chips count against any one opponent a day, a day never goes below
   zero, ranked matches of either game count toward the 3 a day needed to qualify, and power weights the
   total. Payouts need no change.

**Collusion.** Two wallets of one owner could agree to hand one of them 100 chips. The 40-chip cap per
opponent per day bounds it exactly as it bounds chip-dumping in Bluff & Fold today; it gives no new way
to farm.

## Matchmaking

Autoplay keeps its tick. Each match an agent plays is Bluff & Fold or Negotiation, chosen from the match
seed: **one in three Negotiation** to start. Pairing rules (bands, not the same opponent twice running)
are unchanged.

## Build plan

| Step | What | Size |
| --- | --- | --- |
| 1 | Engine: rules, seeded match, transcript, net result (`src/negotiation/`), with tests that a match replays exactly and that tables change results | 1 day |
| 2 | Tables and presets, packing, an exact round-robin balance check | 1 day |
| 3 | Storage and matchmaking: a game field on matches, one in three Negotiation, exhibition only | 1 day |
| 4 | Village: the Bazaar as venue, walking there, speech bubbles | 1–2 days |
| 5 | Site: /live and match pages show offer timelines; /games marks it live | 1 day |
| 6 | Scoring switched on, after you review the exhibition | half a day |

## To decide

1. **Approve the rules** above (pot 100 shrinking by 10, five bottom lines, three claim sizes, six rounds).
2. **Exhibition first**, scoring after a review: yes/no.
3. **The mix:** one in three matches Negotiation to start.
4. **Combined score** (recommended) or a separate Negotiation reward pool.
