// Replays matches on a local validator running replay/ and reads the compute
// units the replay itself costs, from the program's own before/after logs.
//   solana-test-validator --bpf-program <id> replay/target/deploy/replay_spike.so ...
//   REPLAY_PROGRAM=<id> RPC=http://127.0.0.1:18999 npx tsx spikes/oracle/measure-replay.mts
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";

const connection = new Connection(process.env["RPC"] ?? "http://127.0.0.1:18999", "confirmed");
const program = new PublicKey(process.env["REPLAY_PROGRAM"]!);
const payer = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");

const cases = JSON.parse(readFileSync(new URL("./parity.json", import.meta.url), "utf8")) as { a: string; b: string; seed: number; netA: number; netB: number; rounds: number }[];
const sample = cases.slice(0, Number(process.env["N"] ?? 300));
const replay: number[] = [];
const whole: number[] = [];
let mismatches = 0;
for (const c of sample) {
  const data = Buffer.alloc(26);
  data.writeBigUInt64LE(BigInt(c.a), 0);
  data.writeBigUInt64LE(BigInt(c.b), 8);
  data.writeUInt32LE(c.seed, 16);
  data.writeUInt16LE(4, 20);
  data.writeUInt16LE(10, 22);
  data.writeUInt16LE(20, 24);
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(new TransactionInstruction({ programId: program, keys: [], data }));
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  const got = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = got!.meta!.logMessages!;
  // "Program consumption: N units remaining", twice: before and after the replay.
  const remaining = logs.filter((l) => l.includes("units remaining")).map((l) => Number(l.match(/consumption: (\d+)/)![1]));
  replay.push(remaining[0]! - remaining[1]!);
  whole.push(got!.meta!.computeUnitsConsumed!);
  const [netA, netB, rounds] = logs.find((l) => l.includes("nets "))!.match(/nets (-?\d+) (-?\d+) rounds (\d+)/)!.slice(1).map(Number);
  if (netA !== c.netA || netB !== c.netB || rounds !== c.rounds) mismatches++;
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) };
};
console.log(JSON.stringify({ matches: sample.length, onChainResultMismatches: mismatches, replayUnits: stats(replay), wholeInstructionUnits: stats(whole) }, null, 1));
