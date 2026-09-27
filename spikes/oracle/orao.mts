// ORAO VRF on devnet: latency from request to fulfilled, and what a request
// costs the payer. Uses a throwaway key (SPIKE_KEY), never the settler's.
//   SPIKE_KEY=path.json N=10 npx tsx orao.mts
import { readFileSync } from "node:fs";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Orao } from "@orao-network/solana-vrf";
import { OraoCb } from "@orao-network/solana-vrf-cb";

const connection = new Connection(process.env["RPC"] ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env["SPIKE_KEY"]!, "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const vrf = new Orao(provider);

const state = await vrf.getNetworkState();
const cbState = await new OraoCb(provider).getNetworkState().catch((e: Error) => ({ error: e.message }));
const runs = [];
for (let i = 0; i < Number(process.env["N"] ?? 10); i++) {
  const before = await connection.getBalance(payer.publicKey, "confirmed");
  const t0 = Date.now();
  const s0 = await connection.getSlot("confirmed");
  const [seed, sig] = await (await vrf.request()).rpc();
  const tLanded = Date.now();
  await vrf.waitFulfilled(seed, "confirmed");
  const tFulfilled = Date.now();
  const s1 = await connection.getSlot("confirmed");
  const after = await connection.getBalance(payer.publicKey, "confirmed");
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  runs.push({
    requestToLandedMs: tLanded - t0,
    landedToFulfilledMs: tFulfilled - tLanded,
    totalMs: tFulfilled - t0,
    slots: s1 - s0,
    costLamports: before - after,
    txFeeLamports: tx?.meta?.fee ?? null,
    requestCU: tx?.meta?.computeUnitsConsumed ?? null,
  });
  console.error(`run ${i + 1}: ${tFulfilled - t0} ms, ${before - after} lamports`);
}
const stat = (k: keyof (typeof runs)[number]) => {
  const xs = runs.map((r) => r[k] as number).filter((x) => x !== null).sort((a, b) => a - b);
  return { min: xs[0], median: xs[Math.floor(xs.length / 2)], max: xs.at(-1) };
};
console.log(JSON.stringify({
  cluster: connection.rpcEndpoint,
  requestFeeLamports: state.config.requestFee.toString(),
  callbackVrf: "error" in cbState ? cbState : { requestFeeLamports: cbState.config.requestFee.toString(), callbackDeadlineSlots: cbState.config.callbackDeadline.toString() },
  runs: runs.length,
  totalMs: stat("totalMs"),
  requestToLandedMs: stat("requestToLandedMs"),
  landedToFulfilledMs: stat("landedToFulfilledMs"),
  slots: stat("slots"),
  costLamports: stat("costLamports"),
  txFeeLamports: stat("txFeeLamports"),
  requestCU: stat("requestCU"),
  solPerRequest: stat("costLamports").median! / LAMPORTS_PER_SOL,
}, null, 1));
