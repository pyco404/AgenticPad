import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, SystemInstruction } from "@solana/web3.js";
import type { BorshInstructionCoder } from "@coral-xyz/anchor";
import { globalFixture } from "./pump-fixture";

describe("Configured launch receiving wallets", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PUMP_RPC_URL", "https://rpc.example.invalid");
    vi.stubEnv("PINATA_JWT", "test-credential");
    vi.stubEnv("PUMP_LOOKUP_TABLE", Keypair.generate().publicKey.toBase58());
    vi.stubEnv("PUMP_LAUNCH_DB_PATH", ":memory:");
    vi.stubEnv("PUMP_LAUNCH_ENABLED", "true");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("uses env wallets for both the platform payment and the fee-sharing instruction", async () => {
    const platform = Keypair.generate().publicKey.toBase58();
    const daily = Keypair.generate().publicKey.toBase58();
    const weekly = Keypair.generate().publicKey.toBase58();
    vi.stubEnv("PUMP_PLATFORM_WALLET", platform);
    vi.stubEnv("PUMP_DAILY_REWARDS_WALLET", daily);
    vi.stubEnv("PUMP_WEEKLY_REWARDS_WALLET", weekly);
    const { launchInstructions } = await import("../lib/pump-transaction");
    const { pumpConfig } = await import("../lib/launchpad-server");
    const { feeWallets } = await import("../lib/launchpad-config");
    const { pump } = await import("../lib/pump-sdk");
    const instructions = await launchInstructions({
      form: { name: "Configured", ticker: "CFG", description: "", image: "", links: {}, initialBuySol: "0", creator: Keypair.generate().publicKey.toBase58() },
      mint: Keypair.generate().publicKey, uri: "https://ipfs.io/ipfs/setup", global: globalFixture(), feeConfig: null,
    });
    expect(SystemInstruction.decodeTransfer(instructions.at(-1)!).toPubkey.toBase58()).toBe(platform);
    expect(feeWallets).toEqual([
      { address: daily, shareBps: 1500 }, { address: weekly, shareBps: 5000 }, { address: platform, shareBps: 3500 },
    ]);
    const coder = pump.getPumpFeeProgram(new Connection("https://rpc.example.invalid")).coder.instruction as BorshInstructionCoder;
    const decoded = coder.decode(instructions[3]!.data)!;
    const data = decoded.data as { shareholders: { address: PublicKey; shareBps: number }[] };
    expect(data.shareholders.map(({ address, shareBps }) => ({ address: address.toBase58(), shareBps }))).toEqual(feeWallets);
    expect(pumpConfig()).toMatchObject({ ready: true, launchFeeRecipient: platform });
  });

  it.each(["invalid", "duplicate"])("disables launching for %s receiving wallets", async (kind) => {
    const platform = Keypair.generate().publicKey.toBase58();
    vi.stubEnv("PUMP_PLATFORM_WALLET", platform);
    vi.stubEnv("PUMP_DAILY_REWARDS_WALLET", kind === "invalid" ? "not-a-wallet" : platform);
    const { pumpConfig } = await import("../lib/launchpad-server");
    expect(pumpConfig().ready).toBe(false);
  });
});
