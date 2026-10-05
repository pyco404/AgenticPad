"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Segmented } from "@/app/ui";
import { launchpad, type LaunchSort, type TokenSummary } from "@/lib/launchpad";
import { Board, FeeSplitBar, formatDate, MockNote, TokenImage, VerificationBadge } from "./parts";
import { useLaunchConfig } from "./use-config";

/** The launchpad's front: what launching means, the way in, and every token launched. */
export function LaunchIndex() {
  const { config } = useLaunchConfig();
  const [sort, setSort] = useState<LaunchSort>("newest");
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    launchpad.listLaunches({ sort, limit: 10 }).then(
      (page) => !gone && setTokens(page.tokens),
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
  }, [sort]);

  return (
    <div className="space-y-3">
      {launchpad.mock ? <MockNote /> : null}
      <Board sign="Launch a token">
        {config ? (
          <>
            <p>
              Launch a token on pump.fun from here. {config.agentsEnabled ? `Every wallet holding at least $${config.minimumUsd} of it gets an agent in the village.` : "Holder-agent activation is planned; launches currently create the token and lock its creator fee split."}
            </p>
            <p className="mt-2">
              <span className="text-accent">Mandatory launch fee: {config.launchFeeLamports / 1_000_000_000} SOL per token.</span>{" "}
              This helps deter spam. Network costs and any optional initial token purchase are additional.
            </p>
            <p className="mt-2">
              <span className="text-accent">
                {config.launcherShare === 0
                  ? "All of its creator fees go to AgenticPad. The launcher keeps none."
                  : `${100 - config.launcherShare}% of its creator fees go to AgenticPad; the launcher keeps ${config.launcherShare}%.`}
              </span>{" "}
              The split is locked at launch.
            </p>
            <div className="mt-3">
              <FeeSplitBar split={config.feeSplit} launcherShare={config.launcherShare} />
            </div>
          </>
        ) : (
          <p className="text-muted">Loading…</p>
        )}
        <Link
          href="/launch/new"
          className="rounded-panel mt-3 flex w-full items-center justify-center bg-accent px-4 py-2.5 text-[14px] font-semibold text-ink hover:bg-accent/90"
        >
          Launch a token
        </Link>
      </Board>

      <Link
        href="/explore"
        className="hud-card flex items-center justify-between gap-2 px-4 py-3 text-[14px] text-accent hover:text-text"
      >
        <span>
          <span className="font-pixel font-bold">Explore</span> <span className="text-muted">· new, hot, top market cap, graduating</span>
        </span>
        <span aria-hidden>→</span>
      </Link>

      <Board
        sign="Latest launches"
        action={
          <div className="w-56">
            <Segmented
              options={[
                { value: "newest", label: "Newest" },
                { value: "agents", label: "Agents in play" },
              ]}
              value={sort}
              onChange={setSort}
            />
          </div>
        }
      >
        {error ? (
          <p className="text-loss">The launches could not be read: {error}</p>
        ) : !tokens ? (
          <p className="text-muted">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-muted">No tokens launched yet.</p>
        ) : (
          <ul className="-my-1 divide-y divide-line">
            {tokens.map((t) => (
              <li key={t.mint}>
                <Link href={`/launch/${t.mint}`} className="group flex items-center gap-3 py-2.5">
                  <TokenImage src={t.image} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate font-pixel text-[16px] font-bold group-hover:text-accent">{t.name}</span>
                      <span className="font-mono text-[12px] text-teal">${t.ticker}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted">
                      <span>
                        <span className="text-text">{t.holders?.toLocaleString("en-US") ?? "—"}</span> holders
                      </span>
                      <span>
                        <span className="text-live">{t.agentsInPlay.toLocaleString("en-US")}</span> agents in play
                      </span>
                      <span>{formatDate(t.launchedAt)}</span>
                    </p>
                  </div>
                  <VerificationBadge v={t.verification} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Board>
    </div>
  );
}
