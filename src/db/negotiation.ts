import { desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "./client.js";
import { agents, negotiationMatches, type NegotiationMatchRow } from "./schema.js";
import { playNegotiation } from "../negotiation/engine.js";
import { NEGOTIATION_PRESETS, NEGOTIATION_PRESET_NAMES, type NegotiationPresetName } from "../negotiation/presets.js";

/**
 * Negotiation as an exhibition (docs/negotiation.md): played alongside Bluff & Fold, about one match in
 * three, between the same two agents, and stored on its own. It scores nothing until scoring is
 * switched on, so during the exhibition no agent plays a Bluff & Fold match less.
 */

/** FNV-1a: the same id always hashes the same. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** An agent's negotiating style, fixed by its id until owners can choose one. */
export function negotiationPresetOf(agentId: string): NegotiationPresetName {
  return NEGOTIATION_PRESET_NAMES[hash(`negotiation:${agentId}`) % NEGOTIATION_PRESET_NAMES.length]!;
}

/**
 * The Negotiation seed that goes with a Bluff & Fold match's seed, and whether one is played: about
 * one in three. Derived, not drawn, so a pair of matches replays from the first one's seed.
 */
export function negotiationAfter(matchSeed: number): number | null {
  const seed = (Math.imul((matchSeed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) ^ 0x5bd1e995;
  const s = seed >>> 0;
  return s % 3 === 0 ? s : null;
}

/** Plays and stores one Negotiation match. Exhibition: `scored` stays false. */
export async function playNegotiationMatch(db: Db, agentA: string, agentB: string, seed: number): Promise<NegotiationMatchRow> {
  const presetA = negotiationPresetOf(agentA), presetB = negotiationPresetOf(agentB);
  const log = playNegotiation(NEGOTIATION_PRESETS[presetA], NEGOTIATION_PRESETS[presetB], { seed });
  const [row] = await db.insert(negotiationMatches)
    .values({ agentA, agentB, presetA, presetB, seed, netA: log.net.A, netB: log.net.B, log })
    .returning();
  return row!;
}

export type NegotiationView = {
  id: string; playedAt: string; scored: boolean;
  a: { id: string; name: string; preset: string; net: number };
  b: { id: string; name: string; preset: string; net: number };
  log: NegotiationMatchRow["log"];
};

async function view(db: Db, rows: NegotiationMatchRow[]): Promise<NegotiationView[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.agentA, r.agentB]))];
  const names = new Map((ids.length ? await db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, ids)) : []).map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id, playedAt: r.playedAt.toISOString(), scored: r.scored,
    a: { id: r.agentA, name: names.get(r.agentA) ?? "", preset: r.presetA, net: r.netA },
    b: { id: r.agentB, name: names.get(r.agentB) ?? "", preset: r.presetB, net: r.netB },
    log: r.log,
  }));
}

/** The latest Negotiation matches, newest first; `agentId` narrows to one agent's. */
export async function negotiationFeed(db: Db, options: { limit?: number; agentId?: string } = {}): Promise<NegotiationView[]> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const rows = await db.select().from(negotiationMatches)
    .where(options.agentId ? or(eq(negotiationMatches.agentA, options.agentId), eq(negotiationMatches.agentB, options.agentId)) : undefined)
    .orderBy(desc(negotiationMatches.seq)).limit(limit);
  return view(db, rows);
}

/** One Negotiation match, or null. */
export async function negotiationById(db: Db, id: string): Promise<NegotiationView | null> {
  const rows = await db.select().from(negotiationMatches).where(eq(negotiationMatches.id, id)).limit(1);
  return rows.length ? (await view(db, rows))[0]! : null;
}

/** Matches older than `before` (seq), for paging a feed. */
export async function negotiationsBefore(db: Db, before: number, limit = 20): Promise<NegotiationView[]> {
  const rows = await db.select().from(negotiationMatches).where(lt(negotiationMatches.seq, before)).orderBy(desc(negotiationMatches.seq)).limit(Math.min(50, limit));
  return view(db, rows);
}
