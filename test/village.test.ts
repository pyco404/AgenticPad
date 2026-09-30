import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HALLS, hallOf, lookOf, placeResidents, type FieldEntry, type PlayingMatch } from "../web/app/village/residents.js";

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

  it("puts both sides of a match in the arena, each with its own result", () => {
    const [a, b] = placeResidents([agent("1"), agent("2")], [match("m", "1", "2", 14)]);
    expect(a).toMatchObject({ place: "arena", match: { id: "m", seat: "A", opponent: { id: "2" }, net: 14 } });
    expect(b).toMatchObject({ place: "arena", match: { id: "m", seat: "B", opponent: { id: "1" }, net: -14 } });
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
    const clock = { startedAt: 1000, playMs: 10_000, roundsWon: play.map((r) => r.roundsWon) };
    expect(a?.match?.clock).toEqual(clock);
    expect(b?.match?.clock).toEqual(clock);
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
