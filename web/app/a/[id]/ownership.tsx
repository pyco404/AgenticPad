"use client";

import { CopyButton } from "@/app/copy-button";

export function AgentOwnership({ wallet, mint, cluster }: {
  wallet: string; mint: string | null; cluster: "mainnet-beta" | "devnet" | null;
}) {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return (
    <div className="border-b border-line p-3 text-[12px]">
      <p className="text-muted">Owner wallet</p>
      <p className="mt-1 break-all font-mono">{wallet}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <CopyButton value={wallet} label="Copy address" />
        {cluster ? <a href={`https://solscan.io/account/${encodeURIComponent(wallet)}${suffix}`} target="_blank" rel="noreferrer" className="text-accent underline">View wallet on Solscan ↗</a> : null}
      </div>
      {mint ? <>
        <p className="mt-3 text-muted">Qualifying token mint</p>
        <p className="mt-1 break-all font-mono">{mint}</p>
        <div className="mt-2"><CopyButton value={mint} label="Copy token mint" /></div>
        {cluster ? <a href={`https://solscan.io/token/${encodeURIComponent(mint)}${suffix}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-accent underline">View token on Solscan ↗</a> : null}
      </> : null}
    </div>
  );
}
