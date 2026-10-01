import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { mulberry32 } from "../src/index.js";
import { nameFactory } from "./names.js";
import { connect } from "../src/db/client.js";
import { ensureDepositHouse, type HouseSeat } from "../src/db/house.js";
import { refreshTrueRatings } from "../src/db/rating.js";
import { ChainClient, stakeMintOf, tokenProgramOf } from "../src/chain/settlement.js";

/**
 * The house roster on the deposit program, in two steps that run in two places.
 *
 *   create   Where the database is (production: inside the api container).
 *            Creates whatever of the roster is missing (src/db/house.ts), each
 *            with a pending open_vault op the outbox worker sends, and prints
 *            the whole roster as JSON on stdout.
 *
 *              npx tsx scripts/seed-deposit-house.ts create > house.json
 *
 *   fund     Optional, and devnet only: house agents need no balance (they
 *            never stake), so a mainnet roster is never funded. Where the
 *            treasury key is, tops each open vault up to its target
 *            from the treasury; a vault the worker has not opened yet is
 *            reported and skipped, so run it again once it has. Idempotent:
 *            it deposits only the difference. The ledger follows through the
 *            api's sweep, which credits money that reaches a vault this way.
 *
 *              CHAIN_RPC_URL=https://api.devnet.solana.com \
 *                npx tsx scripts/seed-deposit-house.ts fund house.json
 *
 * The treasury pays its own transaction fees, so it needs a little SOL.
 */

const [mode, file] = process.argv.slice(2);

if (mode === "create") {
  const { db, close } = await connect();
  const nextName = nameFactory(mulberry32(Date.now() % 1_000_000));
  const { created, roster } = await ensureDepositHouse(db, nextName);
  console.error(`created ${created.length}, roster ${roster.length}`);
  for (const s of created) console.error(`  ${s.presetName.padEnd(7)} ${s.name}`);
  console.error(`true ratings: ${await refreshTrueRatings(db)} agents rated`);
  console.log(JSON.stringify(roster));
  await close();
} else if (mode === "fund") {
  if (!file) throw new Error("fund needs the roster file that create printed");
  const roster = JSON.parse(readFileSync(file, "utf8")) as HouseSeat[];
  const connection = new Connection(process.env["CHAIN_RPC_URL"] ?? "https://api.devnet.solana.com", "confirmed");
  const treasury = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(process.env["TREASURY_KEY"] ?? ".keys/treasury.json", "utf8"))),
  );
  const mint = await stakeMintOf(connection);
  const client = new ChainClient(connection, treasury, mint, await tokenProgramOf(connection, mint));
  const rate = (await client.config()).chipRate.toNumber();
  const counts = { funded: 0, alreadyFull: 0, notOpenYet: 0 };
  for (const seat of roster) {
    const held = await client.vaultBalance(seat.id);
    if (held === null) {
      console.log(`  not open yet   ${seat.name}`);
      counts.notOpenYet++;
      continue;
    }
    const short = seat.chips * rate - held;
    if (short <= 0) {
      counts.alreadyFull++;
      continue;
    }
    await client.deposit({ agentId: seat.id, amount: short });
    console.log(`  funded         ${seat.name} +${short / rate} chips`);
    counts.funded++;
  }
  console.log(JSON.stringify(counts));
  if (counts.notOpenYet > 0) console.log("Some vaults are not open yet: run this again once the worker has opened them.");
} else {
  console.error("usage: seed-deposit-house.ts create | fund <roster.json>");
  process.exit(1);
}
