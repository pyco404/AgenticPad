import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
// From bn.js directly: under plain Node ESM, @coral-xyz/anchor only exposes BN
// on its default export, so a named import works in vitest and fails in tsx.
import BN from "bn.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { uuidBytes, uuidFromBytes, type PreparedWithdrawal } from "./common.js";
import { DEVNET_CHIP_RATE, STAKE_DECIMALS } from "../chips.js";
import idl from "./idl.json" with { type: "json" };
import type { OxudeSettlement } from "./idl-types.js";

/**
 * Client for the deposit-funded settlement program: the one the Rust in
 * `chain/` builds, whose stake token is an ordinary mint made outside it with
 * no mint authority left. Nothing here can create currency; a vault holds only
 * what somebody deposited or what it won from another vault.
 *
 * Everything that signs for the program's own powers signs with the settler
 * key; nothing an agent or a model produces ever reaches a signature. Amounts
 * arrive already validated by the off-chain ledger, in base units, and the
 * program checks their bounds again.
 *
 * The seed-funded program it replaces is frozen beside it
 * (src/chain/seed-settlement.ts) and still settles the agents rented under it.
 */

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** Where an upgradeable program keeps its code and names its upgrade authority. */
export const programDataOf = (programId: PublicKey) =>
  PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];

/**
 * Every amount crossing this client is in base units - never chips - so a
 * caller holding chips converts first, at the season's rate. Re-exported from
 * src/chips.ts, which owns the conversion and which the ledger can import
 * without pulling an Anchor client in behind it.
 */
export { STAKE_DECIMALS, DEVNET_CHIP_RATE };

export const pdas = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0],
  vault: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  settlement: (matchId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("settlement"), Buffer.from(uuidBytes(matchId))], PROGRAM_ID)[0],
  owner: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("owner"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  withdrawal: (withdrawalId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("withdrawal"), Buffer.from(uuidBytes(withdrawalId))], PROGRAM_ID)[0],
  outflow: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("outflow"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  rental: (rentalId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("rental"), Buffer.from(uuidBytes(rentalId))], PROGRAM_ID)[0],
  /**
   * An agent's exit. Seeded by the agent alone, so anyone holding an agent id
   * can find it - which is what lets the server explain a shrunken vault
   * without having been told an id it never chose.
   */
  exitConfig: () => PublicKey.findProgramAddressSync([Buffer.from("exit_config")], PROGRAM_ID)[0],
  exit: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("exit"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  /** A proposed admin handover, waiting for the proposed key to accept. */
  adminHandover: () => PublicKey.findProgramAddressSync([Buffer.from("admin_handover")], PROGRAM_ID)[0],
  /** The agent's daily loss budget, set by its owner. */
  budget: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("budget"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  /** Where net settlement passes through: payments in, receipts out. One per deployment. */
  clearing: () => PublicKey.findProgramAddressSync([Buffer.from("clearing")], PROGRAM_ID)[0],
  /** An agent's count of net settlements, which orders them. */
  position: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("position"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
  /** The strategy table the agent's owner signed at rent. */
  strategy: (agentId: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("strategy"), Buffer.from(uuidBytes(agentId))], PROGRAM_ID)[0],
};

/**
 * An agent's loss budget as the program holds it, in base units. `perDay` is
 * in force now; `nextPerDay` applies from `nextFromDay` (a UTC day number) when
 * that is non-zero - a cut, waiting for the day after it was asked for.
 */
export type LossBudgetState = {
  perDay: number;
  nextPerDay: number;
  nextFromDay: number;
  net: { day: number; net: number }[];
};

/**
 * One agent's net for a period, as `settle_net` takes it. `pays`: it lost over
 * the period, and the amount leaves its vault for clearing; otherwise it won,
 * and the amount comes out of clearing into its vault. `batch` must be one more
 * than the agent's last. Base units.
 */
export type NetSettleInput = { agentId: string; batch: number; amount: number; pays: boolean; day: number };

/** What opening a vault needs: the id, and the owner and salt it was derived from (src/agent-id.ts). */
export type OpenVaultInput = { agentId: string; owner: string | null; salt: string };

/**
 * The token program a mint lives under: whichever program owns the mint
 * account. The stake token may be an SPL Token mint or a Token-2022 one, and
 * nothing else about it says which.
 */
export async function tokenProgramOf(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`no mint at ${mint.toBase58()}`);
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`${mint.toBase58()} is not a token mint: it belongs to ${info.owner.toBase58()}`);
  }
  return info.owner;
}

/** The stake token as the config records it. Read once at startup, then held. */
export async function stakeMintOf(connection: Connection): Promise<PublicKey> {
  const config = await new Program<OxudeSettlement>(
    idl as OxudeSettlement,
    new AnchorProvider(connection, new Wallet(Keypair.generate()), { commitment: "confirmed" }),
  ).account.config.fetch(pdas.config());
  return config.mint;
}

/** An exit as the chain records it. Slots and amounts are the program's own units. */
export type ChainExit = {
  agentId: string;
  owner: string;
  amount: number;
  requestedSlot: number;
  unlockSlot: number;
  vaultAtRequest: number;
  /** 0 until claimed. */
  claimedSlot: number;
  claimedAmount: number;
};

function exitFrom(e: {
  agentId: number[];
  owner: PublicKey;
  amount: BN;
  requestedSlot: BN;
  unlockSlot: BN;
  vaultAtRequest: BN;
  claimedSlot: BN;
  claimedAmount: BN;
}): ChainExit {
  return {
    agentId: uuidFromBytes(e.agentId),
    owner: e.owner.toBase58(),
    amount: Number(e.amount),
    requestedSlot: Number(e.requestedSlot),
    unlockSlot: Number(e.unlockSlot),
    vaultAtRequest: Number(e.vaultAtRequest),
    claimedSlot: Number(e.claimedSlot),
    claimedAmount: Number(e.claimedAmount),
  };
}

export class ChainClient {
  readonly program: Program<OxudeSettlement>;

  constructor(
    readonly connection: Connection,
    readonly signer: Keypair,
    /** The stake token. External to the program, so it has to be told. */
    readonly mint: PublicKey,
    /**
     * The token program the stake token lives under: the original SPL Token
     * program for the devnet mint, Token-2022 for a new pump.fun token. Every
     * token account, transfer and read goes through it. `tokenProgramOf`
     * reads it from the mint, which is the way to be sure.
     */
    readonly tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ) {
    const provider = new AnchorProvider(connection, new Wallet(signer), { commitment: "confirmed" });
    this.program = new Program<OxudeSettlement>(idl as OxudeSettlement, provider);
  }

  /** The owner's associated token account for the stake token. */
  tokenAccount(owner: string | PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(this.mint, typeof owner === "string" ? new PublicKey(owner) : owner, false, this.tokenProgram);
  }

  /**
   * One-time: the config, pointed at the stake token. Signed by the admin,
   * naming the settler. The program refuses a mint that can still be minted.
   */
  async initialize(
    settler: PublicKey,
    maxSettlement: number,
    rent: number,
    chipRate: number,
    upgradeAuthority?: Keypair,
  ): Promise<string> {
    // The program refuses anyone but its upgrade authority. On devnet that is
    // the admin's own key; on mainnet it is a separate one, which signs too.
    const authority = upgradeAuthority ?? this.signer;
    const call = this.program.methods
      .initialize(settler, new BN(maxSettlement), new BN(rent), new BN(chipRate))
      .accountsPartial({
        admin: this.signer.publicKey,
        upgradeAuthority: authority.publicKey,
        programData: programDataOf(PROGRAM_ID),
        config: pdas.config(),
        mint: this.mint,
        systemProgram: SystemProgram.programId,
      });
    return (authority === this.signer ? call : call.signers([authority])).rpc();
  }

  /**
   * Changes the most a single settlement may move. The signer must be the admin
   * recorded on the config; the settler's key cannot do this. Bounded by the
   * program's MAX_SETTLEMENT_CEILING.
   */
  async setMaxSettlement(maxSettlement: number): Promise<string> {
    return this.program.methods
      .setMaxSettlement(new BN(maxSettlement))
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config() })
      .rpc();
  }

  /**
   * Sets the season's rate: base units to one chip. The signer must be the
   * admin. The program holds the number to two bounds of its own - it may rise
   * freely up to `MAX_CHIP_RATE`, and fall to no less than half per call - and
   * rescales max_settlement so it still means the same number of chips. A fall
   * of more than half is several calls (src/chip-rate-plan.ts, rateSteps).
   *
   * Devnet never calls this: the rate is fixed at one chip to one token.
   * scripts/set-season-rate.ts is the way in on mainnet.
   */
  async setChipRate(chipRate: number): Promise<string> {
    return this.program.methods
      .setChipRate(new BN(chipRate))
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config() })
      .rpc();
  }

  /**
   * Sets what renting costs, in base units. The signer must be the admin
   * recorded on the config. On mainnet it follows each rate change, so rent
   * stays $2 (scripts/set-season-rate.ts): set_chip_rate does not rescale it.
   */
  async setRent(rent: number): Promise<string> {
    return this.program.methods
      .setRent(new BN(rent))
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config() })
      .rpc();
  }

  /**
   * The instruction that burns a rental's fee out of the renter's own tokens.
   * Built, not sent: it is the first of the three the owner signs at rent time,
   * so the fee and the agent it paid for can never come apart.
   *
   * `amount` must be the price the config carries. A price that moves while the
   * owner is signing makes this fail rather than charging them more.
   */
  async payRentInstruction(input: { rentalId: string; renter: string | PublicKey; amount: number }): Promise<TransactionInstruction> {
    const renter = typeof input.renter === "string" ? new PublicKey(input.renter) : input.renter;
    return this.program.methods
      .payRent(uuidBytes(input.rentalId), new BN(input.amount))
      .accountsPartial({
        renter,
        settler: this.signer.publicKey,
        config: pdas.config(),
        mint: this.mint,
        source: this.tokenAccount(renter),
        rental: pdas.rental(input.rentalId),
        systemProgram: SystemProgram.programId,
        tokenProgram: this.tokenProgram,
      })
      .instruction();
  }

  /**
   * The whole of renting, as one transaction for the owner to sign: the fee
   * burned, the vault and owner record opened, and the deposit moved in.
   *
   * One transaction because the three cannot be allowed to come apart. A fee
   * burned for a rental that never happened is money taken for nothing; a vault
   * opened without a fee is a free agent. Solana applies a transaction whole or
   * not at all, so there is no half-state to recover from and no ordering to
   * get right - if the owner's balance cannot cover fee plus deposit, all three
   * fail together and nothing was charged.
   *
   * The settler co-signs and pays the account rent, as it does everywhere else
   * here. The owner's signature is the one thing still missing, and giving it
   * is what makes renting prove consent: until now the server created agents
   * for wallets that had signed nothing.
   */
  async prepareRental(input: {
    rentalId: string;
    agentId: string;
    owner: string;
    salt: string;
    /** Base units to burn. Must equal the price the config carries. */
    fee: number;
    /** Base units to move from the owner's wallet into the new vault. */
    deposit: number;
    /**
     * The agent's strategy table, packed (packPolicy). Committed on chain in
     * the same transaction, under the owner's signature, so what the agent
     * plays is fixed by its owner before it plays anything.
     */
    table: bigint;
    /** The daily loss budget to start with, in base units, set under the owner's signature. */
    lossBudget: number;
  }): Promise<PreparedWithdrawal> {
    const owner = new PublicKey(input.owner);
    const salt = Array.from(Buffer.from(input.salt, "hex"));
    const source = this.tokenAccount(owner);

    const fee = await this.payRentInstruction({ rentalId: input.rentalId, renter: owner, amount: input.fee });
    const open = await this.program.methods
      .openOwnedVault(uuidBytes(input.agentId), salt, owner)
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        mint: this.mint,
        vault: pdas.vault(input.agentId),
        agentOwner: pdas.owner(input.agentId),
        systemProgram: SystemProgram.programId,
        tokenProgram: this.tokenProgram,
      })
      .instruction();
    const fund = await this.depositInstruction({ agentId: input.agentId, depositor: owner, amount: input.deposit });
    // After the vault opens, because it checks the owner the vault recorded.
    const commit = await this.commitStrategyInstruction({ agentId: input.agentId, owner, table: input.table });
    const budget = await this.setLossBudgetInstruction({ agentId: input.agentId, owner, perDay: input.lossBudget });

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.signer.publicKey, blockhash, lastValidBlockHeight })
      // The owner may not have an account for the stake token yet if they were
      // sent tokens by some other route; opening it here is idempotent.
      .add(createAssociatedTokenAccountIdempotentInstruction(this.signer.publicKey, source, owner, this.mint, this.tokenProgram))
      .add(fee, open, fund, commit, budget);
    transaction.partialSign(this.signer);
    return { transaction, lastValidBlockHeight };
  }

  /**
   * A top-up: the deposit instruction alone, for the owner to sign. The settler
   * pays the fee, as it does for every transaction it builds here, so an owner
   * topping up needs stake tokens but no SOL.
   */
  async prepareDeposit(input: { agentId: string; owner: string; amount: number }): Promise<PreparedWithdrawal> {
    const owner = new PublicKey(input.owner);
    const fund = await this.depositInstruction({ agentId: input.agentId, depositor: owner, amount: input.amount });
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.signer.publicKey, blockhash, lastValidBlockHeight }).add(fund);
    transaction.partialSign(this.signer);
    return { transaction, lastValidBlockHeight };
  }

  /**
   * Sends a fully signed rental and waits for it. The same bytes twice are
   * harmless: the rental record and the vault can each be created once, so the
   * second attempt is the same transaction and lands or fails as one.
   */
  async submitRental(raw: Uint8Array, lastValidBlockHeight: number): Promise<string> {
    return this.submitWithdrawal(raw, lastValidBlockHeight);
  }

  /** Whether this rental's fee has been paid. Its record exists at most once. */
  async isRentPaid(rentalId: string): Promise<boolean> {
    return (await this.connection.getAccountInfo(pdas.rental(rentalId), "confirmed")) !== null;
  }

  /**
   * Points the config at a new settler key. The signer must be the admin
   * recorded on the config. The program refuses the current settler and the
   * admin's own key, so a rotation is always a real change of hands.
   */
  async setSettler(settler: PublicKey): Promise<string> {
    return this.program.methods
      .setSettler(settler)
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config() })
      .rpc();
  }

  /**
   * Proposes a new admin. The signer must be the current admin; nothing changes
   * until the proposed key accepts with `acceptAdmin`, so a mistyped address
   * can never become the admin.
   */
  async proposeAdmin(proposed: PublicKey): Promise<string> {
    return this.program.methods
      .proposeAdmin(proposed)
      .accountsPartial({
        admin: this.signer.publicKey,
        config: pdas.config(),
        handover: pdas.adminHandover(),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Accepts a proposed handover. The signer must be the proposed key. */
  async acceptAdmin(): Promise<string> {
    const { admin } = await this.config();
    return this.program.methods
      .acceptAdmin()
      .accountsPartial({
        proposed: this.signer.publicKey,
        previousAdmin: admin,
        config: pdas.config(),
        handover: pdas.adminHandover(),
      })
      .rpc();
  }

  /** Withdraws a proposal before it is accepted. The signer must be the current admin. */
  async cancelAdminHandover(): Promise<string> {
    return this.program.methods
      .cancelAdminHandover()
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config(), handover: pdas.adminHandover() })
      .rpc();
  }

  /** The key proposed as the next admin, or null when no handover is waiting. */
  async proposedAdmin(): Promise<string | null> {
    const handover = await this.program.account.adminHandover.fetchNullable(pdas.adminHandover(), "confirmed");
    return handover ? handover.proposed.toBase58() : null;
  }

  /**
   * Opens an agent's vault, empty. A player's agent has its owner recorded in
   * the same instruction; the program checks the id is the hash of that owner
   * and the salt. The money follows in a `deposit`.
   */
  async openVault(input: OpenVaultInput): Promise<string> {
    const salt = Array.from(Buffer.from(input.salt, "hex"));
    const accounts = {
      settler: this.signer.publicKey,
      config: pdas.config(),
      mint: this.mint,
      vault: pdas.vault(input.agentId),
      systemProgram: SystemProgram.programId,
      tokenProgram: this.tokenProgram,
    };
    if (input.owner === null) {
      return this.program.methods.openVault(uuidBytes(input.agentId), salt).accountsPartial(accounts).rpc();
    }
    return this.program.methods
      .openOwnedVault(uuidBytes(input.agentId), salt, new PublicKey(input.owner))
      .accountsPartial({ ...accounts, agentOwner: pdas.owner(input.agentId) })
      .rpc();
  }

  /**
   * The instruction that moves `amount` base units from a wallet into an
   * agent's vault. Built rather than sent, because the depositor is the one who
   * signs it: at rent time it travels with the fee and the vault in one
   * transaction the owner approves, and a top-up is the same instruction alone.
   */
  async depositInstruction(input: { agentId: string; depositor: string | PublicKey; amount: number }): Promise<TransactionInstruction> {
    const depositor = typeof input.depositor === "string" ? new PublicKey(input.depositor) : input.depositor;
    return this.program.methods
      .deposit(uuidBytes(input.agentId), new BN(input.amount))
      .accountsPartial({
        depositor,
        config: pdas.config(),
        source: this.tokenAccount(depositor),
        vault: pdas.vault(input.agentId),
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .instruction();
  }

  /**
   * Deposits from this client's own signer. That is the treasury funding a
   * house agent, never a player: a player's deposit is signed in their wallet.
   */
  /** Turns exits on for this deployment, with the window they wait. Admin only. */
  async initExitConfig(slots: number): Promise<string> {
    return this.program.methods
      .initExitConfig(new BN(slots))
      .accountsPartial({
        admin: this.signer.publicKey,
        config: pdas.config(),
        exitConfig: pdas.exitConfig(),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Moves the exit window. Admin only; grows freely, shrinks by halves. */
  async setExitWindow(slots: number): Promise<string> {
    return this.program.methods
      .setExitWindow(new BN(slots))
      .accountsPartial({ admin: this.signer.publicKey, config: pdas.config(), exitConfig: pdas.exitConfig() })
      .rpc();
  }

  /** The live exit window in slots, or null if exits are not turned on here. */
  async exitWindow(): Promise<number | null> {
    try {
      return Number((await this.program.account.exitConfig.fetch(pdas.exitConfig())).slots);
    } catch {
      return null;
    }
  }

  /**
   * Starts an exit that nobody co-signs.
   *
   * `this.signer` is the **owner** here, not the settler. That is the whole
   * point of these three: build a client around the owner's keypair and every
   * step of an exit is available without this server existing at all.
   */
  async requestExit(input: { agentId: string; amount: number }): Promise<string> {
    return this.program.methods
      .requestExit(uuidBytes(input.agentId), new BN(input.amount))
      .accountsPartial({
        owner: this.signer.publicKey,
        config: pdas.config(),
        exitConfig: pdas.exitConfig(),
        agentOwner: pdas.owner(input.agentId),
        vault: pdas.vault(input.agentId),
        exit: pdas.exit(input.agentId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Claims an exit whose window has passed. Owner-signed, no settler. */
  async claimExit(agentId: string): Promise<string> {
    const destination = this.tokenAccount(this.signer.publicKey);
    return this.program.methods
      .claimExit(uuidBytes(agentId))
      .accountsPartial({
        owner: this.signer.publicKey,
        config: pdas.config(),
        agentOwner: pdas.owner(agentId),
        vault: pdas.vault(agentId),
        destination,
        exit: pdas.exit(agentId),
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          this.signer.publicKey,
          destination,
          this.signer.publicKey,
          this.mint,
          this.tokenProgram,
        ),
      ])
      .rpc();
  }

  /** Cancels an unclaimed exit, or clears a claimed one once its record has served. */
  async closeExit(agentId: string): Promise<string> {
    return this.program.methods
      .closeExit(uuidBytes(agentId))
      .accountsPartial({ owner: this.signer.publicKey, exitConfig: pdas.exitConfig(), exit: pdas.exit(agentId) })
      .rpc();
  }

  /**
   * An agent's exit as the chain has it, or null if there is none.
   *
   * This is the reconciler's evidence: `claimedAmount` on a claimed exit is
   * what turns "this vault holds less than the ledger says" from an alarm into
   * an explanation.
   */
  async exitOf(agentId: string): Promise<ChainExit | null> {
    try {
      return exitFrom(await this.program.account.exit.fetch(pdas.exit(agentId)));
    } catch {
      return null;
    }
  }

  /**
   * Every exit the program holds, requested or claimed.
   *
   * This is how the server finds out an exit was asked for at all. A request
   * moves no money, so no vault is short and nothing else here would ever look
   * at that agent's exit address - and the request is exactly the moment the
   * agent has to stop playing. One call for the lot, rather than one per agent.
   */
  async exits(): Promise<ChainExit[]> {
    return (await this.program.account.exit.all()).map((e) => exitFrom(e.account));
  }

  async deposit(input: { agentId: string; amount: number }): Promise<string> {
    return this.program.methods
      .deposit(uuidBytes(input.agentId), new BN(input.amount))
      .accountsPartial({
        depositor: this.signer.publicKey,
        config: pdas.config(),
        source: this.tokenAccount(this.signer.publicKey),
        vault: pdas.vault(input.agentId),
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  async settle(input: { matchId: string; fromAgent: string; toAgent: string; amount: number; day: number }): Promise<string> {
    return this.program.methods
      .settle(
        uuidBytes(input.matchId),
        uuidBytes(input.fromAgent),
        uuidBytes(input.toAgent),
        new BN(input.amount),
        new BN(input.day),
      )
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        fromVault: pdas.vault(input.fromAgent),
        toVault: pdas.vault(input.toAgent),
        outflow: pdas.outflow(input.fromAgent),
        settlement: pdas.settlement(input.matchId),
        // Always passed, at their fixed addresses: the program charges one if
        // it exists there, so leaving one off is not a way around it.
        fromBudget: pdas.budget(input.fromAgent),
        toBudget: pdas.budget(input.toAgent),
        systemProgram: SystemProgram.programId,
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  /** Opens the clearing account net settlement passes through. Once per deployment; the settler pays. */
  async openClearing(): Promise<string> {
    return this.program.methods
      .openClearing()
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        mint: this.mint,
        clearing: pdas.clearing(),
        systemProgram: SystemProgram.programId,
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  async settleNet(input: NetSettleInput): Promise<string> {
    return this.program.methods
      .settleNet(uuidBytes(input.agentId), new BN(input.batch), new BN(input.amount), input.pays, new BN(input.day))
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        vault: pdas.vault(input.agentId),
        clearing: pdas.clearing(),
        outflow: pdas.outflow(input.agentId),
        position: pdas.position(input.agentId),
        // At its fixed address, like settle's: charged if it exists there.
        budget: pdas.budget(input.agentId),
        systemProgram: SystemProgram.programId,
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  /** The number of the agent's last net settlement on chain; 0 before its first. */
  async netBatch(agentId: string): Promise<number> {
    const position = await this.program.account.position.fetchNullable(pdas.position(agentId), "confirmed");
    return position ? position.batch.toNumber() : 0;
  }

  /** What the clearing account holds, or null before it is opened. Base units. */
  async clearingBalance(): Promise<number | null> {
    try {
      const account = await getAccount(this.connection, pdas.clearing(), "confirmed", this.tokenProgram);
      return Number(account.amount);
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) return null;
      throw error;
    }
  }

  /** The owner-signed instruction that sets an agent's daily loss budget, in base units. */
  async setLossBudgetInstruction(input: { agentId: string; owner: PublicKey; perDay: number }): Promise<TransactionInstruction> {
    return this.program.methods
      .setLossBudget(uuidBytes(input.agentId), new BN(input.perDay))
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        owner: input.owner,
        agentOwner: pdas.owner(input.agentId),
        budget: pdas.budget(input.agentId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Builds a change to an agent's loss budget for its owner to sign. The
   * settler pays; the owner's signature is the one still missing.
   */
  async prepareLossBudget(input: { agentId: string; owner: string; perDay: number }): Promise<PreparedWithdrawal> {
    const ix = await this.setLossBudgetInstruction({ agentId: input.agentId, owner: new PublicKey(input.owner), perDay: input.perDay });
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.signer.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    transaction.partialSign(this.signer);
    return { transaction, lastValidBlockHeight };
  }

  /** An agent's loss budget as the program holds it, or null when it has none. Base units. */
  async lossBudgetOf(agentId: string): Promise<LossBudgetState | null> {
    const b = await this.program.account.lossBudget.fetchNullable(pdas.budget(agentId), "confirmed");
    if (!b) return null;
    return {
      perDay: b.perDay.toNumber(),
      nextPerDay: b.nextPerDay.toNumber(),
      nextFromDay: b.nextFromDay.toNumber(),
      net: b.days.map((day, i) => ({ day: day.toNumber(), net: b.net[i]!.toNumber() })),
    };
  }

  /**
   * What a vault holds, or null if it does not exist.
   *
   * Null means **absent**, and nothing else. A read that fails throws, because
   * the two are different facts and the caller acts differently on each: an
   * absent vault where the ledger credits money is a shortfall worth waking
   * somebody for, and an RPC that answered 429 is a Tuesday. Collapsing them
   * into null had the drift alarm reporting healthy vaults as drained every
   * time the endpoint throttled, which is how an alarm teaches people to
   * ignore it.
   */
  async vaultBalance(agentId: string): Promise<number | null> {
    try {
      const account = await getAccount(this.connection, pdas.vault(agentId), "confirmed", this.tokenProgram);
      return Number(account.amount);
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) return null;
      throw error;
    }
  }

  async hasVault(agentId: string): Promise<boolean> {
    return (await this.connection.getAccountInfo(pdas.vault(agentId), "confirmed")) !== null;
  }

  async isSettled(matchId: string): Promise<boolean> {
    return (await this.connection.getAccountInfo(pdas.settlement(matchId), "confirmed")) !== null;
  }

  /** The transaction that created a match's settlement record: the only one that touches it. */
  async settlementSignature(matchId: string): Promise<string | null> {
    const sigs = await this.connection.getSignaturesForAddress(pdas.settlement(matchId), {}, "confirmed");
    return sigs.filter((s) => s.err === null).at(-1)?.signature ?? null;
  }

  async config() {
    return this.program.account.config.fetch(pdas.config());
  }

  /** The owner recorded on chain for an agent, or null if none has been. */
  /** The owner-signed strategy commitment. Needs the owner's signature on the transaction it goes in. */
  async commitStrategyInstruction(input: { agentId: string; owner: PublicKey; table: bigint }): Promise<TransactionInstruction> {
    return this.program.methods
      .commitStrategy(uuidBytes(input.agentId), new BN(input.table.toString()))
      .accountsPartial({
        settler: this.signer.publicKey,
        config: pdas.config(),
        owner: input.owner,
        agentOwner: pdas.owner(input.agentId),
        strategy: pdas.strategy(input.agentId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** The packed table an agent's owner committed at rent, or null for an agent from before tables were committed. */
  async strategyOf(agentId: string): Promise<{ table: bigint; slot: number } | null> {
    const record = await this.program.account.strategy.fetchNullable(pdas.strategy(agentId), "confirmed");
    return record ? { table: BigInt(record.table.toString()), slot: record.slot.toNumber() } : null;
  }

  async ownerOf(agentId: string): Promise<string | null> {
    const record = await this.program.account.agentOwner.fetchNullable(pdas.owner(agentId), "confirmed");
    return record ? record.owner.toBase58() : null;
  }

  /**
   * Builds a withdrawal: make sure the owner has a token account for the stake
   * token, then withdraw into it. The settler pays and co-signs; the owner's
   * signature is the one thing still missing. `remaining` is the ledger's
   * balance after the withdrawal, which the program checks against the vault.
   */
  async prepareWithdrawal(input: {
    withdrawalId: string;
    agentId: string;
    owner: string;
    amount: number;
    remaining: number;
  }): Promise<PreparedWithdrawal> {
    const owner = new PublicKey(input.owner);
    const destination = this.tokenAccount(owner);
    const withdraw = await this.program.methods
      .withdraw(uuidBytes(input.withdrawalId), uuidBytes(input.agentId), new BN(input.amount), new BN(input.remaining))
      .accountsPartial({
        settler: this.signer.publicKey,
        owner,
        config: pdas.config(),
        agentOwner: pdas.owner(input.agentId),
        vault: pdas.vault(input.agentId),
        destination,
        withdrawal: pdas.withdrawal(input.withdrawalId),
        systemProgram: SystemProgram.programId,
        mint: this.mint,
        tokenProgram: this.tokenProgram,
      })
      .instruction();
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.signer.publicKey, blockhash, lastValidBlockHeight }).add(
      createAssociatedTokenAccountIdempotentInstruction(this.signer.publicKey, destination, owner, this.mint, this.tokenProgram),
      withdraw,
    );
    transaction.partialSign(this.signer);
    return { transaction, lastValidBlockHeight };
  }

  /**
   * Sends a fully signed withdrawal and waits for it. Sending the same bytes
   * again is harmless: it is the same transaction, and the withdrawal record
   * means its effect can only happen once.
   */
  async submitWithdrawal(raw: Uint8Array, lastValidBlockHeight: number): Promise<string> {
    const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
    const { recentBlockhash: blockhash } = Transaction.from(raw);
    const result = await this.connection.confirmTransaction(
      { signature, blockhash: blockhash!, lastValidBlockHeight },
      "confirmed",
    );
    if (result.value.err) throw new Error(`withdrawal failed on chain: ${JSON.stringify(result.value.err)}`);
    return signature;
  }

  async isWithdrawn(withdrawalId: string): Promise<boolean> {
    return (await this.connection.getAccountInfo(pdas.withdrawal(withdrawalId), "confirmed")) !== null;
  }

  /** True once no transaction built before now can land any more. */
  async blockHeightPassed(lastValidBlockHeight: number): Promise<boolean> {
    return (await this.connection.getBlockHeight("confirmed")) > lastValidBlockHeight;
  }

  async tokenBalance(owner: string): Promise<number> {
    try {
      return Number((await getAccount(this.connection, this.tokenAccount(owner), "confirmed", this.tokenProgram)).amount);
    } catch {
      return 0;
    }
  }
}
