# On-chain replay with oracle randomness: what it would have cost

Measured on 2026-09-27, so that "why didn't you make the chain decide matches?"
has numbers behind its answer. This was never a decision point: the ledger
staying authoritative was decided first (see [security.md](security.md),
limitation 1), because a design in which the chain decides results stops *play*
whenever an oracle or RPC is unreachable - and the 28-hour Helius outage of
2026-09-23 would have stopped play, not just settlement.

The alternative measured: the program stores both agents' tables (it does now,
`commit_strategy`), an oracle supplies each match's randomness, and the program
replays the match itself and moves the money. A stolen settler key could then
choose pairings but not results.

The code that produced these numbers is in [`spikes/oracle/`](../spikes/oracle/),
kept out of the app's dependencies.

## The replay fits the compute budget with room to spare

The match engine ported to Rust in integer arithmetic (mulberry32 on the raw
32-bit word; the weighted coin as `roll × 100 < k × 2³²`), run as a Solana
program on a local validator:

| | Compute units |
|---|---|
| Replaying one match | 494 - 865, median 655 (300 matches) |
| The whole instruction, entry and logging included | 1,639 - 2,028 |
| One settlement today, for comparison | 21,365 - 27,366 |
| Default budget per instruction | 200,000 |

The port reproduces the TypeScript engine exactly: identical nets and round
counts on 20,000 generated matches (presets and random tables, random seeds),
and the 300 replayed on chain matched too. Compute is not the obstacle.

## Randomness: seconds per match, and someone still chooses whether it lands

Both measured live on devnet with a throwaway key, ten draws each.

| | ORAO VRF | Switchboard On-Demand |
|---|---|---|
| Latency, request to usable randomness | median **3.7 s** (2.4 - 23.4 s) | median **10.8 s** (8.4 - 18.0 s) |
| of which: request lands | 1.9 s | commit lands 5.4 s |
| of which: oracle | 1.6 s (0.7 - 21.4 s) | gateway releases value 4.0 s, reveal lands 1.4 s |
| Transactions per match | 1 request, then ours to use it | commit, then reveal |
| Cost per match | **0.00165 SOL**: 0.0003 fee, 0.000005 tx fee, ~0.00135 rent for a randomness account the SDK offers no way to close | **0.00001 SOL** (two tx fees; no oracle fee on devnet), plus 0.006 SOL once for a reusable account |
| Compute of the oracle's own instructions | request 16.7k - 22.7k | commit ~15.3k, reveal ~42.1k |

For scale: at the ten-minute autoplay pace one agent plays 144 matches a day,
so ORAO would add about 0.24 SOL per agent per day on top of today's per-match
settlement rent. Devnet prices; mainnet's may differ.

**Who decides whether a result lands** - the property that matters, because a
party who sees the outcome first and chooses whether to submit it settles its
wins and drops its losses:

- **Switchboard**: the reveal is built from a signature fetched from the
  oracle's gateway *off chain*, so whoever reveals sees the value before
  submitting. Withholding is built in.
- **ORAO VRF** (`@orao-network/solana-vrf` 0.8.0): the randomness lands in an
  account and a separate transaction must use it. The same problem.
- **ORAO Callback VRF** (`@orao-network/solana-vrf-cb` 0.4.0, program
  `VRFCBePmGTpZ234BhbzNNzmyg39Rgdd6VgdfhHwKypU`, same 0.0003 SOL fee): the
  oracle's fulfilment calls the client program, so the replay and settlement
  would happen in the oracle's transaction and nobody could hold one back.
  Except: its configuration carries a `callback_deadline` of 9,000 slots (about
  an hour), after which "the request will be fulfilled without callback
  invocation" - a callback that fails, a settlement the program refuses for
  instance, leaves randomness in an account for someone to choose to use. It
  narrows the gap; it does not close it. Not exercised end to end here: that
  needs a registered client program.

## So

On-chain replay is feasible - the compute is trivial and the engine ports
exactly - and it is the only design in which a stolen key cannot fabricate a
result. Its costs are the ones it was set aside for: every match waits seconds
(median 3.7 - 10.8 s, tails past 20 s) on a third party before it has a result,
play depends on that party and an RPC being up, and the one variant that stops
a result being withheld still has an escape hatch after an hour.
