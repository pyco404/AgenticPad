import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { baseUnits, chips, seasonRate } from "../chips.js";
import type { Db } from "./client.js";
import { agents, holdings, MIN_FUNDING_CHIPS } from "./schema.js";

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
  balanceOf(wallet: string): Promise<number>;
  /** The token's total supply in base units. */
  supply(): Promise<number>;
};

export type Holding = { wallet: string; amount: number; supply: number; readAt: Date };

/**
 * The least a wallet must hold to have an agent, in base units at the
 * season's rate. Pegged in dollars through the chips (MIN_FUNDING_CHIPS), so
 * it is retuned when the rate is, at a season boundary, and never in between.
 */
export const holdingMinimum = (rate: number = seasonRate()): number => baseUnits(MIN_FUNDING_CHIPS, rate);

/** Whether a holding, in base units, is enough to have an agent. */
export const holdsMinimum = (amount: number, rate: number = seasonRate()): boolean => amount >= holdingMinimum(rate);

/** A holding as the owner reads it: in chips, beside the minimum it is measured against. */
export function holdingView(holding: Holding | null, rate: number = seasonRate()) {
  const amount = holding?.amount ?? 0;
  return {
    /** Base units, and the same in chips. */
    amount,
    chips: chips(amount, rate),
    minimum: holdingMinimum(rate),
    minimumChips: MIN_FUNDING_CHIPS,
    eligible: holdsMinimum(amount, rate),
    /** Null when this wallet has never been read. */
    readAt: holding?.readAt.toISOString() ?? null,
  };
}

async function store(db: Db, holding: Holding): Promise<void> {
  const set = { amount: holding.amount, supply: holding.supply, readAt: holding.readAt };
  await db
    .insert(holdings)
    .values({ wallet: holding.wallet, ...set })
    .onConflictDoUpdate({ target: holdings.wallet, set });
}

/** The last reading for a wallet, or null if it has never been read. */
export async function holdingOf(db: Db, wallet: string): Promise<Holding | null> {
  const [row] = await db.select().from(holdings).where(eq(holdings.wallet, wallet)).limit(1);
  return row ? { ...row, amount: Number(row.amount), supply: Number(row.supply) } : null;
}

/**
 * Reads one wallet off chain now and records it. Throws if the chain cannot be
 * read, and records nothing: a failed read is not a reading of zero.
 */
export async function readHolding(db: Db, chain: HoldingsChain, wallet: string, now = new Date()): Promise<Holding> {
  const [amount, supply] = await Promise.all([chain.balanceOf(wallet), chain.supply()]);
  const holding = { wallet, amount, supply, readAt: now };
  await store(db, holding);
  return holding;
}

export type RefreshResult = { read: number; failed: { wallet: string; why: string }[] };

/**
 * Reads every wallet behind a holder agent still in play. A wallet whose read
 * fails keeps its last reading - an RPC that throttled says nothing about what
 * the wallet holds - and is reported, so a run of failures is seen rather than
 * quietly leaving everyone on old figures.
 */
export async function refreshHolders(db: Db, chain: HoldingsChain, now = new Date()): Promise<RefreshResult> {
  const wallets = (
    await db
      .selectDistinct({ wallet: agents.ownerId })
      .from(agents)
      .where(and(eq(agents.funding, "holder"), isNull(agents.retiredAt), isNotNull(agents.ownerId)))
  ).map((r) => r.wallet!);
  if (wallets.length === 0) return { read: 0, failed: [] };

  // Supply once per pass: every wallet's position is divided by the same figure.
  let supply: number;
  try {
    supply = await chain.supply();
  } catch (error) {
    const why = String(error).slice(0, 200);
    return { read: 0, failed: wallets.map((wallet) => ({ wallet, why })) };
  }
  const result: RefreshResult = { read: 0, failed: [] };
  for (const wallet of wallets) {
    try {
      await store(db, { wallet, amount: await chain.balanceOf(wallet), supply, readAt: now });
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
