import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import { Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ChainClient, PROGRAM_ID, pdas as realPdas } from "../src/chain/settlement.js";
import { Connection } from "@solana/web3.js";
import { uuidBytes } from "../src/chain/common.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inlined } from "../scripts/inline-exit.js";

// The page carries exit.mjs inside its own script, so that a copy saved to disk
// works opened directly (a browser won't load a module from file://). These
// tests run against *that* copy - the code the page actually executes - loaded
// out of index.html, and the first check below holds it to exit.mjs exactly.
const PAGE = readFileSync(new URL("../web/public/exit/index.html", import.meta.url), "utf8");
const LIBRARY = readFileSync(new URL("../web/public/exit/exit.mjs", import.meta.url), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "agentclash-exit-"));
writeFileSync(join(scratch, "inlined.mjs"), inlined(PAGE));
const exitPage = (await import(pathToFileURL(join(scratch, "inlined.mjs")).href)) as typeof import("../web/public/exit/exit.mjs");

describe("the page's own copy of the library", () => {
  it("is exit.mjs, byte for byte", () => {
    // If this fails: npm run exit:inline
    expect(inlined(PAGE)).toBe(LIBRARY);
  });

  it("parses as one module with the page's script, so no name in one shadows the other", () => {
    // The library and the page share a scope. A top-level name defined in both
    // is an early error that stops the whole script - the page would do nothing.
    const script = PAGE.slice(PAGE.indexOf('<script type="module">') + '<script type="module">'.length, PAGE.lastIndexOf("</script>"));
    const file = join(scratch, "page-script.mjs");
    writeFileSync(file, script);
    expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
  });
});

/**
 * The standalone exit page owes nothing to this repo at runtime: no npm, no
 * CDN, no build. That means it carries its own base58, its own ed25519 curve
 * check, its own address derivation and its own transaction serializer.
 *
 * Duplication like that is usually a bad idea, and it is only tolerable
 * because of this file. Every primitive is held against @solana/web3.js and
 * the real IDL here, so the copy cannot drift from the original without the
 * suite saying so. A page that builds a subtly wrong transaction is worse
 * than no page: it fails on the day someone needs it.
 */

describe("base58, against the library everyone else uses", () => {
  it("round-trips every byte pattern that matters", () => {
    const cases = [
      new Uint8Array(32),
      Uint8Array.from({ length: 32 }, (_, i) => i),
      Uint8Array.from([0, 0, 0, 1]),
      Uint8Array.from([255, 255, 255, 255]),
      new Uint8Array(0),
    ];
    for (const bytes of cases) {
      expect(exitPage.base58Encode(bytes)).toBe(bs58.encode(bytes));
      expect(Array.from(exitPage.base58Decode(bs58.encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("agrees on a thousand random keys, leading zeros included", () => {
    for (let i = 0; i < 1000; i++) {
      const bytes = Keypair.generate().publicKey.toBytes();
      if (i % 10 === 0) bytes[0] = 0;
      expect(exitPage.base58Encode(bytes)).toBe(bs58.encode(bytes));
      expect(Array.from(exitPage.base58Decode(exitPage.base58Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe("the ed25519 curve check", () => {
  it("says yes to real public keys, which have private keys behind them", () => {
    for (let i = 0; i < 200; i++) {
      expect(exitPage.isOnCurve(Keypair.generate().publicKey.toBytes())).toBe(true);
    }
  });

  it("says no to program addresses, which is what makes them program addresses", async () => {
    for (let i = 0; i < 50; i++) {
      const pda = realPdas.vault(randomUUID());
      expect(exitPage.isOnCurve(pda.toBytes())).toBe(false);
      expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    }
  });

  it("agrees with the library on random bytes, on or off the curve", () => {
    for (let i = 0; i < 500; i++) {
      const bytes = Keypair.generate().secretKey.slice(0, 32);
      expect(exitPage.isOnCurve(bytes)).toBe(PublicKey.isOnCurve(bytes));
    }
  });
});

describe("addresses", () => {
  it("derives the same PDAs the server does, for every seed the page uses", async () => {
    for (let i = 0; i < 25; i++) {
      const agentId = randomUUID();
      expect((await exitPage.pdas.vault(agentId))[0]).toBe(realPdas.vault(agentId).toBase58());
      expect((await exitPage.pdas.owner(agentId))[0]).toBe(realPdas.owner(agentId).toBase58());
      expect((await exitPage.pdas.exit(agentId))[0]).toBe(realPdas.exit(agentId).toBase58());
    }
    expect((await exitPage.pdas.config())[0]).toBe(realPdas.config().toBase58());
    expect((await exitPage.pdas.exitConfig())[0]).toBe(realPdas.exitConfig().toBase58());
  });

  it("finds the same associated token account, under either token program", async () => {
    for (let i = 0; i < 25; i++) {
      const owner = Keypair.generate().publicKey;
      const mint = Keypair.generate().publicKey;
      expect(await exitPage.associatedTokenAddress(owner.toBase58(), mint.toBase58())).toBe(
        getAssociatedTokenAddressSync(mint, owner).toBase58(),
      );
      // Token-2022 accounts live at different addresses for the same owner and mint.
      expect(await exitPage.associatedTokenAddress(owner.toBase58(), mint.toBase58(), exitPage.TOKEN_2022_PROGRAM_ID)).toBe(
        getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID).toBase58(),
      );
    }
  });

  it("uses the program id this repo builds", () => {
    expect(exitPage.PROGRAM_ID).toBe(PROGRAM_ID.toBase58());
    expect(exitPage.TOKEN_PROGRAM_ID).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(exitPage.TOKEN_2022_PROGRAM_ID).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
  });
});

describe("the transaction the wallet is asked to sign", () => {
  const blockhash = Keypair.generate().publicKey.toBase58();

  /** The same instruction, built with @solana/web3.js, for byte comparison. */
  const asLibrary = (ix: { programId: string; keys: { pubkey: string; signer: boolean; writable: boolean }[]; data: Uint8Array }) =>
    new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.signer, isWritable: k.writable })),
      data: Buffer.from(ix.data),
    });

  it("serializes byte for byte the same as the library, for a request", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const agentId = randomUUID();
    const ix = await exitPage.requestExitIx({ owner, agentId, amount: 300_000_000 });

    const mine = exitPage.buildMessage({ payer: owner, instructions: [ix], recentBlockhash: blockhash });
    const theirs = new Transaction({ feePayer: new PublicKey(owner), recentBlockhash: blockhash })
      .add(asLibrary(ix))
      .serializeMessage();
    expect(Buffer.from(mine).toString("hex")).toBe(theirs.toString("hex"));
  });

  it("hands the wallet a whole unsigned transaction, byte for byte the library's", async () => {
    // A wallet decodes what it is given as a transaction. The bare message,
    // decoded that way, ran out of bytes: "Reached end of buffer unexpectedly".
    const owner = Keypair.generate().publicKey.toBase58();
    const ix = await exitPage.requestExitIx({ owner, agentId: randomUUID(), amount: 300_000_000 });
    const message = exitPage.buildMessage({ payer: owner, instructions: [ix], recentBlockhash: blockhash });

    const mine = exitPage.unsignedTransaction(message);
    const theirs = new Transaction({ feePayer: new PublicKey(owner), recentBlockhash: blockhash })
      .add(asLibrary(ix))
      .serialize({ requireAllSignatures: false, verifySignatures: false });
    expect(Buffer.from(mine).toString("hex")).toBe(theirs.toString("hex"));
    // And it decodes the way a wallet decodes it, which the bare message does not reliably.
    expect(() => VersionedTransaction.deserialize(mine)).not.toThrow();
    expect(Transaction.from(Buffer.from(mine)).serializeMessage().toString("hex")).toBe(Buffer.from(message).toString("hex"));
  });

  it("serializes byte for byte the same for a claim and a close", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const destination = Keypair.generate().publicKey.toBase58();
    const agentId = randomUUID();
    for (const ix of [
      await exitPage.claimExitIx({ owner, agentId, destination, mint: Keypair.generate().publicKey.toBase58() }),
      await exitPage.closeExitIx({ owner, agentId }),
    ]) {
      const mine = exitPage.buildMessage({ payer: owner, instructions: [ix], recentBlockhash: blockhash });
      const theirs = new Transaction({ feePayer: new PublicKey(owner), recentBlockhash: blockhash })
        .add(asLibrary(ix))
        .serializeMessage();
      expect(Buffer.from(mine).toString("hex")).toBe(theirs.toString("hex"));
    }
  });

  it("builds claim_exit exactly as the program's own IDL does, under either token program", async () => {
    // The page writes its accounts out by hand, so they have to match the
    // program's order and flags exactly - including the mint a checked
    // transfer now names. Anchor builds the reference from the built IDL.
    for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const owner = Keypair.generate();
      const mint = Keypair.generate().publicKey;
      const agentId = randomUUID();
      const client = new ChainClient(new Connection("http://127.0.0.1:1"), owner, mint, tokenProgram);
      const destination = getAssociatedTokenAddressSync(mint, owner.publicKey, false, tokenProgram);
      const theirs = await client.program.methods
        .claimExit(uuidBytes(agentId))
        .accountsPartial({
          owner: owner.publicKey,
          config: realPdas.config(),
          agentOwner: realPdas.owner(agentId),
          vault: realPdas.vault(agentId),
          destination,
          exit: realPdas.exit(agentId),
          mint,
          tokenProgram,
        })
        .instruction();
      const mine = await exitPage.claimExitIx({
        owner: owner.publicKey.toBase58(),
        agentId,
        destination: await exitPage.associatedTokenAddress(owner.publicKey.toBase58(), mint.toBase58(), tokenProgram.toBase58()),
        mint: mint.toBase58(),
        tokenProgram: tokenProgram.toBase58(),
      });
      expect(asLibrary(mine).keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(
        theirs.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      );
      expect(Buffer.from(mine.data).toString("hex")).toBe(theirs.data.toString("hex"));
    }
  });

  it("refuses to build a claim without the mint", async () => {
    await expect(
      exitPage.claimExitIx({ owner: Keypair.generate().publicKey.toBase58(), agentId: randomUUID(), destination: Keypair.generate().publicKey.toBase58() } as never),
    ).rejects.toThrow(/mint/);
  });

  it("agrees on a message with several instructions and a repeated account", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const agentId = randomUUID();
    const ixs = [
      await exitPage.claimExitIx({
        owner,
        agentId,
        destination: Keypair.generate().publicKey.toBase58(),
        mint: Keypair.generate().publicKey.toBase58(),
      }),
      await exitPage.closeExitIx({ owner, agentId }),
      {
        programId: exitPage.SYSTEM_PROGRAM_ID,
        keys: [{ pubkey: owner, signer: true, writable: true }],
        data: new Uint8Array([1, 2, 3]),
      },
    ];
    const mine = exitPage.buildMessage({ payer: owner, instructions: ixs, recentBlockhash: blockhash });
    const tx = new Transaction({ feePayer: new PublicKey(owner), recentBlockhash: blockhash });
    for (const ix of ixs) tx.add(asLibrary(ix));
    expect(Buffer.from(mine).toString("hex")).toBe(tx.serializeMessage().toString("hex"));
  });

  it("carries the discriminators the built IDL declares", async () => {
    const idl = (await import("../src/chain/idl.json", { with: { type: "json" } })).default as {
      instructions: { name: string; discriminator: number[] }[];
    };
    for (const name of ["request_exit", "claim_exit", "close_exit"] as const) {
      const declared = idl.instructions.find((i) => i.name === name)!.discriminator;
      expect(exitPage.DISCRIMINATORS[name]).toEqual(declared);
    }
  });

  it("puts the agent id and the amount where the program reads them", async () => {
    const agentId = randomUUID();
    const ix = await exitPage.requestExitIx({ owner: Keypair.generate().publicKey.toBase58(), agentId, amount: 1 });
    expect(ix.data.length).toBe(8 + 16 + 8);
    expect(exitPage.uuidFromBytes(ix.data.slice(8, 24))).toBe(agentId);
    // u64 little-endian, so a 1 is the first byte after the id.
    expect(Array.from(ix.data.slice(24))).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("encodes a compact-u16 the way the format does, across its boundaries", () => {
    const expected: Record<number, number[]> = {
      0: [0],
      127: [127],
      128: [128, 1],
      255: [255, 1],
      16383: [255, 127],
      16384: [128, 128, 1],
    };
    for (const [n, bytes] of Object.entries(expected)) {
      expect(Array.from(exitPage.compactU16(Number(n)))).toEqual(bytes);
    }
  });
});

describe("reading accounts back", () => {
  it("decodes an Exit the way the program wrote it", () => {
    const agentId = randomUUID();
    const owner = Keypair.generate().publicKey;
    const buf = Buffer.alloc(8 + 16 + 32 + 8 * 6);
    Buffer.from(exitPage.uuidBytes(agentId)).copy(buf, 8);
    owner.toBuffer().copy(buf, 24);
    buf.writeBigUInt64LE(300n, 56);
    buf.writeBigUInt64LE(1000n, 64);
    buf.writeBigUInt64LE(5500n, 72);
    buf.writeBigUInt64LE(900n, 80);
    buf.writeBigUInt64LE(6000n, 88);
    buf.writeBigUInt64LE(300n, 96);

    expect(exitPage.decodeExit(new Uint8Array(buf))).toEqual({
      agentId,
      owner: owner.toBase58(),
      amount: 300,
      requestedSlot: 1000,
      unlockSlot: 5500,
      vaultAtRequest: 900,
      claimedSlot: 6000,
      claimedAmount: 300,
    });
  });

  it("decodes an AgentOwner, which is how the page finds a wallet's agents", () => {
    const agentId = randomUUID();
    const owner = Keypair.generate().publicKey;
    const buf = Buffer.alloc(8 + 16 + 32 + 1);
    Buffer.from(exitPage.uuidBytes(agentId)).copy(buf, 8);
    owner.toBuffer().copy(buf, 24);
    expect(exitPage.decodeAgentOwner(new Uint8Array(buf))).toEqual({ agentId, owner: owner.toBase58() });
  });
});
