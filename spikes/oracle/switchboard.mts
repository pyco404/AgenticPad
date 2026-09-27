// Switchboard On-Demand randomness on devnet: a reusable randomness account,
// then commit and reveal per use. Measures latency and cost; throwaway key only.
//   SPIKE_KEY=path.json N=10 npx tsx switchboard.mts
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { Randomness, getDefaultDevnetQueue, ON_DEMAND_DEVNET_PID } from "@switchboard-xyz/on-demand";

const connection = new Connection(process.env["RPC"] ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env["SPIKE_KEY"]!, "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = await Program.at(ON_DEMAND_DEVNET_PID, provider);
const queue = await getDefaultDevnetQueue(connection.rpcEndpoint);

const send = async (ixs: TransactionInstruction[], extra: Keypair[] = []) => {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: "confirmed" });
  const got = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return { fee: got?.meta?.fee ?? 0, cu: got?.meta?.computeUnitsConsumed ?? 0 };
};

// One-time: the randomness account, reused for every draw after.
const b0 = await connection.getBalance(payer.publicKey, "confirmed");
const rngKp = Keypair.generate();
const [randomness, createIx] = await Randomness.create(program as never, rngKp, queue.pubkey);
await send([createIx], [rngKp]);
const createCost = b0 - (await connection.getBalance(payer.publicKey, "confirmed"));

const runs = [];
for (let i = 0; i < Number(process.env["N"] ?? 10); i++) {
  const before = await connection.getBalance(payer.publicKey, "confirmed");
  const t0 = Date.now();
  const commit = await send([await randomness.commitIx(queue.pubkey)]);
  const tCommitted = Date.now();
  // The reveal needs the oracle's signature, fetched off chain from its gateway,
  // for a slot after the commit. Retry until the oracle will give it.
  let revealIx: TransactionInstruction | null = null;
  let tries = 0;
  while (!revealIx) {
    tries++;
    try {
      revealIx = await randomness.revealIx();
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const tRevealReady = Date.now();
  const reveal = await send([revealIx]);
  const tRevealed = Date.now();
  const after = await connection.getBalance(payer.publicKey, "confirmed");
  runs.push({
    totalMs: tRevealed - t0,
    commitMs: tCommitted - t0,
    oracleMs: tRevealReady - tCommitted,
    revealMs: tRevealed - tRevealReady,
    gatewayTries: tries,
    costLamports: before - after,
    commitCU: commit.cu,
    revealCU: reveal.cu,
  });
  console.error(`run ${i + 1}: ${tRevealed - t0} ms, ${before - after} lamports`);
}
const stat = (k: keyof (typeof runs)[number]) => {
  const xs = runs.map((r) => r[k]).sort((a, b) => a - b);
  return { min: xs[0], median: xs[Math.floor(xs.length / 2)], max: xs.at(-1) };
};
console.log(JSON.stringify({
  cluster: connection.rpcEndpoint,
  queue: queue.pubkey.toBase58(),
  oneTimeAccountLamports: createCost,
  runs: runs.length,
  totalMs: stat("totalMs"),
  commitMs: stat("commitMs"),
  oracleMs: stat("oracleMs"),
  revealMs: stat("revealMs"),
  costLamportsPerDraw: stat("costLamports"),
  commitCU: stat("commitCU"),
  revealCU: stat("revealCU"),
  solPerDraw: stat("costLamports").median / LAMPORTS_PER_SOL,
}, null, 1));
