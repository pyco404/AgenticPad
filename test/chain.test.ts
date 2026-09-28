import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AuthorityType,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMint,
  ExtensionType,
  getMint,
  getMintLen,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  tokenMetadataInitialize,
  transfer,
} from "@solana/spl-token";
import BN from "bn.js";
import { ChainClient, DEVNET_CHIP_RATE, PROGRAM_ID, pdas, STAKE_DECIMALS } from "../src/chain/settlement.js";
import { utcDay, uuidBytes } from "../src/chain/common.js";

/**
 * Which token program the stake token lives under for this run. The suite runs
 * twice (scripts/chain-test.sh): once on an SPL Token mint, as devnet is, and
 * once with CHAIN_TOKEN=2022 on a Token-2022 mint carrying the metadata
 * extensions a pump.fun token has - which is what $OX is expected to be.
 */
const TOKEN = process.env["CHAIN_TOKEN"] === "2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

/** The day a settlement is dated when the test plays it now. */
const todayUtc = () => utcDay(new Date());
import { agentIdFor, newAgentId } from "../src/agent-id.js";
import { packPolicy, unpackPolicy } from "../src/agents/policy.js";
import { snapshotPreset } from "../src/db/runner.js";
import { EventParser } from "@coral-xyz/anchor";

// The settlement program on a local validator, loaded at genesis. Needs
// solana-test-validator on PATH and the program built (anchor build in chain/),
// so it runs only when CHAIN=1.
const RUN = process.env["CHAIN"] === "1";
const RPC_PORT = 28899 + Math.floor(Math.random() * 500);

let validator: ChildProcess | undefined;
let ledger: string;
let connection: Connection;
let admin: Keypair;
let settler: Keypair;
let chain: ChainClient;
/** The stake token: made outside the program, fixed supply, no mint authority. */
let stakeMint: PublicKey;
/** Holds the whole supply, and is where every vault in this file is funded from. */
let treasury: PublicKey;
/**
 * What initialize said to the stake tokens it should refuse. Captured in
 * beforeAll rather than asserted in a test of its own, because the config is a
 * singleton PDA: after the first initialize every later one fails on the
 * account already existing, whatever the mint is, which would make the
 * assertions below pass without ever reaching the checks they are about.
 */
let initRefusals: { mintable: string; decimals: string; stranger: string };
let upgrader: Keypair;
/**
 * Every figure in this file is written as chips times CHIP, because that is how
 * the product thinks and how the program's own limits are stated. The chain
 * only ever sees the product: base units, six decimals. On devnet the rate is
 * fixed at one chip to one whole token.
 */
const CHIP = DEVNET_CHIP_RATE;
/** Band C's worst match, which is what max_settlement is set to. */
const MAX = 60 * CHIP;
/** Slots an exit waits here. The program's floor is 10; production uses 4,500. */
const TEST_EXIT_WINDOW = 12;
/** What a rental costs, burned. */
const RENT = 200 * CHIP;
/** Must match the program's constants, converted at the rate. */
const OUTFLOW_FLOOR = 120 * CHIP;
const MAX_SETTLEMENT_CEILING = 900 * CHIP;
/** What one vault may pay out in a window, measured on what it holds. */
const outflowCap = (vault: number) => Math.max(OUTFLOW_FLOOR, Math.floor(vault / 4));

/**
 * Puts tokens in a vault, the way the roster funds a house agent: a deposit
 * from the treasury, which is the only place the supply ever was. Nothing
 * mints them.
 */
async function fund(agentId: string, amount: number): Promise<void> {
  if (amount === 0) return;
  await new ChainClient(connection, admin, stakeMint, TOKEN).deposit({ agentId, amount });
}

/** A house vault: an id derived from no owner, and the salt that proves it. */
async function houseVault(amount: number, via: ChainClient = chain): Promise<string> {
  const { id, salt } = newAgentId(null);
  await via.openVault({ agentId: id, owner: null, salt });
  await fund(id, amount);
  return id;
}

/** A player's vault: the id derives from the owner's key, and the program records that owner as it opens. */
async function playerVault(amount: number, owner: Keypair = Keypair.generate()) {
  const { id, salt } = newAgentId(owner.publicKey.toBase58());
  await chain.openVault({ agentId: id, owner: owner.publicKey.toBase58(), salt });
  await fund(id, amount);
  return { agent: id, owner };
}

/**
 * Waits out the last seconds of a UTC hour. The outflow window is the clock
 * hour, so a test that fills one and then expects a refusal would pass for the
 * wrong reason if the hour turned in between.
 */
async function clearOfTheHour(marginMs = 10_000): Promise<void> {
  const into = Date.now() % 3_600_000;
  if (into > 3_600_000 - marginMs) await new Promise((r) => setTimeout(r, 3_600_000 - into + 1_000));
}

/** The error a call failed with, as text. Empty if it unexpectedly succeeded. */
async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "";
  } catch (error) {
    return String(error);
  }
}

/** Sends with the settler paying, as every server-built transaction does, plus whoever else must sign. */
async function sendWith(tx: Transaction, signers: Keypair[]): Promise<string> {
  tx.feePayer = settler.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return sendAndConfirmTransaction(connection, tx, [settler, ...signers], { commitment: "confirmed" });
}

/**
 * A mint under this run's token program, with `authority` able to mint. On
 * Token-2022 it carries a metadata pointer and on-mint metadata, as a pump.fun
 * token does; neither changes how its accounts behave, but the program has to
 * accept a mint that has them.
 */
async function makeMint(authority: Keypair, decimals: number): Promise<PublicKey> {
  if (TOKEN.equals(TOKEN_PROGRAM_ID)) {
    return createMint(connection, authority, authority.publicKey, null, decimals, undefined, undefined, TOKEN);
  }
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.MetadataPointer]);
  // Room for the metadata written into the mint after it is initialised.
  const lamports = await connection.getMinimumBalanceForRentExemption(space + 512);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: authority.publicKey, newAccountPubkey: mint.publicKey, space, lamports, programId: TOKEN }),
    createInitializeMetadataPointerInstruction(mint.publicKey, authority.publicKey, mint.publicKey, TOKEN),
    createInitializeMintInstruction(mint.publicKey, decimals, authority.publicKey, null, TOKEN),
  );
  await sendAndConfirmTransaction(connection, tx, [authority, mint], { commitment: "confirmed" });
  await tokenMetadataInitialize(connection, authority, mint.publicKey, authority.publicKey, authority, "Test stake", "TST", "", [], { commitment: "confirmed" }, TOKEN);
  return mint.publicKey;
}

async function airdrop(to: Keypair, sol: number) {
  const sig = await connection.requestAirdrop(to.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

describe.skipIf(!RUN)("settlement program", () => {
  beforeAll(async () => {
    ledger = mkdtempSync(join(tmpdir(), "oxude-ledger-"));
    // Loaded upgradeable, with an upgrade authority of its own, as a real
    // deploy is: initialize checks the ProgramData account for exactly this.
    upgrader = Keypair.generate();
    validator = spawn(
      "solana-test-validator",
      [
        "--reset", "--quiet", "--ledger", ledger,
        "--rpc-port", String(RPC_PORT), "--faucet-port", String(RPC_PORT + 1000),
        "--dynamic-port-range", `${RPC_PORT + 2000}-${RPC_PORT + 2100}`,
        "--upgradeable-program", PROGRAM_ID.toBase58(), "chain/target/deploy/oxude_settlement.so", upgrader.publicKey.toBase58(),
      ],
      { stdio: "ignore" },
    );
    connection = new Connection(`http://127.0.0.1:${RPC_PORT}`, "confirmed");
    for (let i = 0; i < 60; i++) {
      try {
        await connection.getVersion();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    admin = Keypair.generate();
    settler = Keypair.generate();
    await airdrop(admin, 5);
    await airdrop(settler, 5);

    // The stake token, made the way a pump.fun token is: a mint with an
    // authority, the whole supply issued once, and then the authority given up
    // for good. After the last step nobody can mint, this program included.
    stakeMint = await makeMint(admin, STAKE_DECIMALS);
    treasury = (await getOrCreateAssociatedTokenAccount(connection, admin, stakeMint, admin.publicKey, false, undefined, undefined, TOKEN)).address;
    // A billion tokens, as $OX has: 1e15 base units, well inside a u64 and
    // inside a JavaScript safe integer too.
    await mintTo(connection, admin, stakeMint, treasury, admin, 1_000_000_000 * CHIP, [], undefined, TOKEN);
    await setAuthority(connection, admin, stakeMint, admin, AuthorityType.MintTokens, null, [], undefined, TOKEN);

    // Before the real one, the two the program must turn away.
    const mintable = await makeMint(admin, STAKE_DECIMALS);
    const wrongScale = await makeMint(admin, 0);
    await setAuthority(connection, admin, wrongScale, admin, AuthorityType.MintTokens, null, [], undefined, TOKEN);
    initRefusals = {
      mintable: await refusal(() =>
        new ChainClient(connection, admin, mintable, TOKEN).initialize(settler.publicKey, MAX, RENT, CHIP, upgrader),
      ),
      decimals: await refusal(() =>
        new ChainClient(connection, admin, wrongScale, TOKEN).initialize(settler.publicKey, MAX, RENT, CHIP, upgrader),
      ),
      // Somebody who saw the deploy land: a good mint, but not the upgrade
      // authority - whether they sign as themselves or name the admin.
      stranger: await refusal(() =>
        new ChainClient(connection, admin, stakeMint, TOKEN).initialize(settler.publicKey, MAX, RENT, CHIP),
      ),
    };

    await new ChainClient(connection, admin, stakeMint, TOKEN).initialize(settler.publicKey, MAX, RENT, CHIP, upgrader);
    // Exits on, with a window this file can outlast. Production's is 4,500
    // slots (~30 minutes); at the validator's ~2.5 slots a second that would
    // be twenty minutes of test. TEST_EXIT_WINDOW is a few seconds, which is
    // the whole reason the window is configurable rather than compiled in.
    await new ChainClient(connection, admin, stakeMint, TOKEN).initExitConfig(TEST_EXIT_WINDOW);
    chain = new ChainClient(connection, settler, stakeMint, TOKEN);
  }, 60_000);

  afterAll(() => {
    validator?.kill("SIGKILL");
    if (ledger) rmSync(ledger, { recursive: true, force: true });
  });

  it("is configured with the settler, the mint, the limit and the rent", async () => {
    const config = await chain.config();
    expect(config.settler.toBase58()).toBe(settler.publicKey.toBase58());
    expect(config.admin.toBase58()).toBe(admin.publicKey.toBase58());
    expect(config.mint.toBase58()).toBe(stakeMint.toBase58());
    expect(config.maxSettlement.toNumber()).toBe(MAX);
    expect(config.rent.toNumber()).toBe(RENT);
  });

  describe("rent", () => {
    /** A wallet holding tokens out of the treasury, ready to pay for a rental. */
    async function renter(holding: number): Promise<Keypair> {
      const key = Keypair.generate();
      await airdrop(key, 1);
      const ata = (await getOrCreateAssociatedTokenAccount(connection, admin, stakeMint, key.publicKey, false, undefined, undefined, TOKEN)).address;
      await transfer(connection, admin, treasury, ata, admin, holding, [], undefined, TOKEN);
      return key;
    }

    /** Builds the fee instruction, adds the renter's signature to the settler's, sends. */
    async function payRent(who: Keypair, rentalId: string, amount = RENT, signAs: Keypair = who) {
      const ix = await chain.payRentInstruction({ rentalId, renter: who.publicKey, amount });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: settler.publicKey, blockhash, lastValidBlockHeight }).add(ix);
      tx.partialSign(settler, signAs);
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      return signature;
    }

    it("burns the fee out of the renter's own tokens, and takes it off the supply", async () => {
      const who = await renter(500 * CHIP);
      const supply = Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply);
      const rentalId = randomUUID();

      const signature = await payRent(who, rentalId);
      expect(await chain.tokenBalance(who.publicKey.toBase58())).toBe(300 * CHIP);
      // Burned, not collected: the supply itself falls by the fee.
      expect(Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply)).toBe(supply - RENT);
      expect(await chain.isRentPaid(rentalId)).toBe(true);

      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const events = [...new EventParser(PROGRAM_ID, chain.program.coder).parseLogs(tx!.meta!.logMessages!)];
      const paid = events.find((e) => e.name === "rentPaid")!;
      expect(Array.from(paid.data.rentalId as number[])).toEqual(uuidBytes(rentalId));
      expect((paid.data.renter as { toBase58(): string }).toBase58()).toBe(who.publicKey.toBase58());
      expect(Number(paid.data.amount)).toBe(RENT);
    });

    it("charges the price the config carries, and nothing else", async () => {
      const who = await renter(500 * CHIP);
      // Under the price, and over it: both refused. The amount is in the
      // transaction the renter signs, so a price that moved while they were
      // signing fails here instead of quietly costing them more.
      await expect(payRent(who, randomUUID(), RENT - 1)).rejects.toThrow(/WrongRent/);
      await expect(payRent(who, randomUUID(), RENT + 1)).rejects.toThrow(/WrongRent/);
      expect(await chain.tokenBalance(who.publicKey.toBase58())).toBe(500 * CHIP);
    });

    it("pays for a rental once", async () => {
      const who = await renter(500 * CHIP);
      const rentalId = randomUUID();
      await payRent(who, rentalId);
      await expect(payRent(who, rentalId)).rejects.toThrow(/already in use/);
      expect(await chain.tokenBalance(who.publicKey.toBase58())).toBe(300 * CHIP);
    });

    it("needs the renter's own signature and the settler's", async () => {
      const who = await renter(500 * CHIP);
      const stranger = Keypair.generate();
      // Somebody else signing in the renter's place: the burn has no authority.
      await expect(payRent(who, randomUUID(), RENT, stranger)).rejects.toThrow();
      expect(await chain.tokenBalance(who.publicKey.toBase58())).toBe(500 * CHIP);
    });

    it("lets only the admin change the price", async () => {
      const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
      await expect(chain.setRent(RENT * 2)).rejects.toThrow(/NotAdmin/);
      await expect(asAdmin.setRent(0)).rejects.toThrow(/InvalidLimit/);
      expect((await chain.config()).rent.toNumber()).toBe(RENT);

      await asAdmin.setRent(RENT * 2);
      expect((await chain.config()).rent.toNumber()).toBe(RENT * 2);
      // The old price now fails, which is the protection: nobody is charged a
      // price they did not see.
      const who = await renter(500 * CHIP);
      await expect(payRent(who, randomUUID(), RENT)).rejects.toThrow(/WrongRent/);
      await payRent(who, randomUUID(), RENT * 2);
      expect(await chain.tokenBalance(who.publicKey.toBase58())).toBe(100 * CHIP);

      // Put it back: the rest of this file assumes the price it was opened with.
      await asAdmin.setRent(RENT);
      expect((await chain.config()).rent.toNumber()).toBe(RENT);
    });
  });

  it("lets only the config's admin change the per-match limit", async () => {
    const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
    // The settler cannot: this limit exists to bound the settler's own reach.
    await expect(chain.setMaxSettlement(90 * CHIP)).rejects.toThrow(/NotAdmin/);
    // Nor can a stranger paying their own fees.
    const stranger = Keypair.generate();
    await airdrop(stranger, 1);
    await expect(new ChainClient(connection, stranger, stakeMint, TOKEN).setMaxSettlement(90 * CHIP)).rejects.toThrow(/NotAdmin/);
    expect((await chain.config()).maxSettlement.toNumber()).toBe(MAX);

    // The admin can, and it takes effect at once: 90 is band C's max exposure,
    // which is the reason this instruction exists.
    await asAdmin.setMaxSettlement(90 * CHIP);
    expect((await chain.config()).maxSettlement.toNumber()).toBe(90 * CHIP);
    const payer = await houseVault(180 * CHIP);
    const payee = await houseVault(10 * CHIP);
    await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: 90 * CHIP });
    expect(await chain.vaultBalance(payer)).toBe(90 * CHIP);

    // Zero, and anything above a full seed, are refused: a stolen admin key
    // cannot switch the per-settlement guard off.
    await expect(asAdmin.setMaxSettlement(0)).rejects.toThrow(/InvalidLimit/);
    await expect(asAdmin.setMaxSettlement(MAX_SETTLEMENT_CEILING + 1)).rejects.toThrow(/InvalidLimit/);
    expect((await chain.config()).maxSettlement.toNumber()).toBe(90 * CHIP);

    // Put it back: the rest of this file assumes the limit it was opened with.
    await asAdmin.setMaxSettlement(MAX);
    expect((await chain.config()).maxSettlement.toNumber()).toBe(MAX);
  });

  it("lets only the admin rotate the settler, and refuses a rotation that changes nothing", async () => {
    const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
    const fresh = Keypair.generate();

    // The settler cannot hand its own role on, nor can a stranger take it.
    await expect(chain.setSettler(fresh.publicKey)).rejects.toThrow(/NotAdmin/);
    const stranger = Keypair.generate();
    await airdrop(stranger, 1);
    await expect(new ChainClient(connection, stranger, stakeMint, TOKEN).setSettler(fresh.publicKey)).rejects.toThrow(/NotAdmin/);
    expect((await chain.config()).settler.toBase58()).toBe(settler.publicKey.toBase58());

    // A no-op rotation is refused, so it can never look like one happened.
    await expect(asAdmin.setSettler(settler.publicKey)).rejects.toThrow(/InvalidSettler/);
    // And the admin cannot take the settler's role itself.
    await expect(asAdmin.setSettler(admin.publicKey)).rejects.toThrow(/InvalidSettler/);

    // The admin rotates it, and the old key immediately loses its powers.
    await asAdmin.setSettler(fresh.publicKey);
    expect((await chain.config()).settler.toBase58()).toBe(fresh.publicKey.toBase58());
    const orphan = newAgentId(null);
    await expect(chain.openVault({ agentId: orphan.id, owner: null, salt: orphan.salt })).rejects.toThrow(
      /NotSettler/,
    );

    // The new key has them. It pays its own rent, so give it some SOL.
    await airdrop(fresh, 2);
    const asFresh = new ChainClient(connection, fresh, stakeMint, TOKEN);
    const taken = newAgentId(null);
    await asFresh.openVault({ agentId: taken.id, owner: null, salt: taken.salt });
    await fund(taken.id, 100 * CHIP);
    expect(await chain.vaultBalance(taken.id)).toBe(100 * CHIP);

    // Put it back, so every later test still signs with the original settler.
    await asAdmin.setSettler(settler.publicKey);
    expect((await chain.config()).settler.toBase58()).toBe(settler.publicKey.toBase58());
  });

  it("opens a vault empty, because nothing here can create currency", async () => {
    const { id, salt } = newAgentId(null);
    await chain.openVault({ agentId: id, owner: null, salt });
    expect(await chain.vaultBalance(id)).toBe(0);
    // A vault opens once.
    await expect(chain.openVault({ agentId: id, owner: null, salt })).rejects.toThrow();
  });

  it("funds a vault by deposit, and says which agent and which wallet", async () => {
    const { id, salt } = newAgentId(null);
    await chain.openVault({ agentId: id, owner: null, salt });
    const before = await chain.tokenBalance(admin.publicKey.toBase58());

    const signature = await new ChainClient(connection, admin, stakeMint, TOKEN).deposit({ agentId: id, amount: 300 * CHIP });
    expect(await chain.vaultBalance(id)).toBe(300 * CHIP);
    expect(await chain.tokenBalance(admin.publicKey.toBase58())).toBe(before - 300 * CHIP);

    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const events = [...new EventParser(PROGRAM_ID, chain.program.coder).parseLogs(tx!.meta!.logMessages!)];
    const deposited = events.find((e) => e.name === "deposited")!;
    expect(Array.from(deposited.data.agentId as number[])).toEqual(uuidBytes(id));
    expect((deposited.data.depositor as { toBase58(): string }).toBase58()).toBe(admin.publicKey.toBase58());
    expect(Number(deposited.data.amount)).toBe(300 * CHIP);

    // Topping up is the same instruction again: this is what revives an agent
    // that played itself down to nothing.
    await fund(id, 50 * CHIP);
    expect(await chain.vaultBalance(id)).toBe(350 * CHIP);
  });

  it("takes a deposit from anyone, but only out of their own account", async () => {
    const { agent } = await playerVault(100 * CHIP);
    // A stranger may pay into someone else's agent. The program has no reason
    // to stop it - a plain transfer would reach the vault anyway - and it costs
    // the stranger, not the agent.
    const stranger = Keypair.generate();
    await airdrop(stranger, 1);
    const strangerAta = (await getOrCreateAssociatedTokenAccount(connection, admin, stakeMint, stranger.publicKey, false, undefined, undefined, TOKEN)).address;
    await transfer(connection, admin, treasury, strangerAta, admin, 40 * CHIP, [], undefined, TOKEN);
    await new ChainClient(connection, stranger, stakeMint, TOKEN).deposit({ agentId: agent, amount: 40 * CHIP });
    expect(await chain.vaultBalance(agent)).toBe(140 * CHIP);

    // But they cannot spend someone else's account by naming it as the source.
    // The treasury holds the supply, so this is the raid worth refusing.
    await expect(
      chain.program.methods
        .deposit(uuidBytes(agent), new BN(10 * CHIP))
        .accountsPartial({
          depositor: stranger.publicKey,
          config: pdas.config(),
          source: treasury,
          vault: pdas.vault(agent),
          mint: stakeMint,
          tokenProgram: TOKEN,
        })
        .signers([stranger])
        .rpc(),
    ).rejects.toThrow(/NotDepositorsAccount/);
    expect(await chain.vaultBalance(agent)).toBe(140 * CHIP);
  });

  it("refuses a deposit of nothing", async () => {
    const { agent } = await playerVault(50 * CHIP);
    await expect(
      new ChainClient(connection, admin, stakeMint, TOKEN).deposit({ agentId: agent, amount: 0 }),
    ).rejects.toThrow(/ZeroAmount/);
    expect(await chain.vaultBalance(agent)).toBe(50 * CHIP);
  });

  it("refuses a stake token that can still be minted, or that is not six decimals", () => {
    // The supply guarantee, checked rather than assumed: a mint that still has
    // an authority is refused, so no deployment can rest on an inflatable token.
    expect(initRefusals.mintable).toMatch(/MintableStakeToken/);
    // And a token of a different scale, where every figure the product quotes
    // would be out by a factor of a thousand.
    expect(initRefusals.decimals).toMatch(/WrongStakeDecimals/);
  });

  it("lets only the program's upgrade authority initialise it", () => {
    // The admin signed and a valid mint was given, but the upgrade authority
    // did not sign: refused, so a deploy cannot be taken by whoever calls first.
    expect(initRefusals.stranger).toMatch(/NotUpgradeAuthority/);
  });

  it("opens a vault only under the id its owner and salt hash to", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const { id, salt } = newAgentId(owner);
    // Somebody else's id, with this owner's key: the hash doesn't match, so no vault.
    await expect(chain.openVault({ agentId: randomUUID(), owner, salt })).rejects.toThrow(/AgentIdMismatch/);
    // The right id, but claimed for a different owner: the same refusal. Not even
    // the settler can record anyone but the owner this id belongs to.
    const impostor = Keypair.generate().publicKey.toBase58();
    await expect(chain.openVault({ agentId: id, owner: impostor, salt })).rejects.toThrow(/AgentIdMismatch/);
    // A house id can't be passed off as owned either.
    const house = newAgentId(null);
    await expect(chain.openVault({ agentId: house.id, owner, salt: house.salt })).rejects.toThrow(/AgentIdMismatch/);

    await chain.openVault({ agentId: id, owner, salt });
    expect(await chain.ownerOf(id)).toBe(owner);
    expect(agentIdFor(owner, salt)).toBe(id);
  });

  it("caps what one vault can pay out through settlements in a window", async () => {
    await clearOfTheHour();
    // A vault this size is governed by the floor: a quarter of 180 is less.
    const payer = await houseVault(180 * CHIP);
    const payee = await houseVault(10 * CHIP);
    const bystander = await houseVault(180 * CHIP);
    let paid = 0;
    while (paid + MAX <= OUTFLOW_FLOOR) {
      await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: MAX });
      paid += MAX;
    }
    expect(await chain.vaultBalance(payer)).toBe(180 * CHIP - OUTFLOW_FLOOR);
    // Its window is spent, though the vault still holds enough to pay.
    await expect(chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: 1 * CHIP })).rejects.toThrow(
      /OutflowLimit/,
    );
    expect(await chain.vaultBalance(payer)).toBe(180 * CHIP - OUTFLOW_FLOOR);
    // The limit is per vault: everyone else carries on settling.
    await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: bystander, toAgent: payee, amount: MAX });
    expect(await chain.vaultBalance(bystander)).toBe(120 * CHIP);
    // And it cannot be dodged by paying a different vault.
    const elsewhere = await houseVault(10 * CHIP);
    await expect(
      chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: elsewhere, amount: 1 * CHIP }),
    ).rejects.toThrow(/OutflowLimit/);
  });

  it("lets a large vault pay out more than the floor, in proportion to what it holds", async () => {
    await clearOfTheHour();
    const payer = await houseVault(MAX_SETTLEMENT_CEILING);
    const payee = await houseVault(10 * CHIP);
    // The cap is read from the balance before each settlement leaves, so it
    // falls as the vault pays: at 900 the first window allows three matches at
    // MAX (caps of 225, 210, 195 against 60, 120, 180 spent), and the fourth
    // asks 240 of a cap that has fallen to 180.
    const schedule = [
      { cap: outflowCap(900 * CHIP), after: 840 * CHIP },
      { cap: outflowCap(840 * CHIP), after: 780 * CHIP },
      { cap: outflowCap(780 * CHIP), after: 720 * CHIP },
    ];
    let paid = 0;
    for (const step of schedule) {
      expect(paid + MAX).toBeLessThanOrEqual(step.cap);
      await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: MAX });
      paid += MAX;
      expect(await chain.vaultBalance(payer)).toBe(step.after);
    }
    // More than a flat floor would ever have allowed, and still a quarter-ish.
    expect(paid).toBe(180 * CHIP);
    expect(paid).toBeGreaterThan(OUTFLOW_FLOOR);
    expect(paid + MAX).toBeGreaterThan(outflowCap(720 * CHIP));
    await expect(chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: MAX })).rejects.toThrow(
      /OutflowLimit/,
    );
    expect(await chain.vaultBalance(payer)).toBe(720 * CHIP);
  });

  it("settles a match between vaults and records it once", async () => {
    const [a, b] = [await houseVault(180 * CHIP), await houseVault(180 * CHIP)];
    const match = randomUUID();

    await chain.settle({ day: todayUtc(), matchId: match, fromAgent: a, toAgent: b, amount: 42 * CHIP });
    expect(await chain.vaultBalance(a)).toBe(138 * CHIP);
    expect(await chain.vaultBalance(b)).toBe(222 * CHIP);
    expect(await chain.isSettled(match)).toBe(true);

    const record = await chain.program.account.settlement.fetch(pdas.settlement(match));
    expect(record.amount.toNumber()).toBe(42 * CHIP);

    // The same match cannot move money twice, even with a different amount.
    await expect(chain.settle({ day: todayUtc(), matchId: match, fromAgent: a, toAgent: b, amount: 1 * CHIP })).rejects.toThrow();
    expect(await chain.vaultBalance(a)).toBe(138 * CHIP);
  });

  it("refuses more than the per-match limit, even from the settler", async () => {
    const [a, b] = [await houseVault(180 * CHIP), await houseVault(180 * CHIP)];
    await expect(chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: a, toAgent: b, amount: MAX + 1 })).rejects.toThrow(
      /OverLimit|per-match limit/,
    );
    expect(await chain.vaultBalance(a)).toBe(180 * CHIP);
  });

  it("refuses a vault that cannot cover it, and a self-settlement", async () => {
    const [poor, rich] = [await houseVault(10 * CHIP), await houseVault(180 * CHIP)];
    await expect(chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: poor, toAgent: rich, amount: 11 * CHIP })).rejects.toThrow(
      /InsufficientVault|cannot cover/,
    );
    await expect(chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: rich, toAgent: rich, amount: 5 * CHIP })).rejects.toThrow();
  });

  it("refuses anyone but the settler", async () => {
    const intruder = Keypair.generate();
    await airdrop(intruder, 2);
    const rogue = new ChainClient(connection, intruder, stakeMint, TOKEN);
    const [a, b] = [await houseVault(180 * CHIP), await houseVault(180 * CHIP)];

    const mine = newAgentId(null);
    await expect(rogue.openVault({ agentId: mine.id, owner: null, salt: mine.salt })).rejects.toThrow(
      /NotSettler|settler/,
    );
    await expect(rogue.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: a, toAgent: b, amount: 10 * CHIP })).rejects.toThrow(
      /NotSettler|settler/,
    );
    expect(await chain.vaultBalance(a)).toBe(180 * CHIP);
  });

  describe("net settlement", () => {
    const day = () => todayUtc();
    const pay = (agentId: string, batch: number, amount: number, via: ChainClient = chain) =>
      via.settleNet({ agentId, batch, amount, pays: true, day: day() });
    const receive = (agentId: string, batch: number, amount: number, via: ChainClient = chain) =>
      via.settleNet({ agentId, batch, amount, pays: false, day: day() });

    beforeAll(async () => {
      await chain.openClearing();
    });

    it("opens one clearing account, empty, and only once", async () => {
      expect(await chain.clearingBalance()).toBe(0);
      expect(await refusal(() => chain.openClearing())).not.toBe("");
    });

    it("moves an hour's losses into clearing and its wins out, and leaves clearing as it found it", async () => {
      const [a, b, c] = [await houseVault(300 * CHIP), await houseVault(300 * CHIP), await houseVault(300 * CHIP)];
      // Over the hour a lost 50 and b lost 10, and c won the 60 between them.
      await pay(a, 1, 50 * CHIP);
      await pay(b, 1, 10 * CHIP);
      expect(await chain.clearingBalance()).toBe(60 * CHIP);
      await receive(c, 1, 60 * CHIP);
      expect(await chain.clearingBalance()).toBe(0);
      expect([await chain.vaultBalance(a), await chain.vaultBalance(b), await chain.vaultBalance(c)]).toEqual([
        250 * CHIP,
        290 * CHIP,
        360 * CHIP,
      ]);
      expect([await chain.netBatch(a), await chain.netBatch(c)]).toEqual([1, 1]);
    });

    it("takes each agent's settlements once and in order, whichever way they move", async () => {
      const [a, b] = [await houseVault(300 * CHIP), await houseVault(300 * CHIP)];
      await pay(a, 1, 20 * CHIP);
      // The same batch again: a retry after a lost confirmation, refused rather than paid twice.
      expect(await refusal(() => pay(a, 1, 20 * CHIP))).toMatch(/BatchOutOfOrder/);
      // A gap: a period skipped would never be paid.
      expect(await refusal(() => receive(a, 3, 20 * CHIP))).toMatch(/BatchOutOfOrder/);
      // The next one, the other way.
      await receive(a, 2, 20 * CHIP);
      expect(await chain.netBatch(a)).toBe(2);
      // The count is per agent: b starts at one.
      expect(await refusal(() => pay(b, 2, 1 * CHIP))).toMatch(/BatchOutOfOrder/);
      expect(await chain.vaultBalance(a)).toBe(300 * CHIP);
      expect(await chain.clearingBalance()).toBe(0);
    });

    it("refuses a win clearing cannot cover yet, and pays it once the losses land", async () => {
      const [loser, winner] = [await houseVault(300 * CHIP), await houseVault(300 * CHIP)];
      expect(await refusal(() => receive(winner, 1, 30 * CHIP))).toMatch(/ClearingShort/);
      // Refused whole: the batch was not used up.
      expect(await chain.netBatch(winner)).toBe(0);
      await pay(loser, 1, 30 * CHIP);
      await receive(winner, 1, 30 * CHIP);
      expect(await chain.vaultBalance(winner)).toBe(330 * CHIP);
    });

    it("holds a payment to the vault's hourly outflow, shared with per-match settlement", async () => {
      await clearOfTheHour();
      // Governed by the floor: a quarter of 180 is less than 120.
      const payer = await houseVault(180 * CHIP);
      const payee = await houseVault(10 * CHIP);
      await chain.settle({ day: day(), matchId: randomUUID(), fromAgent: payer, toAgent: payee, amount: MAX });
      // One cap, whichever instruction the money leaves by.
      expect(await refusal(() => pay(payer, 1, OUTFLOW_FLOOR - MAX + 1))).toMatch(/OutflowLimit/);
      await pay(payer, 1, OUTFLOW_FLOOR - MAX);
      expect(await refusal(() => pay(payer, 2, 1))).toMatch(/OutflowLimit/);
      // A win is not outflow: the same agent can still be paid.
      await pay(payee, 1, 10 * CHIP);
      await receive(payer, 2, 10 * CHIP);
      await receive(payee, 2, OUTFLOW_FLOOR - MAX);
      expect(await chain.clearingBalance()).toBe(0);
    });

    it("is not held to the per-match limit: an hour's net is many matches", async () => {
      await clearOfTheHour();
      const [a, b] = [await houseVault(900 * CHIP), await houseVault(10 * CHIP)];
      // Three worst matches' worth, inside a quarter of 900.
      await pay(a, 1, 3 * MAX);
      await receive(b, 1, 3 * MAX);
      expect(await chain.vaultBalance(b)).toBe(10 * CHIP + 3 * MAX);
    });

    it("refuses anyone but the settler, and a vault that cannot cover it", async () => {
      const intruder = Keypair.generate();
      await airdrop(intruder, 2);
      const rogue = new ChainClient(connection, intruder, stakeMint, TOKEN);
      const poor = await houseVault(10 * CHIP);
      expect(await refusal(() => pay(poor, 1, 5 * CHIP, rogue))).toMatch(/NotSettler|settler/);
      expect(await refusal(() => pay(poor, 1, 11 * CHIP))).toMatch(/InsufficientVault/);
      expect(await refusal(() => pay(poor, 1, 0))).toMatch(/ZeroAmount/);
      expect(await chain.vaultBalance(poor)).toBe(10 * CHIP);
    });
  });

  // The ledger-to-chain round trip is pending the funding flow. `createAgent`
  // still writes a 900-chip rental seed and an open_vault op, and under this
  // program opening a vault funds nothing, so the ledger and the vault would
  // disagree by exactly the seed. It comes back in the commit that makes a
  // rental a deposit. `drainChainOps` and `reconcile` keep their coverage
  // against a fake chain in test/outbox.test.ts meanwhile.
  it.todo("carries a run of real matches from the ledger to the chain, and they agree");

  describe("withdrawals", () => {
    /** A funded vault whose owner the program recorded as it opened. */
    const ownedVault = (amount = 180) => playerVault(amount);
    /** Builds with the settler's co-signature, adds the owner's, sends. */
    async function withdraw(
      input: { agent: string; owner: Keypair; amount: number; remaining: number; id?: string },
      signAs: Keypair = input.owner,
      via: ChainClient = chain,
    ) {
      const prepared = await via.prepareWithdrawal({
        withdrawalId: input.id ?? randomUUID(),
        agentId: input.agent,
        owner: input.owner.publicKey.toBase58(),
        amount: input.amount,
        remaining: input.remaining,
      });
      prepared.transaction.partialSign(signAs);
      const raw = prepared.transaction.serialize();
      return { raw, signature: await via.submitWithdrawal(raw, prepared.lastValidBlockHeight) };
    }

    it("records the owner as the vault opens, and never another", async () => {
      const { agent, owner } = await ownedVault(50 * CHIP);
      expect(await chain.ownerOf(agent)).toBe(owner.publicKey.toBase58());
      // The record comes with the vault, and a vault opens once: there is no second chance to name an owner.
      const { id, salt } = newAgentId(owner.publicKey.toBase58());
      expect(id).not.toBe(agent);
      await expect(
        chain.openVault({ agentId: agent, owner: owner.publicKey.toBase58(), salt }),
      ).rejects.toThrow();
      expect(await chain.ownerOf(agent)).toBe(owner.publicKey.toBase58());
      // A house vault has no owner, so nothing can ever be withdrawn from it.
      expect(await chain.ownerOf(await houseVault(10 * CHIP))).toBeNull();
    });

    it("pays the owner, leaves the vault where the ledger says, and emits an event", async () => {
      const { agent, owner } = await ownedVault(180 * CHIP);
      const id = randomUUID();
      const { signature } = await withdraw({ agent, owner, amount: 50 * CHIP, remaining: 130 * CHIP, id });
      expect(await chain.vaultBalance(agent)).toBe(130 * CHIP);
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(50 * CHIP);

      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const events = [...new EventParser(PROGRAM_ID, chain.program.coder).parseLogs(tx!.meta!.logMessages!)];
      const withdrawn = events.find((e) => e.name === "withdrawn")!;
      expect(withdrawn).toBeDefined();
      expect(Array.from(withdrawn.data.withdrawalId as number[])).toEqual(uuidBytes(id));
      expect((withdrawn.data.owner as { toBase58(): string }).toBase58()).toBe(owner.publicKey.toBase58());
      expect(Number(withdrawn.data.amount)).toBe(50 * CHIP);
      expect(Number(withdrawn.data.remaining)).toBe(130 * CHIP);
    });

    it("refuses anyone but the recorded owner, even with the settler co-signing", async () => {
      const { agent } = await ownedVault(100 * CHIP);
      const thief = Keypair.generate();
      await expect(withdraw({ agent, owner: thief, amount: 40 * CHIP, remaining: 60 * CHIP })).rejects.toThrow(/Error Code: NotOwner\b/);
      expect(await chain.vaultBalance(agent)).toBe(100 * CHIP);
    });

    it("refuses the owner alone: the settler must co-sign", async () => {
      const { agent, owner } = await ownedVault(100 * CHIP);
      await airdrop(owner, 1);
      // The owner builds it themselves, as settler and owner both: the program wants the configured settler.
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);
      await expect(withdraw({ agent, owner, amount: 40 * CHIP, remaining: 60 * CHIP }, owner, asOwner)).rejects.toThrow(/Error Code: NotSettler/);
      expect(await chain.vaultBalance(agent)).toBe(100 * CHIP);
    });

    it("refuses to pay into anyone else's token account", async () => {
      const { agent, owner } = await ownedVault(100 * CHIP);
      const prepared = await chain.prepareWithdrawal({
        withdrawalId: randomUUID(),
        agentId: agent,
        owner: owner.publicKey.toBase58(),
        amount: 40 * CHIP,
        remaining: 60 * CHIP,
      });
      // Swap the destination for another wallet's account, then sign it all again.
      const other = Keypair.generate().publicKey;
      const { createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");
      const otherAta = chain.tokenAccount(other);
      const ix = prepared.transaction.instructions[1]!;
      const dest = ix.keys.findIndex((k) => k.pubkey.equals(chain.tokenAccount(owner.publicKey)));
      ix.keys[dest] = { ...ix.keys[dest]!, pubkey: otherAta };
      prepared.transaction.instructions[0] = createAssociatedTokenAccountIdempotentInstruction(settler.publicKey, otherAta, other, stakeMint, TOKEN);
      prepared.transaction.signatures = prepared.transaction.signatures.map((s) => ({ ...s, signature: null }));
      prepared.transaction.partialSign(settler, owner);
      await expect(chain.submitWithdrawal(prepared.transaction.serialize(), prepared.lastValidBlockHeight)).rejects.toThrow(/Error Code: NotOwnersAccount/);
      expect(await chain.vaultBalance(agent)).toBe(100 * CHIP);
    });

    it("refuses while the vault disagrees with the ledger: a match is still settling", async () => {
      const { agent, owner } = await ownedVault(100 * CHIP);
      // The ledger already took a 20-chip loss the chain hasn't settled yet: it thinks 80 remain after 30 out.
      await expect(withdraw({ agent, owner, amount: 30 * CHIP, remaining: 50 * CHIP })).rejects.toThrow(/Error Code: LedgerMismatch/);
      expect(await chain.vaultBalance(agent)).toBe(100 * CHIP);
    });

    it("refuses to leave a vault that can't play: nothing, or at least the minimum stake", async () => {
      const { agent, owner } = await ownedVault(100 * CHIP);
      await expect(withdraw({ agent, owner, amount: 95 * CHIP, remaining: 5 * CHIP })).rejects.toThrow(/Error Code: Unplayable/);
      expect(await chain.vaultBalance(agent)).toBe(100 * CHIP);
      await withdraw({ agent, owner, amount: 90 * CHIP, remaining: 10 * CHIP });
      expect(await chain.vaultBalance(agent)).toBe(10 * CHIP);
    });

    it("takes the lot on a full withdrawal", async () => {
      const { agent, owner } = await ownedVault(70 * CHIP);
      await withdraw({ agent, owner, amount: 70 * CHIP, remaining: 0 });
      expect(await chain.vaultBalance(agent)).toBe(0);
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(70 * CHIP);
    });

    it("never pays twice: not the same bytes again, not the same withdrawal id again", async () => {
      const { agent, owner } = await ownedVault(100 * CHIP);
      const id = randomUUID();
      const { raw } = await withdraw({ agent, owner, amount: 40 * CHIP, remaining: 60 * CHIP, id });
      // The same signed transaction again: the network knows it, and the vault doesn't move.
      await chain.submitWithdrawal(raw, (await connection.getLatestBlockhash()).lastValidBlockHeight).catch(() => undefined);
      expect(await chain.vaultBalance(agent)).toBe(60 * CHIP);
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(40 * CHIP);
      // A fresh transaction reusing the withdrawal id: its record already exists.
      await expect(withdraw({ agent, owner, amount: 40 * CHIP, remaining: 20 * CHIP, id })).rejects.toThrow(/already in use/);
      expect(await chain.vaultBalance(agent)).toBe(60 * CHIP);
      expect(await chain.isWithdrawn(id)).toBe(true);
    });
  });

  describe("renting, as one transaction", () => {
    const ANCHOR_TABLE = packPolicy(snapshotPreset("Anchor"));

    /** Builds the rental, adds the owner's signature to the settler's, sends. */
    async function rent(
      owner: Keypair,
      input: { deposit: number; fee?: number; rentalId?: string; agentId?: string; salt?: string; table?: bigint; lossBudget?: number },
    ) {
      const made = newAgentId(owner.publicKey.toBase58());
      const prepared = await chain.prepareRental({
        rentalId: input.rentalId ?? randomUUID(),
        agentId: input.agentId ?? made.id,
        owner: owner.publicKey.toBase58(),
        salt: input.salt ?? made.salt,
        fee: input.fee ?? RENT,
        deposit: input.deposit,
        table: input.table ?? ANCHOR_TABLE,
        lossBudget: input.lossBudget ?? Math.floor(input.deposit / 3),
      });
      prepared.transaction.partialSign(owner);
      const signature = await chain.submitRental(prepared.transaction.serialize(), prepared.lastValidBlockHeight);
      return { agent: input.agentId ?? made.id, signature };
    }

    /** A wallet holding tokens, ready to rent. */
    async function walletWith(holding: number): Promise<Keypair> {
      const key = Keypair.generate();
      await airdrop(key, 1);
      const ata = (await getOrCreateAssociatedTokenAccount(connection, admin, stakeMint, key.publicKey, false, undefined, undefined, TOKEN)).address;
      await transfer(connection, admin, treasury, ata, admin, holding, [], undefined, TOKEN);
      return key;
    }

    it("burns the fee, opens the vault and moves the deposit, in one go", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const supply = Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply);

      const { agent } = await rent(owner, { deposit: 2_000 * CHIP });

      // The deposit is in the vault, the fee has left the supply, and the
      // owner paid exactly the two together.
      expect(await chain.vaultBalance(agent)).toBe(2_000 * CHIP);
      expect(Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply)).toBe(supply - RENT);
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(3_000 * CHIP - 2_000 * CHIP - RENT);
      // And the owner is recorded, which is what lets them withdraw later.
      expect(await chain.ownerOf(agent)).toBe(owner.publicKey.toBase58());
    });

    it("charges nothing at all when the owner cannot cover the fee and the deposit", async () => {
      // Enough for the deposit alone, or the fee alone, but not both.
      const owner = await walletWith(RENT + 500 * CHIP);
      const before = await chain.tokenBalance(owner.publicKey.toBase58());
      const supply = Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply);
      const made = newAgentId(owner.publicKey.toBase58());

      await expect(
        rent(owner, { deposit: 600 * CHIP, agentId: made.id, salt: made.salt }),
      ).rejects.toThrow();

      // This is the whole reason the three travel together: no fee was burned,
      // no vault was opened, and the owner is exactly as they were.
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(before);
      expect(Number((await getMint(connection, stakeMint, undefined, TOKEN)).supply)).toBe(supply);
      expect(await chain.vaultBalance(made.id)).toBeNull();
      expect(await chain.ownerOf(made.id)).toBeNull();
    });

    it("refuses without the owner's signature, so renting cannot happen behind their back", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const made = newAgentId(owner.publicKey.toBase58());
      const prepared = await chain.prepareRental({
        rentalId: randomUUID(),
        agentId: made.id,
        owner: owner.publicKey.toBase58(),
        salt: made.salt,
        fee: RENT,
        deposit: 1_000 * CHIP,
        table: ANCHOR_TABLE,
        lossBudget: 300 * CHIP,
      });
      // The settler has signed; nobody else has. The network will not take it.
      await expect(
        chain.submitRental(prepared.transaction.serialize({ requireAllSignatures: false }), prepared.lastValidBlockHeight),
      ).rejects.toThrow();
      expect(await chain.vaultBalance(made.id)).toBeNull();
    });

    it("rents once: the same rental id cannot be charged again", async () => {
      const owner = await walletWith(4_000 * CHIP);
      const rentalId = randomUUID();
      await rent(owner, { deposit: 1_000 * CHIP, rentalId });
      const spent = await chain.tokenBalance(owner.publicKey.toBase58());
      // A second rental reusing the id: its record already exists, so the whole
      // transaction fails - including the fee and the deposit.
      await expect(rent(owner, { deposit: 1_000 * CHIP, rentalId })).rejects.toThrow();
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(spent);
    });

    it("commits the owner's strategy table with the rental, readable back exactly", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const mirage = packPolicy(snapshotPreset("Mirage"));
      const { agent } = await rent(owner, { deposit: 1_000 * CHIP, table: mirage });
      const committed = await chain.strategyOf(agent);
      expect(committed?.table).toBe(mirage);
      expect(unpackPolicy(committed!.table)).toEqual(snapshotPreset("Mirage"));
    });

    it("refuses a table the game cannot play, and then charges nothing", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const before = await chain.tokenBalance(owner.publicKey.toBase58());
      const made = newAgentId(owner.publicKey.toBase58());
      // A raise facing a raise (cell 20), where there is no re-raise.
      const reraise = ANCHOR_TABLE | (2n << 40n);
      expect(
        await refusal(() => rent(owner, { deposit: 500 * CHIP, agentId: made.id, salt: made.salt, table: reraise })),
      ).toMatch(/InvalidStrategy/);
      // Bits above the thirtieth cell: one table, one encoding.
      expect(
        await refusal(() => rent(owner, { deposit: 500 * CHIP, agentId: made.id, salt: made.salt, table: ANCHOR_TABLE | (1n << 60n) })),
      ).toMatch(/InvalidStrategy/);
      // The commitment travels with the rental, so a bad one stops all of it.
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(before);
      expect(await chain.vaultBalance(made.id)).toBeNull();
    });

    it("fixes the table for good: it cannot be committed again", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const { agent } = await rent(owner, { deposit: 1_000 * CHIP });
      // The owner themselves, trying to swap in another table after renting.
      const again = await chain.commitStrategyInstruction({
        agentId: agent,
        owner: owner.publicKey,
        table: packPolicy(snapshotPreset("Bully")),
      });
      const tx = new Transaction().add(again);
      expect(await refusal(() => sendWith(tx, [owner]))).toMatch(/already in use/);
      expect((await chain.strategyOf(agent))?.table).toBe(ANCHOR_TABLE);
    });

    it("takes a table only under the recorded owner's signature, never the settler's alone", async () => {
      // An owned vault with no table yet, as every agent rented before this has.
      const owner = Keypair.generate();
      const made = newAgentId(owner.publicKey.toBase58());
      await chain.openVault({ agentId: made.id, owner: owner.publicKey.toBase58(), salt: made.salt });
      expect(await chain.strategyOf(made.id)).toBeNull();

      // Someone else signing as the owner: the program checks the recorded one.
      const stranger = Keypair.generate();
      const forged = await chain.commitStrategyInstruction({ agentId: made.id, owner: stranger.publicKey, table: ANCHOR_TABLE });
      expect(await refusal(() => sendWith(new Transaction().add(forged), [stranger]))).toMatch(/NotOwner/);

      // The settler naming the real owner without their signature: not signed, not sent.
      const unsigned = await chain.commitStrategyInstruction({ agentId: made.id, owner: owner.publicKey, table: ANCHOR_TABLE });
      expect(await refusal(() => sendWith(new Transaction().add(unsigned), []))).not.toBe("");
      expect(await chain.strategyOf(made.id)).toBeNull();

      // The owner's own signature: taken.
      await sendWith(new Transaction().add(unsigned), [owner]);
      expect((await chain.strategyOf(made.id))?.table).toBe(ANCHOR_TABLE);
    });

    describe("the owner's daily loss budget", () => {
      /** A signed change to an agent's budget, sent. */
      async function setBudget(agent: string, signer: Keypair, perDay: number) {
        const ix = await chain.setLossBudgetInstruction({ agentId: agent, owner: signer.publicKey, perDay });
        return sendWith(new Transaction().add(ix), [signer]);
      }
      const today = () => utcDay(new Date());

      it("starts every rental with a third of its deposit a day", async () => {
        const owner = await walletWith(3_000 * CHIP);
        const { agent } = await rent(owner, { deposit: 900 * CHIP });
        const budget = await chain.lossBudgetOf(agent);
        expect(budget).toMatchObject({ perDay: 300 * CHIP, nextPerDay: 300 * CHIP, nextFromDay: 0 });
      });

      it("refuses a loss past the day's budget, and counts a win against the losses", async () => {
        const loser = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP, lossBudget: 100 * CHIP });
        const winner = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP });
        const lose = (amount: number) =>
          chain.settle({ day: today(), matchId: randomUUID(), fromAgent: loser.agent, toAgent: winner.agent, amount });

        await lose(60 * CHIP);
        // 60 + 50 is past 100: refused, and nothing moved.
        expect(await refusal(() => lose(50 * CHIP))).toMatch(/LossBudgetExceeded/);
        expect(await chain.vaultBalance(loser.agent)).toBe(940 * CHIP);

        // A win the same day offsets it: it is net loss that is capped.
        await chain.settle({ day: today(), matchId: randomUUID(), fromAgent: winner.agent, toAgent: loser.agent, amount: 30 * CHIP });
        await lose(50 * CHIP);
        expect(await refusal(() => lose(21 * CHIP))).toMatch(/LossBudgetExceeded/);
        expect(await chain.vaultBalance(loser.agent)).toBe(920 * CHIP);
      });

      it("takes a budgeted settlement dated today or the two days before, and nothing else", async () => {
        const loser = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP });
        const winner = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP });
        const dated = (day: number) =>
          chain.settle({ day, matchId: randomUUID(), fromAgent: loser.agent, toAgent: winner.agent, amount: 10 * CHIP });
        expect(await refusal(() => dated(today() + 1))).toMatch(/SettlementDayOutOfRange/);
        expect(await refusal(() => dated(today() - 3))).toMatch(/SettlementDayOutOfRange/);
        await dated(today() - 2);
        await dated(today());
        expect(await chain.vaultBalance(loser.agent)).toBe(980 * CHIP);
      });

      it("leaves an agent with no budget exactly as before, however old the day", async () => {
        const a = await houseVault(500 * CHIP);
        const b = await houseVault(500 * CHIP);
        await chain.settle({ day: today() - 30, matchId: randomUUID(), fromAgent: a, toAgent: b, amount: 40 * CHIP });
        expect(await chain.vaultBalance(b)).toBe(540 * CHIP);
        expect(await chain.lossBudgetOf(a)).toBeNull();
      });

      it("is the owner's to set: a raise applies now, a cut from tomorrow", async () => {
        const owner = await walletWith(3_000 * CHIP);
        const { agent } = await rent(owner, { deposit: 900 * CHIP });

        expect(await refusal(() => setBudget(agent, Keypair.generate(), 5 * CHIP))).toMatch(/NotOwner/);
        expect((await chain.lossBudgetOf(agent))?.perDay).toBe(300 * CHIP);

        await setBudget(agent, owner, 500 * CHIP);
        expect(await chain.lossBudgetOf(agent)).toMatchObject({ perDay: 500 * CHIP, nextFromDay: 0 });

        // A cut waits a day, so nothing already agreed today can be stranded.
        await setBudget(agent, owner, 100 * CHIP);
        expect(await chain.lossBudgetOf(agent)).toMatchObject({ perDay: 500 * CHIP, nextPerDay: 100 * CHIP, nextFromDay: today() + 1 });
      });

      it("charges a net payment to the day's budget, and counts a net receipt against it", async () => {
        const loser = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP, lossBudget: 100 * CHIP });
        const winner = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP });
        const net = (agentId: string, batch: number, amount: number, pays: boolean) =>
          chain.settleNet({ agentId, batch, amount, pays, day: today() });
        await net(loser.agent, 1, 80 * CHIP, true);
        expect(await refusal(() => net(loser.agent, 2, 30 * CHIP, true))).toMatch(/LossBudgetExceeded/);
        await net(winner.agent, 1, 80 * CHIP, false);
        // A receipt the same day makes room, as a won match does.
        await net(winner.agent, 2, 30 * CHIP, true);
        await net(loser.agent, 2, 30 * CHIP, false);
        await net(loser.agent, 3, 50 * CHIP, true);
        expect(await refusal(() => net(loser.agent, 4, 1 * CHIP, true))).toMatch(/LossBudgetExceeded/);
        await net(winner.agent, 3, 50 * CHIP, false);
        expect(await chain.clearingBalance()).toBe(0);
      });

      it("cannot be dodged by naming some other account as the budget", async () => {
        const loser = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP, lossBudget: 10 * CHIP });
        const winner = await rent(await walletWith(3_000 * CHIP), { deposit: 1_000 * CHIP });
        const decoy = await houseVault(100 * CHIP);
        // The payer's budget swapped for an agent that has none: a stolen
        // settler key's first idea. The address is derived from the paying
        // agent, so the program refuses it outright.
        const attempt = chain.program.methods
          .settle(uuidBytes(randomUUID()), uuidBytes(loser.agent), uuidBytes(winner.agent), new BN(40 * CHIP), new BN(today()))
          .accountsPartial({
            settler: settler.publicKey,
            fromBudget: pdas.budget(decoy),
            toBudget: pdas.budget(winner.agent),
            mint: stakeMint,
            tokenProgram: TOKEN,
          })
          .rpc();
        expect(await refusal(() => attempt)).toMatch(/ConstraintSeeds|seeds constraint/);
        expect(await chain.vaultBalance(loser.agent)).toBe(1_000 * CHIP);
      });
    });

    it("refuses an agent id that is not this owner's", async () => {
      const owner = await walletWith(3_000 * CHIP);
      const before = await chain.tokenBalance(owner.publicKey.toBase58());
      // An id derived from somebody else's key: the program checks the hash, so
      // the vault cannot be opened and the fee is not burned either.
      const notTheirs = newAgentId(Keypair.generate().publicKey.toBase58());
      await expect(
        rent(owner, { deposit: 500 * CHIP, agentId: notTheirs.id, salt: notTheirs.salt }),
      ).rejects.toThrow(/AgentIdMismatch/);
      expect(await chain.tokenBalance(owner.publicKey.toBase58())).toBe(before);
    });
  });

  /**
   * The owner-signed exit: `request_exit`, a window, `claim_exit`.
   *
   * Everything here is signed by the **owner's** keypair and nothing else. A
   * ChainClient built around an owner is the whole of it, which is the
   * property being tested as much as any assertion below: if these pass, a
   * player can do this with an RPC and a wallet and no server at all.
   *
   * What is not here is a claim actually paying out, because the window is
   * 4,500 slots and the fastest a test validator makes slots is about 25 a
   * second - three minutes of wall clock for one test. The payout arithmetic
   * is `exit_payout`, unit-tested in the program; what these cover is that the
   * lock holds, that only the owner passes, and that the record says what the
   * server will need to read.
   */
  describe("exits nobody co-signs", () => {
    it("records the window and needs no settler", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      const before = await connection.getSlot("confirmed");
      await asOwner.requestExit({ agentId: agent, amount: 300 * CHIP });
      const exit = (await asOwner.exitOf(agent))!;

      expect(exit.amount).toBe(300 * CHIP);
      expect(exit.vaultAtRequest).toBe(900 * CHIP);
      expect(exit.claimedSlot).toBe(0);
      expect(exit.claimedAmount).toBe(0);
      // The configured window, from when it was asked for.
      expect(exit.unlockSlot - exit.requestedSlot).toBe(TEST_EXIT_WINDOW);
      expect(exit.requestedSlot).toBeGreaterThanOrEqual(before);
      // Nothing moved: a request is a clock starting, not a payment.
      expect(await asOwner.vaultBalance(agent)).toBe(900 * CHIP);
    });

    it("is found by a server that was never told the agent's id", async () => {
      // A request moves no money, so nothing short points the server at it.
      // Listing every exit is how it learns one was asked for at all.
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      await new ChainClient(connection, owner, stakeMint, TOKEN).requestExit({ agentId: agent, amount: 200 * CHIP });

      const found = (await chain.exits()).find((e) => e.agentId === agent);
      expect(found).toMatchObject({ agentId: agent, owner: owner.publicKey.toBase58(), amount: 200 * CHIP, claimedSlot: 0 });
    });

    it("refuses a claim before its window has passed", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);
      await asOwner.requestExit({ agentId: agent, amount: 900 * CHIP });

      await expect(asOwner.claimExit(agent)).rejects.toThrow(/ExitLocked/);
      expect(await asOwner.vaultBalance(agent)).toBe(900 * CHIP);
    });

    it("allows one live exit per agent, so a second request cannot reset the clock", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);
      await asOwner.requestExit({ agentId: agent, amount: 100 * CHIP });
      const first = (await asOwner.exitOf(agent))!;

      // The PDA is seeded by the agent alone, so a second one cannot exist.
      expect(await refusal(() => asOwner.requestExit({ agentId: agent, amount: 900 * CHIP }))).toMatch(
        /already in use|custom program error/i,
      );
      expect((await asOwner.exitOf(agent))!.unlockSlot).toBe(first.unlockSlot);
    });

    it("is the owner's alone: nobody else can start one or claim it", async () => {
      const owner = Keypair.generate();
      const stranger = Keypair.generate();
      await airdrop(owner, 1);
      await airdrop(stranger, 1);
      const { agent } = await playerVault(900 * CHIP, owner);

      const asStranger = new ChainClient(connection, stranger, stakeMint, TOKEN);
      expect(await refusal(() => asStranger.requestExit({ agentId: agent, amount: 900 * CHIP }))).toMatch(/NotOwner/);

      // Nor can the settler, which is the point: this path does not go through us.
      expect(await refusal(() => chain.requestExit({ agentId: agent, amount: 900 * CHIP }))).toMatch(/NotOwner/);
      expect(await asStranger.exitOf(agent)).toBeNull();
    });

    it("cancels an unclaimed exit and gives the rent back", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 900 * CHIP });
      const spent = await connection.getBalance(owner.publicKey, "confirmed");
      await asOwner.closeExit(agent);

      expect(await asOwner.exitOf(agent)).toBeNull();
      // The rent came back, less the fee for the closing transaction.
      expect(await connection.getBalance(owner.publicKey, "confirmed")).toBeGreaterThan(spent);
      // And the agent can start again, with a fresh clock.
      await asOwner.requestExit({ agentId: agent, amount: 50 * CHIP });
      expect((await asOwner.exitOf(agent))!.amount).toBe(50 * CHIP);
    });

    /** Waits until the chain is at or past `slot`. */
    const reachSlot = async (slot: number) => {
      for (let i = 0; i < 200; i++) {
        if ((await connection.getSlot("confirmed")) >= slot) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`the validator never reached slot ${slot}`);
    };

    it("pays the owner once the window has passed, with nobody else signing", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 300 * CHIP });
      await reachSlot((await asOwner.exitOf(agent))!.unlockSlot);
      await asOwner.claimExit(agent);

      // The money is the owner's, and the vault keeps the rest.
      expect(await asOwner.vaultBalance(agent)).toBe(600 * CHIP);
      const held = await connection.getTokenAccountBalance(
        getAssociatedTokenAddressSync(stakeMint, owner.publicKey, false, TOKEN),
        "confirmed",
      );
      expect(Number(held.value.amount)).toBe(300 * CHIP);

      // And the record says so, which is what the server reads to explain the
      // smaller vault rather than alarm about it.
      const exit = (await asOwner.exitOf(agent))!;
      expect(exit.claimedAmount).toBe(300 * CHIP);
      expect(exit.claimedSlot).toBeGreaterThan(0);

      // Once only.
      await expect(asOwner.claimExit(agent)).rejects.toThrow(/ExitAlreadyClaimed/);
    });

    it("pays what is left when a settlement took some of it in the window", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const winner = await houseVault(0);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 900 * CHIP });
      // The agent loses while the exit waits. This is the race the window
      // exists for, and the settlement wins it.
      await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: agent, toAgent: winner, amount: 60 * CHIP });
      await reachSlot((await asOwner.exitOf(agent))!.unlockSlot);
      await asOwner.claimExit(agent);

      // 840, not 900, and not a refusal: it takes what is there.
      expect((await asOwner.exitOf(agent))!.claimedAmount).toBe(840 * CHIP);
      expect(await asOwner.vaultBalance(agent)).toBe(0);
      expect(await chain.vaultBalance(winner)).toBe(60 * CHIP);
    });

    it("takes the lot rather than leaving dust it could never play", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      // MIN_STAKE is 10 chips, so asking for 895 of 900 would leave 5.
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 895 * CHIP });
      await reachSlot((await asOwner.exitOf(agent))!.unlockSlot);
      await asOwner.claimExit(agent);

      expect((await asOwner.exitOf(agent))!.claimedAmount).toBe(900 * CHIP);
      expect(await asOwner.vaultBalance(agent)).toBe(0);
    });

    it("keeps a claimed exit on chain until the ledger has had time to read it", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 900 * CHIP });
      await reachSlot((await asOwner.exitOf(agent))!.unlockSlot);
      await asOwner.claimExit(agent);

      // Closing now would erase the only evidence that the vault is smaller
      // for a good reason, and the reconciler would alarm forever.
      await expect(asOwner.closeExit(agent)).rejects.toThrow(/ExitEvidenceNeeded/);

      await reachSlot((await asOwner.exitOf(agent))!.claimedSlot + TEST_EXIT_WINDOW);
      await asOwner.closeExit(agent);
      expect(await asOwner.exitOf(agent)).toBeNull();
    });

    it("will not accept a window of zero, or be walked down to one in a step", async () => {
      const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
      expect(await asAdmin.exitWindow()).toBe(TEST_EXIT_WINDOW);

      // Zero is not a short guarantee, it is none: request and claim in the
      // same block, with no room for a settlement between them.
      await expect(asAdmin.setExitWindow(0)).rejects.toThrow(/ExitWindowTooShort/);
      await expect(asAdmin.setExitWindow(9)).rejects.toThrow(/ExitWindowTooShort/);

      // Growing is free; shrinking goes by halves.
      await asAdmin.setExitWindow(4_500);
      await expect(asAdmin.setExitWindow(2_249)).rejects.toThrow(/ExitWindowShrinkTooFast/);
      await asAdmin.setExitWindow(2_250);
      expect(await asAdmin.exitWindow()).toBe(2_250);

      // Only the admin.
      await expect(chain.setExitWindow(2_000)).rejects.toThrow(/NotAdmin/);

      // Put it back for anything that runs after this.
      for (const s of [1_125, 563, 282, 141, 71, 36, 18, 12]) await asAdmin.setExitWindow(s);
      expect(await asAdmin.exitWindow()).toBe(TEST_EXIT_WINDOW);
    });

    it("lets settlements through while an exit waits, which is what the window is for", async () => {
      const owner = Keypair.generate();
      await airdrop(owner, 1);
      const { agent } = await playerVault(900 * CHIP, owner);
      const winner = await houseVault(0);
      const asOwner = new ChainClient(connection, owner, stakeMint, TOKEN);

      await asOwner.requestExit({ agentId: agent, amount: 900 * CHIP });
      // The agent loses a match. The exit is live and does not block it.
      await chain.settle({ day: todayUtc(), matchId: randomUUID(), fromAgent: agent, toAgent: winner, amount: 60 * CHIP });

      expect(await asOwner.vaultBalance(agent)).toBe(840 * CHIP);
      // The request still says 900, and the vault says 840. The gap is the
      // settlement, and exit_payout is what turns it into 840 paid rather than
      // a refusal - which is the whole reason the claim clamps.
      const exit = (await asOwner.exitOf(agent))!;
      expect(exit.amount).toBe(900 * CHIP);
      expect(exit.vaultAtRequest).toBe(900 * CHIP);
      expect(exit.vaultAtRequest - (await asOwner.vaultBalance(agent))!).toBe(60 * CHIP);
    });
  });

  describe("handing the admin key on", () => {
    it("takes a proposal from the admin and an acceptance from the proposed key, and nothing less", async () => {
      const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
      const next = Keypair.generate();
      await airdrop(next, 1);
      const asNext = new ChainClient(connection, next, stakeMint, TOKEN);

      // Only the admin proposes, and only a key that is not already a role.
      expect(await refusal(() => chain.proposeAdmin(next.publicKey))).toMatch(/NotAdmin/);
      for (const taken of [admin.publicKey, settler.publicKey, PublicKey.default]) {
        expect(await refusal(() => asAdmin.proposeAdmin(taken))).toMatch(/InvalidAdmin/);
      }
      await asAdmin.proposeAdmin(next.publicKey);
      expect(await chain.proposedAdmin()).toBe(next.publicKey.toBase58());

      // Proposed is not admin: nothing has changed until it accepts.
      expect(await refusal(() => asNext.setSettler(Keypair.generate().publicKey))).toMatch(/NotAdmin/);
      // And nobody else can accept for it.
      const stranger = Keypair.generate();
      await airdrop(stranger, 1);
      expect(await refusal(() => new ChainClient(connection, stranger, stakeMint, TOKEN).acceptAdmin())).toMatch(/NotProposedAdmin/);

      await asNext.acceptAdmin();
      expect((await chain.config()).admin.toBase58()).toBe(next.publicKey.toBase58());
      expect(await chain.proposedAdmin()).toBeNull();
      // The old admin has no power left the moment the new one accepts.
      expect(await refusal(() => asAdmin.setSettler(Keypair.generate().publicKey))).toMatch(/NotAdmin/);

      // Handed straight back, by the same two steps, for the tests that follow.
      await asNext.proposeAdmin(admin.publicKey);
      await asAdmin.acceptAdmin();
      expect((await chain.config()).admin.toBase58()).toBe(admin.publicKey.toBase58());
    });

    it("can be withdrawn before it is accepted", async () => {
      const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
      const next = Keypair.generate();
      await airdrop(next, 1);
      await asAdmin.proposeAdmin(next.publicKey);
      await asAdmin.cancelAdminHandover();
      expect(await chain.proposedAdmin()).toBeNull();
      expect(await refusal(() => new ChainClient(connection, next, stakeMint, TOKEN).acceptAdmin())).not.toBe("");
      expect((await chain.config()).admin.toBase58()).toBe(admin.publicKey.toBase58());
    });
  });

  // Note for anything added below: this block moves the chip rate, and
  // max_settlement follows it. A test appended after this one is playing at
  // half the limits the ones above it use.
  describe("the season rate", () => {
    /** Mirrors the program's ceiling on tokens per chip. */
    const MAX_CHIP_RATE = 1_000 * CHIP;

    // Last in the file, and it leaves the rate where it found it: a test added
    // after it still plays at the rate the ones above it use.
    it("lets the rate rise freely under the ceiling, and fall by at most half a step, with no wait", async () => {
      const asAdmin = new ChainClient(connection, admin, stakeMint, TOKEN);
      // The settler cannot move the rate; this is the admin's alone.
      await expect(chain.setChipRate(CHIP)).rejects.toThrow(/NotAdmin/);
      // Nor can it be zero, nor cost more than the ceiling on tokens per chip.
      await expect(asAdmin.setChipRate(0)).rejects.toThrow(/InvalidLimit/);
      await expect(asAdmin.setChipRate(MAX_CHIP_RATE + 1)).rejects.toThrow(/RateCeiling/);
      // Down by more than half in one step: refused.
      await expect(asAdmin.setChipRate(CHIP / 2 - 1)).rejects.toThrow(/RateMoveTooBig/);
      expect((await chain.config()).chipRate.toNumber()).toBe(CHIP);

      // Up tenfold - the token having crashed - in one transaction, where the
      // old rule allowed half as much again once every six days. max_settlement
      // follows the rate, so it still means band C's 60 chips.
      await asAdmin.setChipRate(10 * CHIP);
      let config = await chain.config();
      expect(config.chipRate.toNumber()).toBe(10 * CHIP);
      expect(config.maxSettlement.toNumber()).toBe(60 * 10 * CHIP);

      // Back down by halves, each step straight after the last: no interval.
      for (const next of [5 * CHIP, 2.5 * CHIP, 1.25 * CHIP, CHIP]) await asAdmin.setChipRate(next);
      config = await chain.config();
      expect(config.chipRate.toNumber()).toBe(CHIP);
      expect(config.maxSettlement.toNumber()).toBe(60 * CHIP);
    });
  });
});
