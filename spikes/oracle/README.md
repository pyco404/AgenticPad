# Oracle spike

Measurements for [docs/oracle-spike.md](../../docs/oracle-spike.md). Not part of
the app: this folder has its own `package.json` so the oracle SDKs never become
the app's dependencies, and nothing here is typechecked or tested by
`npm run check`.

| File | Measures |
|---|---|
| `replay/` | A Solana program that replays one match from two packed tables and a seed, logging compute units either side. `cargo test` checks it against the TypeScript engine. |
| `parity.mts` | Generates the parity cases from the real engine (writes `parity.json`, not committed). |
| `measure-replay.mts` | Runs `replay/` on a local validator and reports compute units. |
| `orao.mts` | ORAO VRF on devnet: latency and cost per request. |
| `switchboard.mts` | Switchboard On-Demand randomness on devnet: latency and cost per draw. |
| `baseline.mts` | What recent settlements cost, for comparison. |

Run with a throwaway devnet key, never the settler's or the admin's:

```bash
npm install                                   # in this folder
npx tsx spikes/oracle/parity.mts              # from the repo root
(cd spikes/oracle/replay && cargo test --release && cargo build-sbf)
solana-test-validator --reset --rpc-port 18999 --bpf-program <id> spikes/oracle/replay/target/deploy/replay_spike.so
REPLAY_PROGRAM=<id> RPC=http://127.0.0.1:18999 npx tsx spikes/oracle/measure-replay.mts
SPIKE_KEY=<throwaway.json> N=10 npx tsx orao.mts         # in this folder
SPIKE_KEY=<throwaway.json> N=10 npx tsx switchboard.mts
```
