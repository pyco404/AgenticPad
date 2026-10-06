import { holderPriceReady, holderQuote, liveHolderMinimum, liveHolderPricing } from "../holder-policy.js";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { baseUnits, chips, seasonRate } from "../chips.js";
import type { Db } from "./client.js";
import { agents, holdings, MIN_FUNDING_CHIPS } from "./schema.js";
import { inPlaySql } from "./ledger.js";

/**
 * Holdings: what a wallet holds of the token, which for a holder agent is the
 * whole of its money (docs/holder-agents.md).
 *
 * A holder agent has no vault and no ledger. Its owner keeps their tokens in
 * their own wallet, and the agent exists while that wallet holds at least the
 * minimum. So the server never moves anything here; it only reads, and keeps
 * the last reading per wallet in `holdings`, which every balance check reads
 * (src/db/ledger.ts, balanceSql).
 *
 * Readings are taken when a wallet asks for an agent - fresh, so nobody is
 * turned away on a stale figure - and for every holder on a schedule
 * (refreshHolders), which is what takes an agent out of play when its owner
 * sells below the minimum and back in when they buy back. Between two
 * readings nothing is seen: that is the snapshot gap docs/economy.md's
 * roadmap states.
 */

/** The chain side: reads only, never a signature. */
export type HoldingsChain = {
  /** Base units of the token the wallet holds, across every account it owns for it. */
  /** Empty scope is the configured primary token. Other scopes are launch mints. */
  mint?: string;
  quote?(): { minimum: number; priceUsd: number; decimals: number; at: number } | null;
  balanceOf(wallet: string): Promise<number>;
  /** The token's total supply in base units. */
  supply(): Promise<number>;
  /** Mainnet pricing and mint-wide discovery are read-only provider operations. */
  refreshMinimum?(): Promise<void>;
  discoverWallets?(): Promise<string[]>;
};

/** One wallet's reading off chain. */
export type Reading = { wallet: string; amount: number; supply: number; readAt: Date };

/** A reading as stored, with the conviction clock it keeps. */
export type Holding = Reading & { convictionAmount: number | null; convictionSince: Date | null;
  mint?: string; minimum?: number | null; priceUsd?: number | null; decimals?: number | null; priceAt?: Date | null;
};

export type Clock = { amount: number; since: Date };

/**
 * Conviction on snapshots (docs/holder-agents.md, Conviction): the clock after
 * one more reading.
 *
 * The clock starts at the first reading that holds the minimum, and records
 * the minimum as it stands then, in tokens: that is the wallet's conviction
 * amount. It runs while each reading holds at least that much - topping up
 * never moves it, and a retune of the minimum never touches it, so a price
 * move cannot cost anyone their days. A reading below it resets the clock;
 * if that same reading still holds the minimum as it now stands, a new clock
 * starts there, at the new minimum.
 *
 * Readings are snapshots. A sell and a rebuy between two of them is not seen,
 * and keeps the clock: the gap docs/economy.md's roadmap states.
 */
export function nextClock(clock: Clock | null, amount: number, minimum: number, at: Date): Clock | null {
  if (clock && amount >= clock.amount) return clock;
  return amount >= minimum ? { amount: minimum, since: at } : null;
}

/** Whole days a clock has run by `at`. */
export function convictionDays(since: Date | null, at: Date): number {
  if (!since) return 0;
  return Math.max(0, Math.floor((at.getTime() - since.getTime()) / 86_400_000));
}

/**
 * Whether a wallet holds enough to have an agent: the minimum, or - once its
 * clock is running - its own conviction amount if that is lower. A wallet that
 * qualified keeps its agent as long as it keeps what it qualified with, so a
 * retune that raises the minimum takes nobody out who has not sold.
 */
export function keeps(holding: (Pick<Holding, "amount" | "convictionAmount" | "mint" | "minimum" | "priceAt"> & { readAt?: Date }) | null, minimum: number = holdingMinimum()): boolean {
  if (!holding) return false;
  if (holding.mint) return !!holding.minimum && holding.amount >= holding.minimum
    && !!holding.priceAt && Date.now() - holding.priceAt.getTime() <= 15 * 60_000
    && !!holding.readAt && Date.now() - holding.readAt.getTime() <= 20 * 60_000;
  if (liveHolderPricing() && (!holding.readAt || Date.now() - holding.readAt.getTime() > 20 * 60_000)) return false;
  return holderPriceReady() && holding.amount >= (liveHolderPricing() ? minimum : Math.min(holding.convictionAmount ?? minimum, minimum));
}

/**
 * The least a wallet must hold to have an agent, in base units at the
 * season's rate. Pegged in dollars through the chips (MIN_FUNDING_CHIPS), so
 * it is retuned when the rate is, at a season boundary, and never in between.
 */
export const holdingMinimum = (rate: number = seasonRate()): number => liveHolderMinimum(baseUnits(MIN_FUNDING_CHIPS, rate));

/** A holding as the owner reads it: in chips, beside the minimum it is measured against, with its clock. */
export function holdingView(holding: Holding | null, rate: number = seasonRate(), now = new Date()) {
  const amount = holding?.amount ?? 0;
  const minimum = holding?.mint ? holding.minimum ?? Number.MAX_SAFE_INTEGER : holdingMinimum(rate);
  return {
    /** Base units, and the same in chips. */
    mint: holding?.mint ?? "",
    amount,
    chips: chips(amount, rate),
    minimum,
    minimumChips: chips(minimum, rate),
    minimumUsd: 20,
    valueUsd: holding?.mint ? (holding.priceUsd && holding.decimals != null && holding.priceAt && now.getTime() - holding.priceAt.getTime() <= 15 * 60_000 ? amount / 10 ** holding.decimals * holding.priceUsd : null) : liveHolderPricing() && holderPriceReady() && holderQuote() ? amount / 10 ** holderQuote()!.decimals * holderQuote()!.priceUsd : null,
    priceReady: holding?.mint ? !!holding.priceAt && now.getTime() - holding.priceAt.getTime() <= 15 * 60_000 : holderPriceReady(),
    eligible: keeps(holding, minimum),
    /** Null when this wallet has never been read. */
    readAt: holding?.readAt.toISOString() ?? null,
    conviction: {
      /** What the wallet must keep for its clock to run, in base units and chips; null with no clock. */
      amount: holding?.convictionAmount ?? null,
      chips: holding?.convictionAmount === null || holding?.convictionAmount === undefined ? null : chips(holding.convictionAmount, rate),
      since: holding?.convictionSince?.toISOString() ?? null,
      days: convictionDays(holding?.convictionSince ?? null, now),
    },
  };
}

const fromRow = (row: typeof holdings.$inferSelect): Holding => ({
  ...row,
  amount: Number(row.amount),
  supply: Number(row.supply),
  convictionAmount: row.convictionAmount === null ? null : Number(row.convictionAmount),
});

/**
 * Records a reading and moves the wallet's clock on from its last one. The
 * read and the write share a transaction and a lock on the wallet, so two
 * readings landing together cannot both start a clock.
 */
async function store(db: Db, reading: Reading, minimum: number, chain?: HoldingsChain): Promise<Holding> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`holding:${reading.wallet}:${chain?.mint ?? ""}`}, 0))`);
    const [prev] = await tx.select().from(holdings).where(and(eq(holdings.wallet, reading.wallet), eq(holdings.mint, chain?.mint ?? ""))).limit(1);
    const last = prev ? fromRow(prev) : null;
    const clock = nextClock(
      last?.convictionAmount !== null && last?.convictionAmount !== undefined && last.convictionSince
        ? { amount: last.convictionAmount, since: last.convictionSince }
        : null,
      reading.amount,
      minimum,
      reading.readAt,
    );
    const quote = chain?.quote?.();
    const scoped = chain?.mint ? {
      minimum: quote?.minimum ?? null, priceUsd: quote?.priceUsd ?? null,
      decimals: quote?.decimals ?? null, priceAt: quote ? new Date(quote.at) : null,
    } : {};
    const set = {
      ...scoped,
      amount: reading.amount,
      supply: reading.supply,
      readAt: reading.readAt,
      convictionAmount: clock?.amount ?? null,
      convictionSince: clock?.since ?? null,
    };
    await tx.insert(holdings).values({ wallet: reading.wallet, mint: chain?.mint ?? "", ...set }).onConflictDoUpdate({ target: [holdings.wallet, holdings.mint], set });
    return { wallet: reading.wallet, mint: chain?.mint ?? "", ...set };
  });
}

/** The last reading for a wallet, or null if it has never been read. */
export async function holdingOf(db: Db, wallet: string, mint = ""): Promise<Holding | null> {
  const [row] = await db.select().from(holdings).where(and(eq(holdings.wallet, wallet), eq(holdings.mint, mint))).limit(1);
  return row ? fromRow(row) : null;
}

/**
 * Reads one wallet off chain now and records it. Throws if the chain cannot be
 * read, and records nothing: a failed read is not a reading of zero.
 */
export async function readHolding(
  db: Db,
  chain: HoldingsChain,
  wallet: string,
  now = new Date(),
  minimum?: number,
): Promise<Holding> {
  try { await chain.refreshMinimum?.(); }
  catch { /* Still verify zero balances; eligibility rejects missing or stale prices. */ }
  const [amount, supply] = await Promise.all([chain.balanceOf(wallet), chain.supply()]);
  const threshold = chain.mint ? chain.quote?.()?.minimum ?? Number.MAX_SAFE_INTEGER : minimum ?? holdingMinimum();
  return store(db, { wallet, amount, supply, readAt: now }, threshold, chain);
}

export type RefreshResult = { read: number; failed: { wallet: string; why: string }[] };

/**
 * Reads every wallet behind a holder agent still in play. A wallet whose read
 * fails keeps its last reading - an RPC that throttled says nothing about what
 * the wallet holds - and is reported, so a run of failures is seen rather than
 * quietly leaving everyone on old figures.
 */
export async function refreshHolders(
  db: Db,
  chain: HoldingsChain,
  now = new Date(),
  minimum: number = holdingMinimum(),
): Promise<RefreshResult> {
  try { await chain.refreshMinimum?.(); }
  catch { /* Still verify zero balances; eligibility rejects missing or stale prices. */ }
  if (chain.mint) minimum = chain.quote?.()?.minimum ?? Number.MAX_SAFE_INTEGER;
  else if (chain.refreshMinimum) minimum = holdingMinimum();
  let discoveryFailed = false;
  const discovered = chain.discoverWallets ? await chain.discoverWallets().catch(() => {
    discoveryFailed = true;
    return [] as string[];
  }) : [];
  const wallets = (
    await db
      .selectDistinct({ wallet: agents.ownerId })
      .from(agents)
      .where(and(eq(agents.funding, "holder"), eq(agents.holderMint, chain.mint ?? ""), isNull(agents.retiredAt), isNotNull(agents.ownerId)))
  ).map((r) => r.wallet!);
  for (const wallet of discovered) if (!wallets.includes(wallet)) wallets.push(wallet);
  if (wallets.length === 0) return { read: 0, failed: discoveryFailed ? [{ wallet: "discovery", why: "Holder discovery unavailable" }] : [] };

  // Supply once per pass: every wallet's position is divided by the same figure.
  let supply: number;
  try {
    supply = await chain.supply();
  } catch (error) {
    const why = String(error).slice(0, 200);
    return { read: 0, failed: wallets.map((wallet) => ({ wallet, why })) };
  }
  const result: RefreshResult = { read: 0, failed: discoveryFailed ? [{ wallet: "discovery", why: "Holder discovery unavailable; known holders still checked" }] : [] };
  for (const wallet of wallets) {
    try {
      await store(db, { wallet, amount: await chain.balanceOf(wallet), supply, readAt: now }, minimum, chain);
      const { activateHolder } = await import("./holder-activation.js");
      await activateHolder(db, wallet, chain.mint ?? "");
      result.read++;
    } catch (error) {
      result.failed.push({ wallet, why: String(error).slice(0, 200) });
    }
  }
  return result;
}

/**
 * How often every holder's wallet is read. The same as autoplay's interval, so
 * an owner who sells below the minimum is out of play within about one match.
 */
export const HOLDINGS_INTERVAL_MS = 10 * 60 * 1000;

/** Reads every holder on a timer. Returns a stop function. */
export function startHoldings(
  db: Db,
  chain: HoldingsChain,
  options: { intervalMs?: number; onLog?: (line: string) => void; onError?: (error: unknown) => void } = {},
): () => void {
  const intervalMs = options.intervalMs ?? HOLDINGS_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const pass = async () => {
    try {
      const { read, failed } = await refreshHolders(db, chain);
      if (failed.length) options.onLog?.(`holdings: read ${read}, ${failed.length} unreadable (first: ${failed[0]!.why.slice(0, 120)})`);
    } catch (error) {
      options.onError?.(error);
    }
    if (!stopped) timer = setTimeout(() => void pass(), intervalMs);
  };
  void pass();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * How many wallets hold an agent in play now: the holder count the village
 * grows with. A wallet counts once whatever it holds, and only while its
 * holding keeps its agent in play (inPlaySql), so a sell below the minimum
 * takes it off the count at the next reading.
 */
export async function holderCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${agents.ownerId})::int` })
    .from(agents)
    .where(and(eq(agents.funding, "holder"), isNull(agents.retiredAt), isNotNull(agents.ownerId), inPlaySql()));
  return Number(row?.n ?? 0);
}
