import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
// pump.fun's program now sweeps the curve's creator bucket before a distribution; only SDK 4 builds
// that. The launch path stays on the SDK it was tested with (lib/pump-sdk.ts); this script alone uses 4.
import { createRequire } from "node:module";
// Loaded as CommonJS: its ESM build's anchor import does not resolve under this project's loader.
const pump4 = createRequire(import.meta.url)("pump-sdk-v4") as typeof import("pump-sdk-v4");
import { AGP_MINT } from "../lib/agp";
import { DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET, LAUNCH_FEE_RECIPIENT } from "../lib/launchpad-fees";

/**
 * Pays a token's accumulated pump.fun creator fees out to its locked fee split (15% daily, 50% weekly,
 * 35% platform for AgenticPad launches). Anyone may send it; the signer only pays the network fee.
 * Without --send it reports what is waiting and simulates the payout.
 */
if (process.argv.includes("--help")) {
  console.log("Usage: npm run pump:distribute -- [--mint <address>] [--keypair /path/to/wallet.json --send]\nDefaults to $AGP. Without --send, reports and simulates only. Requires PUMP_RPC_URL (mainnet).");
  process.exit(0);
}
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const rpc = process.env.PUMP_RPC_URL;
if (!rpc) throw new Error("Set PUMP_RPC_URL in web/.env.local.");
const connection = new Connection(rpc, "confirmed");
if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Distribution is on mainnet only.");

const mint = new PublicKey(arg("--mint") ?? AGP_MINT);
const keyPath = arg("--keypair");
const signer = keyPath ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")) as number[])) : null;
const payer = signer?.publicKey ?? new PublicKey(LAUNCH_FEE_RECIPIENT);
const sol = (lamports: number | bigint) => (Number(lamports) / 1e9).toFixed(6);
const wallets = { daily: DAILY_REWARDS_WALLET, weekly: WEEKLY_REWARDS_WALLET, platform: LAUNCH_FEE_RECIPIENT };
const balances = async () => Object.fromEntries(await Promise.all(Object.entries(wallets).map(async ([k, w]) => [k, sol(await connection.getBalance(new PublicKey(w)))])));

const online = new pump4.OnlinePumpSdk(connection);
const waiting = await online.getMinimumDistributableFee(mint, payer);
console.log(JSON.stringify({ mint: mint.toBase58(), waitingSol: sol(BigInt(waiting.distributableFees.toString())), minimumSol: sol(BigInt(waiting.minimumRequired.toString())), canDistribute: waiting.canDistribute, wallets: await balances() }, null, 2));
if (!waiting.canDistribute) { console.log("Not enough has accumulated to distribute yet."); process.exit(0); }

const { instructions } = await online.buildDistributeCreatorFeesInstructions(mint, { payer });
const latest = await connection.getLatestBlockhash();
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
const simulation = await connection.simulateTransaction(tx, { sigVerify: false });
if (simulation.value.err) {
  console.log((simulation.value.logs ?? []).slice(-8).join("\n"));
  throw new Error(`The distribution would fail: ${JSON.stringify(simulation.value.err)}. Nothing was sent.`);
}
if (!process.argv.includes("--send") || !signer) {
  console.log("Simulation passed. Nothing was sent. To pay it out, rerun with --keypair /path/to/wallet.json --send (the wallet pays only the network fee).");
  process.exit(0);
}
tx.sign([signer]);
const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
await connection.confirmTransaction({ signature, ...latest }, "confirmed");
console.log(JSON.stringify({ distributed: true, signature, explorer: `https://solscan.io/tx/${signature}`, wallets: await balances() }, null, 2));
