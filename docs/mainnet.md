# Mainnet deploy plan

**Status: planned, not started.** Nothing here is deployed to mainnet. This is the order it happens in, what it costs, what cannot be taken back, and what is decided. It sits beside [economy.md](economy.md), which says what the game's money does, and [security.md](security.md), which says what protects it.

## Decided

| # | Decision |
|---|---|
| 1 | **The chip rate is held until $OX has a real price.** The peg stands (900 chips ≈ $5, [economy.md](economy.md#the-chip-rate)); the number waits for the market. Before launch the program gets the decided rate rule — raise freely, lower by at most half per step — so a wrong launch rate is a few transactions to correct, not weeks of ±50% every six days. |
| 2 | **A fresh program ID from a freshly generated keypair.** The devnet program's keypair has been on a laptop for weeks. |
| 3 | **The upgrade authority lives on a hardware wallet, separate from the config admin**, and the program gets **`set_admin`**, so a lost admin key — the key that sets the chip rate every week — is recoverable rather than permanent. |
| 4 | **Hourly net settlement**, as already decided in [economy.md](economy.md#decided), instead of one on-chain settlement per match. |
| 5 | **House agents need no balance.** They never stake, so they need no vault money to be offered as opponents. This removes the treasury key from mainnet and about $270 of $OX that would have sat locked in house vaults. |
| 6 | **No audit before mainnet, for now. This is the operator's decision**, recorded as such: [security.md](security.md) limitation 9 still stands, and so does the residual risk it describes. |
| 7 | **oxude.xyz becomes mainnet.** Devnet moves to a subdomain and stays for testing. |
| 8 | **Helius, paid tier,** as the mainnet RPC. The 28-hour settlement outage of 2026-09-23 was the free endpoint. |
| 9 | **Economics confirmed:** $5 minimum deposit (900 chips), $2 rent, a per-match limit of 60 chips (band C's worst match), and a default loss budget of a third of the deposit per day. |

## Keys

Every mainnet key is freshly generated. None of the devnet keys are reused: the admin, settler and treasury keys have been on a laptop, and two of them in Railway variables.

| Key | What it can do | Where it lives |
|---|---|---|
| **Program keypair** | Nothing but fix the program's address, once, at deploy. | Generated on a clean machine and kept private until the deploy — anyone holding it could deploy to that address first. Powerless afterwards. |
| **Deploy key** | Pays for and signs the deploy's ~600 buffer writes, which a hardware wallet cannot practically sign. | A throwaway on the deploy machine. The upgrade authority moves to the hardware wallet straight after, and this key is emptied. |
| **Upgrade authority** | Replace the program's code — and so take everything ([security.md](security.md) limitation 2). | A hardware wallet, used only for upgrades. |
| **Config admin** | Set the chip rate weekly, the rent, the per-match limit and the exit window; rotate the settler; hand itself on, in two steps (propose, then the new key accepts). | A second hardware wallet, used weekly, with a tested seed backup. |
| **Settler** | Settle within the outflow cap and the owners' loss budgets, co-sign withdrawals, and pay every fee and account rent. | Hot, but only as a secret on the mainnet api service — never written to a laptop. Holds a small SOL float, topped up from the ops wallet. The admin can rotate it. |
| **Ops wallet** | Hold the SOL that funds the deploy and tops up the settler. | A hardware wallet. |

No treasury key: with decision 5, mainnet has nothing for one to fund, and there is no faucet on mainnet.

The daily and weekly reward wallets and the platform wallet ([economy.md](economy.md#creator-fees-and-prizes)) are pump.fun fee destinations, not program keys.

## Steps, in order

1. **Code, before anything touches mainnet**, each tested on devnet:
   1. ~~Token-2022 support~~ — built and on devnet (2026-09-28). The chain suite runs in full against both token programs.
   2. ~~The chip-rate rule: raise freely, lower by at most half per step~~ — built (2026-09-28), not yet on devnet.
   3. ~~`set_admin`~~ — built as a two-step handover (2026-09-28), not yet on devnet: the admin proposes (`propose_admin`) and the new key accepts by signing (`accept_admin`), so a mistyped address can never become the admin.
   4. Hourly net settlement, and the per-agent per-period limit it needs in place of the per-match one ([economy.md](economy.md#open-questions), question 4).
   5. ~~House agents with no balance~~ — built (2026-09-28): matchmaking, exhibitions and retirement ask nothing of a house agent's balance.
   6. The chip rate throughout the server: much of it still assumes the devnet rate, and the season-boundary hook that would set the new rate does nothing yet.
   7. A mainnet exit page: the mainnet program ID and a mainnet RPC as its defaults.
2. **Build verifiably** (`anchor build --verifiable`), so anyone can check the deployed bytecode against the source.
3. **Generate the keys** as above. Fund the ops wallet; fund the deploy key and the settler from it.
4. **A separate mainnet environment:** its own database (the current one is devnet agents and balances), api and web; Helius paid; the mainnet cluster, RPC and $OX mint; deposit funding only; the faucet off. Devnet moves to its subdomain.
5. **Mint $OX** on pump.fun, and confirm its token program (Token-2022 expected) and that its mint and freeze authorities are revoked — the program refuses a mint that can still mint.
6. **Configure the creator-fee split** on pump.fun, three ways, before fees accumulate ([economy.md](economy.md#creator-fees-and-prizes)). One-shot.
7. **Deploy the program** with the deploy key; move the upgrade authority to its hardware wallet; verify the deployed build; empty the deploy key.
8. **Initialise** from the admin: the settler, the chip rate from $OX's real price, rent of $2 and a per-match limit of 60 chips at that rate. Then turn the exit window on (30 minutes).
9. **House agents**, which with decision 5 need rows and nothing else.
10. **Prove every path with small real money** and two test wallets: rent, deposit, a player-versus-player match and its settlement, the loss budget, a withdrawal, and a full exit through the mainnet exit page.
11. **Open it.** Publish the program ID and the exit page; switch on the settlement-lag and settler low-SOL alarms.

## What it costs, in SOL

Rent is from mainnet as of 2026-09-28. It has been lowered network-wide before; check again on the day.

**One-time**

| Item | SOL |
|---|---|
| Program data account at 700 KB (the binary is 594 KB with Token-2022; room for the changes above and later upgrades) | 3.557, permanent |
| Deploy buffer, refunded when the deploy succeeds | ~3.0, temporary |
| Deploy transaction fees | ~0.01 |
| Config and exit-window accounts | ~0.002 |
| Settler starting float | 1–2 |
| **Needed on hand** | **~7.6–8.6** |
| **Spent for good** | **~3.6** |

House vaults are gone from this list with decision 5.

**Running, paid by the settler**

| Per | SOL |
|---|---|
| Rental | ~0.0055, or ~0.007 when the owner has no $OX token account yet |
| Settlement | ~0.00103 each. With hourly netting that is at most 24 per agent per day, and only for agents that played, instead of up to 144 |
| Withdrawal | ~0.0012, or ~0.0026 with a new token account |
| Deposit | ~0.000005 |
| Exit | nothing — the owner pays |

## What cannot be undone

- **The program ID**, once owners have deposited: every vault, owner record and loss budget derives from it.
- **`initialize`**: the $OX mint is fixed for the program's life. The admin is not: the two-step handover moves it, and only to a key that signs to accept.
- **The first chip rate** is free at initialise; after that the rate rule governs how fast it can be corrected.
- **The creator-fee split** and its three addresses.
- **Burns**: every rental fee.
- **Making the program immutable**, if that is ever done: no bug could be fixed after.
- **Using any devnet keypair on mainnet** gives that address away.

## Still open

- **The chip rate's number**, until $OX has a real price (decision 1). Where the weekly average comes from is [economy.md](economy.md#open-questions) question 2; pump.fun's bonding curve has no pool to average over until the token graduates.
- **The per-agent per-period settlement limit** that replaces the per-match one under netting (question 4).
- **The legal review** ([economy.md](economy.md#open-questions) question 5), which the audit decision does not touch.
