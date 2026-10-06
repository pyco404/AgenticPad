import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PIECES } from "../web/app/village/game/pieces.js";
import { ARENA_FIELD, CARPET, GROUNDS, ROADS, SITES, SQUARE } from "../web/app/village/game/town.js";

/**
 * Old Town is the village players know: the world grows round it and never
 * moves it. test/fixtures/old-town.json is Old Town as it stood before the
 * world was laid out round it (2026-10-05), every building, road, prop and
 * camp relative to the Arena; this checks it still stands exactly so.
 */

type Rel = { dx: number; dy: number };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/old-town.json", import.meta.url), "utf8")) as {
  sites: Record<string, Rel & { scale: number; art: string; door: Rel | null }>;
  roads: { style: string; width: number; points: [number, number][] }[];
  square: Rel & { rx: number; ry: number };
  carpet: { dx: number; y0: number; y1: number; width: number };
  field: Rel & { rx: number; ry: number };
  grounds: Rel[];
  pieces: (Rel & { key: string; scale: number })[];
};

const arena = SITES.arena!;
const rel = (p: { x: number; y: number }): Rel => ({ dx: p.x - arena.x, dy: p.y - arena.y });

describe("Old Town", () => {
  it("keeps every building where it stood, relative to the Arena, drawn as it was", () => {
    for (const [id, was] of Object.entries(fixture.sites)) {
      const site = SITES[id];
      expect(site, id).toBeDefined();
      expect({ ...rel(site!), scale: site!.scale, art: site!.art, door: site!.door ? rel(site!.door) : null }, id).toEqual(was);
    }
  });

  it("keeps its roads apart from the removed Strategy Lab rear spur", () => {
    const now = ROADS.map((p) => JSON.stringify({ style: p.style, width: p.width, points: p.points.map(([x, y]) => [x - arena.x, y - arena.y]) }));
    for (const road of fixture.roads) {
      const removedSpur = road.style === "trail" && JSON.stringify(road.points) === JSON.stringify([[-400, -415], [-530, -415], [-540, -375]]);
      if (removedSpur) expect(now).not.toContain(JSON.stringify(road));
      else expect(now, JSON.stringify(road.points[0])).toContain(JSON.stringify(road));
    }
  });

  it("keeps its plaza, the carpet, the Arena's sand and the agent grounds", () => {
    expect({ ...rel(SQUARE), rx: SQUARE.rx, ry: SQUARE.ry }).toEqual(fixture.square);
    expect({ dx: CARPET.x - arena.x, y0: CARPET.y0 - arena.y, y1: CARPET.y1 - arena.y, width: CARPET.width }).toEqual(fixture.carpet);
    expect({ ...rel(ARENA_FIELD), rx: ARENA_FIELD.rx, ry: ARENA_FIELD.ry }).toEqual(fixture.field);
    for (const g of fixture.grounds) expect(GROUNDS.map(rel)).toContainEqual(g);
  });

  it("keeps every prop: banners, statues, chests, tents, benches, cottages, the fountain", () => {
    const now = PIECES.map((p) => ({ key: p.key, ...rel(p), scale: p.scale }));
    for (const piece of fixture.pieces) expect(now, piece.key).toContainEqual(piece);
  });
});
