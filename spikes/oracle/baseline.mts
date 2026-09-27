// What a real settlement costs today on devnet: compute units and fee, from the
// deposit program's recent transactions.
import { Connection, PublicKey } from "@solana/web3.js";
const connection = new Connection(process.env["RPC"] ?? "https://api.devnet.solana.com", "confirmed");
const program = new PublicKey("HTs42VFpHS4XT9Cr8xH7cJEMgqPL9uuzZn6QHGwtvkdy");
const sigs = await connection.getSignaturesForAddress(program, { limit: 200 });
const settles: { cu: number; fee: number; slot: number }[] = [];
for (const s of sigs) {
  if (s.err) continue;
  await new Promise((r) => setTimeout(r, 700));
  const tx = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta?.logMessages?.some((l) => l.includes("Instruction: Settle"))) continue;
  settles.push({ cu: tx.meta.computeUnitsConsumed ?? 0, fee: tx.meta.fee, slot: tx.slot });
  if (settles.length >= 10) break;
}
const cus = settles.map((s) => s.cu).sort((a, b) => a - b);
console.log(JSON.stringify({ settlesFound: settles.length, settleCU: { min: cus[0], median: cus[Math.floor(cus.length / 2)], max: cus.at(-1) }, feeLamports: [...new Set(settles.map((s) => s.fee))], newestSlot: settles[0]?.slot }, null, 1));
