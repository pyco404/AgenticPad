import { describe, expect, it } from "vitest";
import { connect, migrate } from "../src/db/client.js";
import { createAgent, runMatch } from "../src/db/runner.js";
import { closeSeason } from "../src/db/seasons.js";
import { seasonStatement } from "../src/db/statement.js";
import { listen } from "../src/http/server.js";
import { seasonAt } from "../src/season.js";
import { createPlayer, everyoneHolds } from "./helpers.js";

// A season's statement under holder agents: the play and the scores, and an
// empty payout side that says which kind of empty it is.

const fresh = async () => {
  const c = await connect();
  await migrate(c.db);
  return c;
};

describe("a season's statement", () => {
  it("reports the play, the scores and an empty payout side", async () => {
    const { db, close } = await fresh();
    const current = seasonAt(new Date());
    const a = await createPlayer(db, { name: "Sa", presetName: "Bully" });
    const b = await createPlayer(db, { name: "Sb", presetName: "Mirage" });
    const h = await createAgent(db, { name: "Sh", presetName: "Anchor" });
    for (let i = 0; i < 6; i++) await runMatch(db, a.id, b.id, { seed: 400 + i });
    // Against the house: played and recorded, and counted toward nothing.
    await runMatch(db, a.id, h.id, { seed: 999 });

    const s = await seasonStatement(db, current.key);
    expect(s.season.key).toBe(current.key);
    expect(s.season.status).toBe("open");
    expect(s.play.rankedMatches).toBe(6);
    expect(s.play.exhibitions).toBe(1);
    // The reconciliation line: a match is zero-sum between its two agents.
    expect(s.play.netAcrossAllSides).toBe(0);

    expect(s.payouts).toEqual({ funded: false, pool: null, paid: null });
    expect(s.scores.places.map((p) => p.agentId).sort()).toEqual([a.id, b.id].sort());
    await close();
  });

  it("goes final when the season closes, with the play unchanged", async () => {
    const { db, close } = await fresh();
    const current = seasonAt(new Date());
    const a = await createPlayer(db, { name: "Fa", presetName: "Bully" });
    const b = await createPlayer(db, { name: "Fb", presetName: "Anchor" });
    for (let i = 0; i < 4; i++) await runMatch(db, a.id, b.id, { seed: 500 + i });
    const before = await seasonStatement(db, current.key);
    expect(before.season.status).toBe("open");
    await closeSeason(db, current.key, new Date(current.end.getTime() + 60_000));
    const after = await seasonStatement(db, current.key);
    expect(after.season.status).toBe("closed");
    expect(after.play).toEqual(before.play);
    await close();
  });

  it("is a statement of a season nobody played, not an error", async () => {
    const { db, close } = await fresh();
    const s = await seasonStatement(db, "2099-01-05");
    expect(s.play).toEqual({ rankedMatches: 0, exhibitions: 0, netAcrossAllSides: 0 });
    expect(s.scores.places).toEqual([]);
    await close();
  });
});

describe("GET /statement", () => {
  it("serves the current season by default and rejects a day that is not a Monday", async () => {
    const c = await fresh();
    const { url, close: closeServer } = await listen({ db: c.db, holder: everyoneHolds() });
    try {
      const body = (await (await fetch(`${url}/statement`)).json()) as any;
      expect(body.statement.season.key).toBe(seasonAt(new Date()).key);
      expect(body.statement.payouts.funded).toBe(false);
      expect((await fetch(`${url}/statement?season=2026-09-22`)).status).toBe(400);
    } finally {
      await closeServer();
      await c.close();
    }
  });
});
