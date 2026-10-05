import BN from "bn.js";
import { AddressLookupTableAccount, Keypair } from "@solana/web3.js";
import type { Global } from "@pump-fun/pump-sdk";
import { commonLookupAddresses, launchInstructions } from "../lib/pump-transaction";

export function globalFixture(): Global {
  const recipient = Keypair.generate().publicKey;
  const buyback = Keypair.generate().publicKey;
  return {
    initialVirtualTokenReserves: new BN("1073000000000000"), initialVirtualSolReserves: new BN("30000000000"),
    initialRealTokenReserves: new BN("793100000000000"), tokenTotalSupply: new BN("1000000000000000"),
    feeBasisPoints: new BN(95), creatorFeeBasisPoints: new BN(5),
    mayhemModeEnabled: false, feeRecipient: recipient, feeRecipients: Array(7).fill(recipient),
    reservedFeeRecipients: Array(7).fill(recipient), buybackFeeRecipients: Array(8).fill(buyback),
    buybackBasisPoints: new BN(0), createV2Enabled: true,
  } as Global;
}

export async function sharedTable(global: Global) {
  const user = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const instructions = await launchInstructions({
    form: { name: "Setup", ticker: "SETUP", description: "", image: "", links: {}, creator: user.toBase58(), initialBuySol: "0.1" },
    mint, uri: "https://ipfs.io/ipfs/setup", global, feeConfig: null,
  });
  return new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: {
    deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
    addresses: commonLookupAddresses(instructions, user, mint, global),
  } });
}
