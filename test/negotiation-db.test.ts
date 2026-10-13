import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connect, migrate } from "../src/db/client.js";
import { agents, matches, negotiationMatches } from "../src/db/schema.js";
import { tick } from "../src/db/autoplay.js";
import { negotiationAfter, negotiationById, negotiationFeed, negotiationPresetOf, playNegotiationMatch } from "../src/db/negotiation.js";
import { playNegotiation } from "../src/negotiation/engine.js";
import { NEGOTIATION_PRESETS, NEGOTIATION_PRESET_NAMES } from "../src/negotiation/presets.js";
import { listen } from "../src/http/server.js";
import { someWallet, createPlayer } from "./helpers.js";

const fresh = async () => { const c = await connect(); await migrate(c.db); return c; };
type Db = Awaited<ReturnType<typeof fresh>>["db"];
const player = async (db: Db, autoplay = false) => {
  const row = await createPlayer(db, { name: `P${Math.random().toString(36).slice(2, 7)}`, presetName: "Anchor", ownerId: someWallet() });
  if (autoplay) await db.update(agents).set({ autoplay: true }).where(eq(agents.id, row.id));
  return row;
};

describe("negotiation matches in the database", () => {
  it("stores a match that replays exactly from its seed and the two agents' styles", async () => {
    const { db, close } = await fresh();
    try {
      const [a, b] = [await player(db), await player(db)];
      const row = await playNegotiationMatch(db, a.id, b.id, 12345);
      expect(row.scored).toBe(false);
      expect(row.presetA).toBe(negotiationPresetOf(a.id));
      expect(row.log).toEqual(playNegotiation(NEGOTIATION_PRESETS[negotiationPresetOf(a.id)], NEGOTIATION_PRESETS[negotiationPresetOf(b.id)], { seed: 12345 }));
      expect([row.netA, row.netB]).toEqual([row.log.net.A, row.log.net.B]);
      const [listed] = await negotiationFeed(db);
      expect(listed).toMatchObject({ id: row.id, a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name } });
      expect((await negotiationFeed(db, { agentId: b.id })).map((m) => m.id)).toEqual([row.id]);
      expect(await negotiationById(db, row.id)).toMatchObject({ id: row.id });
    } finally { await close(); }
  });

  it("follows about one Bluff & Fold match in three, decided by that match's seed", () => {
    let played = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const first = negotiationAfter(seed);
      expect(negotiationAfter(seed)).toBe(first);
      if (first !== null) played++;
    }
    expect(played / 3000).toBeGreaterThan(0.28);
    expect(played / 3000).toBeLessThan(0.39);
  });

  it("gives every style to some agents", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => negotiationPresetOf(`agent-${i}`)));
    expect([...seen].sort()).toEqual([...NEGOTIATION_PRESET_NAMES].sort());
  });

  it("is played by autoplay on top of Bluff & Fold, never instead of it, and can be switched off", async () => {
    const { db, close } = await fresh();
    try {
      for (let i = 0; i < 4; i++) await player(db);
      for (let i = 0; i < 6; i++) await player(db, true);
      const result = await tick(db, { intervalMs: 0 });
      const played = await db.select().from(matches);
      expect(played.length).toBeGreaterThanOrEqual(result.played.length);
      const expected = played.filter((m) => negotiationAfter(m.seed) !== null).length;
      expect((await db.select().from(negotiationMatches)).length).toBe(expected);
      await db.delete(negotiationMatches);
      await db.update(agents).set({ autoplayLastMatchAt: null });
      await tick(db, { intervalMs: 0, negotiation: false });
      expect(await db.select().from(negotiationMatches)).toEqual([]);
    } finally { await close(); }
  });

  it("serves the feed and single matches over HTTP", async () => {
    const { db, close } = await fresh();
    const server = await listen({ db, nonceRateLimit: { limit: 1000, windowMs: 60_000 } });
    try {
      const [a, b] = [await player(db), await player(db)];
      const row = await playNegotiationMatch(db, a.id, b.id, 777);
      const feed = await (await fetch(`${server.url}/negotiations?limit=5`)).json() as { matches: { id: string }[] };
      expect(feed.matches.map((m) => m.id)).toEqual([row.id]);
      expect((await fetch(`${server.url}/negotiations/${row.id}`)).status).toBe(200);
      expect((await fetch(`${server.url}/negotiations/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    } finally { await server.close(); await close(); }
  });
});
