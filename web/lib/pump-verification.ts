import { createPublicKey, verify } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { SharingConfig } from "@pump-fun/pump-sdk";
import { feeWallets } from "./launchpad-config";

/** Wallet approval must preserve every instruction, account and spending cap. */
export function verifySignedLaunch(prepared: string, signed: string): VersionedTransaction {
  const expected = VersionedTransaction.deserialize(Buffer.from(prepared, "base64"));
  const actual = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
  const message = Buffer.from(actual.message.serialize());
  if (!message.equals(Buffer.from(expected.message.serialize()))) throw new Error("The signed launch transaction was changed.");
  for (let i = 0; i < actual.message.header.numRequiredSignatures; i++) {
    const key = actual.message.staticAccountKeys[i]!;
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.toBuffer()]), format: "der", type: "spki" });
    if (!verify(null, message, publicKey, actual.signatures[i]!)) throw new Error("The launch transaction is missing a valid signature.");
  }
  return actual;
}

export function verifyFeeSharing(config: SharingConfig & { status?: Record<string, unknown> }, mint: PublicKey): void {
  // SDK 2.0's public type omits the status that its IDL actually decodes.
  const status = config.status;
  if (config.version !== 2 || !status || !Object.hasOwn(status, "active")) throw new Error("The creator fee configuration is not active.");
  if (!config.mint.equals(mint) || !config.adminRevoked || config.shareholders.length !== feeWallets.length) throw new Error("The creator fee split is not locked as required.");
  for (const wallet of feeWallets) {
    if (!config.shareholders.some((share) => share.address.toBase58() === wallet.address && share.shareBps === wallet.shareBps)) throw new Error("The creator fee recipients or percentages do not match AgenticPad.");
  }
}
