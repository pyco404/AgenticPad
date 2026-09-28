# Mainnet rehearsal on devnet

A run-through of [mainnet.md](mainnet.md) steps 3–9 on devnet, with a fresh
program under a fresh ID and a Token-2022 stake mint. It is done the way mainnet
will be, so that what the plan leaves out shows up here and not on the day.
It is also where the two-wallet proof runs: the first deposit-program
settlement, carried by a Token-2022 transfer.

Written as it happened, starting 2026-09-28. **Status: in progress.**

## Keys (step 3)

Generated 2026-09-28 into `.keys/rehearsal/` (gitignored), one per mainnet role:

| Role | Address | On mainnet | Here |
|---|---|---|---|
| Program keypair | `9m4i1EM9DkfP4XW7xS5j5pVMjQuW9339uNKmmXSLnatB` | clean machine, private until the deploy | a file |
| Deploy key | `k9FLvGS1YvSGTkBtMh8B8Lap9zf6wHh9jjZURDp71Tk` | throwaway, emptied after | a file |
| Upgrade authority | `BBKXxPKii9kWRPwr9zgJ6hhSyi3S99tRDWDC8LRvhqdP` | hardware wallet | a file standing in |
| Config admin | `9mLJciw8ESHAjCiDzMvMf3X3VU42GXe14KyaGZvixubv` | second hardware wallet | a file standing in |
| Ops wallet | `DPFA8BMcFP6ugf89xpSQEv8epLzXJGz833cxKrYkfkbZ` | hardware wallet | a file standing in |
| Stake mint | `HeGTBcvW5u15nxu5qTJSb9oYBUQDyQWocH4R3mg9vka7` | made by pump.fun | made here, Token-2022 |
| Settler | not yet | a secret on the api service, never on a laptop | generated when its environment exists |

## The build (step 2, not yet verifiable)

`declare_id!` and `Anchor.toml` changed to `9m4i1EM9…` in a separate worktree,
then an ordinary `anchor build`: 2 min 49 s from cold, **709,632 bytes**, the
same length as the devnet build (the ID changes the bytes, not the size). The
IDL comes out with the new address.

Sizing, until the verifiable build exists to confirm it: 709,632 plus one more
change of netting's size (about 73 KB) is about 784 KB, so **800,000 bytes**,
the same as devnet now. On mainnet that is about 4.065 SOL of rent, **about
0.508 SOL more** than the 700,000 bytes in mainnet.md.

## What the plan gets wrong, or leaves out

Each of these was found by doing the step. None needs a new decision to fix
unless it says so.

1. **The verifiable build needs Docker, and the operator's machine has none.**
   `anchor build --verifiable` builds inside a pinned Docker image. Step 2
   assumes it just runs. Either Docker gets installed (root), or the build moves
   to CI, which has Docker and is a cleaner machine than a laptop anyway.
   *Decision needed.*
2. **The program ID is compiled in, in five places.** `declare_id!` in lib.rs,
   `Anchor.toml` twice, the IDL the api reads its address from, and the exit
   page twice (`exit.mjs` and the copy inlined in `index.html`). "A fresh
   program ID" is a code change and a separate build, not a deploy flag, and
   the devnet and mainnet builds differ in their bytecode. Step 1.7 (the mainnet
   exit page) is part of the same change.
3. **One api serves one deposit program.** The address comes from the IDL
   compiled into the server, so a second program needs a second api, database
   and web: step 4 cannot be skipped even for a rehearsal.
4. **Devnet SOL is a manual step.** The deploy needs about 7.7 SOL on hand at
   once (program account at 800,000 bytes plus the buffer). `solana airdrop`
   is rate-limited at every size, so it comes from faucet.solana.com by hand
   or from an existing wallet.
5. **The settler's "never on a laptop" has no procedure.** Railway variables
   are set from the CLI, so the key has to be made somewhere and passed in.
   Generating it in memory and piping it straight into
   `railway variables --set-from-stdin` keeps it off disk. The plan should say
   so, or someone will write it to a file first.
