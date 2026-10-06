import { afterEach, describe, expect, it, vi } from "vitest";
import { completeWalletSignIn, prepareWalletSignIn } from "../lib/wallet";

const address = "wallet-address";
function setup() {
  const provider = {
    publicKey: { toBase58: () => address, toString: () => address },
    connect: vi.fn().mockResolvedValue(undefined),
    signMessage: vi.fn().mockResolvedValue({ signature: new Uint8Array(64).fill(1) }),
  };
  vi.stubGlobal("window", { phantom: { solana: provider }, solana: { isPhantom: true, connect: vi.fn() } });
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { setItem });
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "nonce", message: "Login message" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "session", ownerId: address, expiresAt: "2099-01-01" }) });
  vi.stubGlobal("fetch", fetch);
  return { provider, fetch, setItem };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Extension wallet sign-in", () => {
  it("prepares without signing, then opens the actual Phantom prompt synchronously on confirmation", async () => {
    const { provider, fetch, setItem } = setup();
    const pending = await prepareWalletSignIn("Phantom");
    expect(provider.connect).toHaveBeenCalledOnce();
    expect(provider.signMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const signing = completeWalletSignIn(pending);
    expect(provider.signMessage).toHaveBeenCalledWith(new TextEncoder().encode("Login message"), "utf8");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await signing).toMatchObject({ ownerId: address, wallet: "Phantom" });
    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ publicKey: address, nonce: "nonce" });
  });

  it("rejects an account switch before requesting a signature", async () => {
    const { provider, fetch } = setup();
    const pending = await prepareWalletSignIn("Phantom");
    provider.publicKey.toBase58 = () => "another-wallet";
    await expect(completeWalletSignIn(pending)).rejects.toThrow("account changed");
    expect(provider.signMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ends a stalled connection and does not start authentication when it resolves late", async () => {
    vi.useFakeTimers();
    const { provider, fetch } = setup();
    let resolve!: () => void;
    provider.connect.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    const pending = prepareWalletSignIn("Phantom");
    const assertion = expect(pending).rejects.toThrow("did not respond to connection");
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not verify a signature after a stalled signing request times out", async () => {
    vi.useFakeTimers();
    const { provider, fetch, setItem } = setup();
    const challenge = await prepareWalletSignIn("Phantom");
    let resolve!: (value: { signature: Uint8Array }) => void;
    provider.signMessage.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = completeWalletSignIn(challenge);
    const assertion = expect(pending).rejects.toThrow("did not respond to message signing");
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    resolve({ signature: new Uint8Array(64) });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });
});
