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

## The verifiable build in CI (step 2)

`.github/workflows/verifiable-build.yml`, permanent: on every push to main that
touches `chain/`, and on demand, it runs `anchor build --verifiable` in
Anchor's pinned image and publishes the `.so`, its size, its file sha256 and
its **executable hash** as an artifact and in the run summary. A `program-v*`
tag also attaches them to a GitHub Release, which is what a mainnet deploy
should point at.

**First run, 2026-09-28 (run 36494678955): failed at "Build verifiably"
after 74 s**, with the Anchor CLI installed (6 min; cached only after a run
succeeds). The image it pulls, `solanafoundation/anchor:v0.32.1`, exists. The
job log needs a GitHub login to read, which the machine doing this does not
have, so the cause is not known yet. Open.

The executable hash is sha256 over the binary with trailing zero bytes
removed. Checked against devnet on 2026-09-28: the live program's data,
stripped the same way, hashes to exactly what the local build does
(`f728a51d…`), so this is the figure to compare a deployed program with.

## The stake mint (step 5)

Made 2026-09-28 by `scratch-tmp/rehearsal-mint.ts` (rehearsal only: pump.fun
makes the mainnet one), paid by the ops wallet (0.006 SOL):

| | |
|---|---|
| Mint | `HeGTBcvW5u15nxu5qTJSb9oYBUQDyQWocH4R3mg9vka7` |
| Token program | Token-2022 (`TokenzQd…`) |
| Extensions | MetadataPointer, TokenMetadata, as pump.fun's have |
| Decimals | 6 |
| Supply | 1,000,000,000 tokens, issued once, held by the ops wallet |
| Mint authority | none (revoked) |
| Freeze authority | none |

There is no faucet and no treasury key, as on mainnet: the two test wallets
are sent tokens from the ops wallet by hand.

## The settler key, never on a laptop (a mainnet blocker)

The plan says the settler lives "only as a secret on the mainnet api service
- never written to a laptop", and gives no way to get it there. This is the
procedure. The api reads the deposit settler from `CHAIN_SETTLER_SECRET_V2`,
a JSON byte array.

1. On the operator's machine, with the Railway CLI linked to the mainnet
   environment's api service, run one pipeline that makes the key in memory
   and hands it straight to Railway:

   ```bash
   node -e '
     const { Keypair } = require("@solana/web3.js");
     const k = Keypair.generate();
     process.stderr.write("settler " + k.publicKey.toBase58() + "\n");
     process.stdout.write(JSON.stringify(Array.from(k.secretKey)));
   ' | railway variables -s api --set-from-stdin CHAIN_SETTLER_SECRET_V2
   ```

   The secret goes through a pipe only: never to a file, the screen, the
   clipboard or shell history. Only the public key is printed, and that is
   what `initialize` (or `set_settler`) is given.
2. Read it back by name only (`railway variables -s api --json`, keys only),
   never the table, which prints values.
3. Fund the printed address from the ops wallet.

What this does **not** give: the key does pass through the operator
machine's memory for the length of one command. If "never on a laptop" has to
mean never in its memory either, the only way is for the server to make its
own key - the api generating a settler on first start, keeping it on a Railway
volume, and printing only the public key for the admin to install with
`set_settler`. That is a code change and a design decision, not something
this rehearsal can settle. *Decision needed before mainnet.*

To be run for real in the rehearsal environment and recorded here.

## What the plan gets wrong, or leaves out

Each of these was found by doing the step. None needs a new decision to fix
unless it says so.

1. **The verifiable build needs Docker, and the operator's machine has none.**
   `anchor build --verifiable` builds inside a pinned Docker image. Step 2
   assumes it just runs. Either Docker gets installed (root), or the build moves
   to CI, which has Docker and is a cleaner machine than a laptop anyway.
   *Decided 2026-09-28: CI* - see the section above.
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
5. **The settler's "never on a laptop" has no procedure.** A mainnet
   blocker; the procedure is above, with the one decision it leaves.
6. **`initialize` can be called by anyone, once. A mainnet blocker.** The
   `Initialize` accounts are a signer called `admin`, the config (created,
   so only once), the mint and the system program - nothing ties the caller
   to whoever deployed. The first transaction after the deploy decides the
   admin, the settler and the stake token for good; the mint check only asks
   for six decimals and no mint authority, which anyone can make. The plan
   has the deploy (step 7) and `initialize` (step 8) as separate steps with
   an authority move between them, which is exactly the window a watcher
   needs. On devnet today it does not matter, because the program is already
   initialised; on a fresh deploy it does. The fix is in the program: require
   the program's upgrade authority, read from its ProgramData account, to
   sign `initialize`. That is a program change, so it lands before the
   rehearsal deploy, so the rehearsal exercises the fixed flow.
   *Decision needed.*
7. **The api cannot run without the seed program.** `scripts/serve.ts` always
   builds a seed-program client when an RPC is set, falling back to
   `.keys/settler.json` when `CHAIN_SETTLER_SECRET` is absent - so a fresh host
   with neither crashes at start. And the chain worker, the drift watcher and
   the settler low-SOL watcher only start `if (chain && rpc)`, where `chain` is
   the *seed* client: an api with only a deposit program would settle nothing,
   watch nothing, and say nothing. Mainnet has no seed program. The seed client
   has to become optional and those three have to run on whichever programs
   are configured. Code, not a decision; missing from step 1.
8. **An empty database is seeded with a seed-program house roster.** On an
   empty `agents` table the api creates 24 house agents (`--roster`, default
   24) with the default funding, which is `seed`. On mainnet that is a roster
   on a program that is not there. Step 9 ("house agents need rows and
   nothing else") is right about what they need, but the server makes the
   wrong ones first. The start command should pass `--roster 0` and the
   deposit roster come from `scripts/seed-deposit-house.ts create`, or the
   default should follow the configured flow. Code; missing from step 1.
