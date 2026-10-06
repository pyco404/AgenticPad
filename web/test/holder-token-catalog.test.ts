import { describe, expect, it } from "vitest";
import { LaunchStore, type StoredLaunch } from "../lib/launchpad-store";

function launch(id: string, confirmed = true): StoredLaunch {
  return { id, owner: "private-owner", createdAt: Number(id), mint: `mint-${id}`,
    form: { name: `Token ${id}`, ticker: `T${id}`, description: "", image: "", links: {}, creator: "private-owner", initialBuySol: "0" },
    uri: "ipfs://metadata", imageUrl: "ipfs://image", transaction: "private-transaction", lastValidBlockHeight: 1,
    signature: confirmed ? "confirmed-signature" : null, signed: "private-signed-transaction", confirmed, failure: null };
}

describe("confirmed holder-token catalog", () => {
  it("excludes unfinished launches and exposes only token identities", () => {
    const store = new LaunchStore(":memory:");
    try {
      store.insert(launch("1")); store.insert(launch("2", false));
      store.insert({ ...launch("3"), signature: null });
      expect(store.holderTokens()).toEqual({ network: "mainnet-beta", tokens: [{ mint: "mint-1", symbol: "T1", name: "Token 1" }], nextOffset: null });
    } finally { store.db.close(); }
  });
  it("paginates confirmed identities without skipping or repeating tokens", () => {
    const store = new LaunchStore(":memory:");
    try {
      for (let n = 1; n <= 101; n++) store.insert(launch(String(n)));
      const first = store.holderTokens(); const last = store.holderTokens(first.nextOffset!);
      expect(first.tokens).toHaveLength(100); expect(first.nextOffset).toBe(100);
      expect(last.tokens).toEqual([{ mint: "mint-1", symbol: "T1", name: "Token 1" }]);
      expect(last.nextOffset).toBeNull();
      expect(new Set([...first.tokens, ...last.tokens].map(t => t.mint)).size).toBe(101);
      expect(() => store.holderTokens(-1)).toThrow("Invalid offset");
    } finally { store.db.close(); }
  });
});
