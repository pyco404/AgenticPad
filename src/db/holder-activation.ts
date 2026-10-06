import { and, eq, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { PRESET_NAMES } from "../presets.js";
import type { Db } from "./client.js";
import { agents, holderPreferences } from "./schema.js";
import { activeAgentsOf, createAgent } from "./runner.js";
import { holdingOf, keeps } from "./holdings.js";

/** The same wallet lock used by manual creation prevents competing creations. */
export async function activateHolder(db: Db, wallet: string, mint = "") {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${wallet}, 0))`);
    const [preference] = await tx.select().from(holderPreferences).where(and(eq(holderPreferences.wallet, wallet), eq(holderPreferences.mint, mint)));
    const holding = await holdingOf(t, wallet, mint);
    if (holding?.amount === 0) {
      await tx.update(agents).set({ retiredAt: new Date(), retiredReason: "no-holdings", autoplay: false })
        .where(and(eq(agents.ownerId, wallet), eq(agents.holderMint, mint), isNull(agents.retiredAt)));
      return null;
    }
    if (preference?.automatic === false || !keeps(holding)) return null;
    const active = await activeAgentsOf(t, wallet, mint);
    if (active.length) return active[0]!;
    const presetName = PRESET_NAMES[randomInt(PRESET_NAMES.length)]!;
    return createAgent(t, { name: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, ownerId: wallet, holderMint: mint, autoplay: true, presetName });
  });
}

/** Retire without moving tokens; opt out before releasing the one-agent slot. */
export async function endHolder(db: Db, wallet: string, id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${wallet}, 0))`);
    const [row] = await tx.select().from(agents).where(and(eq(agents.id, id), eq(agents.ownerId, wallet)));
    if (!row) return false;
    await tx.insert(holderPreferences).values({ wallet, mint: row.holderMint, automatic: false }).onConflictDoUpdate({ target: [holderPreferences.wallet, holderPreferences.mint], set: { automatic: false } });
    await tx.update(agents).set({ retiredAt: new Date(), retiredReason: "owner", autoplay: false }).where(and(eq(agents.id, id), isNull(agents.retiredAt)));
    return true;
  });
}
