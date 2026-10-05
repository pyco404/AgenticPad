import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HALLS, hallOf, lookOf, placeResidents, standInId, type FieldEntry, type PlayingMatch } from "../web/app/village/residents.js";

const agent = (id: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  id,
  name: `Agent ${id}`,
  presetName: "Anchor",
  house: true,
  retiredAt: null,
  ...over,
});
const match = (id: string, a: string, b: string, netA = 5): PlayingMatch => ({
  id,
  a: { id: a, name: `Agent ${a}` },
  b: { id: b, name: `Agent ${b}` },
  netA,
  netB: -netA,
  exhibition: false,
});

describe("placing residents", () => {
  it("sends a waiting agent to its own hall, the same one every time", () => {
    const placed = placeResidents([agent("1"), agent("2"), agent("3")], []);
    expect(placed.map((r) => r.place)).toEqual(["1", "2", "3"].map(hallOf));
    expect(placed.every((r) => r.place === r.hall)).toBe(true);
    expect(placed.every((r) => r.match === null)).toBe(true);
  });

  it("spreads waiting agents across all three halls", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `agent-${i}`);
    const counts = new Map(HALLS.map((h) => [h, ids.filter((id) => hallOf(id) === h).length]));
    // Each hall gets its share: none empty, none holding half the village.
    for (const n of counts.values()) expect(n).toBeGreaterThan(60);
  });

  it("puts both sides of a match in a duel where they meet, each with its own result", () => {
    const [a, b] = placeResidents([agent("1"), agent("2")], [match("m", "1", "2", 14)]);
    expect(a).toMatchObject({ place: "duel", match: { id: "m", seat: "A", opponent: { id: "2" }, net: 14, replay: false } });
    expect(b).toMatchObject({ place: "duel", match: { id: "m", seat: "B", opponent: { id: "1" }, net: -14, replay: false } });
  });

  it("sends the Arena's live match to the Arena with its own agents, and only that one", () => {
    const placed = placeResidents([agent("1"), agent("2"), agent("3"), agent("4")], [match("n", "1", "3"), match("o", "3", "4")], {
      kind: "live",
      match: match("m", "1", "2"),
      key: "live:m:0",
    });
    expect(placed.filter((r) => r.place === "arena").map((r) => r.id)).toEqual(["1", "2"]);
    expect(placed.find((r) => r.id === "1")?.match).toMatchObject({ id: "m", replay: false, key: "live:m:0" });
    // The Arena's match comes first: agent 1's newer match is not shown, and 3 and 4 meet out in the village.
    expect(placed.find((r) => r.id === "3")?.match?.id).toBe("o");
    expect(placed.filter((r) => r.place === "duel").map((r) => r.id)).toEqual(["3", "4"]);
  });

  it("plays a replay with stand-ins, named for the agents, and leaves the real agents where they are", () => {
    const placed = placeResidents([agent("1"), agent("2")], [match("n", "1", "2")], { kind: "replay", match: match("old", "1", "2"), key: "replay:old:0" });
    expect(placed.slice(0, 2).map((r) => r.place)).toEqual(["duel", "duel"]);
    const standIns = placed.filter((r) => r.place === "arena");
    expect(standIns.map((r) => [r.id, r.name, r.standIn])).toEqual([
      [standInId("old", "A"), "Agent 1", "1"],
      [standInId("old", "B"), "Agent 2", "2"],
    ]);
    expect(standIns[0]?.match).toMatchObject({ id: "old", replay: true, opponent: { id: standInId("old", "B") } });
  });

  it("shows an agent in two playbacks in the newer, which comes first", () => {
    const [a] = placeResidents([agent("1"), agent("2"), agent("3")], [match("new", "1", "3"), match("old", "1", "2")]);
    expect(a?.match?.id).toBe("new");
  });

  it("leaves the other side of an older match waiting rather than half-paired", () => {
    const placed = placeResidents([agent("1"), agent("2"), agent("3")], [match("new", "1", "3"), match("old", "1", "2")]);
    expect(placed.find((r) => r.id === "2")?.place).toBe(hallOf("2"));
  });

  it("gives both sides of a match its playback clock, for the arena's running score", () => {
    const play = [{ roundsWon: { A: 1, B: 0 } }, { roundsWon: { A: 1, B: 1 } }, { roundsWon: { A: 2, B: 1 } }];
    const [a, b] = placeResidents([agent("1"), agent("2")], [{ ...match("m", "1", "2"), startedAt: 1000, playMs: 10_000, play }]);
    // Rounds sent without their hands and choices leave the table nothing to show but the score.
    const clock = { startedAt: 1000, playMs: 10_000, roundsWon: play.map((r) => r.roundsWon), rounds: [null, null, null] };
    expect(a?.match?.clock).toEqual(clock);
    expect(b?.match?.clock).toEqual(clock);
  });

  it("carries each round's hands and choices to the arena's table, as the stream sent them", () => {
    const round = {
      roundsWon: { A: 1, B: 0 },
      leader: "A" as const,
      edges: { A: 0.7, B: 0.4 },
      sequence: [
        { seat: "A" as const, action: "raise" as const },
        { seat: "B" as const, action: "fold" as const },
      ],
      outcome: "one-folded" as const,
      bet: 20,
      winner: "A" as const,
    };
    const [a] = placeResidents([agent("1"), agent("2")], [{ ...match("m", "1", "2"), startedAt: 0, playMs: 10_000, play: [round] }]);
    const { roundsWon: _, ...table } = round;
    expect(a?.match?.clock?.rounds).toEqual([table]);
  });

  it("leaves the clock off a match the stream sent without one", () => {
    const [a] = placeResidents([agent("1"), agent("2")], [match("m", "1", "2")]);
    expect(a?.match?.clock).toBeNull();
  });

  it("walks a retiring agent to the gate, even mid-match", () => {
    const [a] = placeResidents([agent("1", { retiredAt: new Date().toISOString() }), agent("2")], [match("m", "1", "2")]);
    expect(a).toMatchObject({ place: "gate", match: null });
  });
});

describe("how a resident looks", () => {
  it("is fixed by its id", () => {
    expect(lookOf("abc")).toEqual(lookOf("abc"));
  });

  it("varies across the field, so a hall is not one figure repeated", () => {
    const looks = Array.from({ length: 40 }, (_, i) => lookOf(`agent-${i}`));
    expect(new Set(looks.map((l) => l.unit)).size).toBe(3);
    expect(new Set(looks.map((l) => l.colour)).size).toBe(4);
  });
});

describe("the imported village", () => {
  const village = JSON.parse(readFileSync(new URL("../web/public/village/map.json", import.meta.url), "utf8")) as {
    buildings: { id: string }[];
    textures: { key: string; path: string }[];
    decorations: { k: string }[];
  };

  it("has a building for every place an agent can stand", () => {
    const ids = new Set(village.buildings.map((b) => b.id));
    for (const place of ["arena", ...HALLS]) expect(ids, place).toContain(place);
  });

  it("ships every image it loads, and loads every texture it draws", () => {
    for (const t of village.textures) {
      expect(existsSync(new URL(`../web/public/village/${t.path}`, import.meta.url)), t.path).toBe(true);
    }
    const keys = new Set(village.textures.map((t) => t.key));
    for (const d of village.decorations) expect(keys, d.k).toContain(d.k);
  });
});
