import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PIECES } from "../web/app/village/game/pieces.js";
import { ARENA_FIELD, CARPET, GROUNDS, ROADS, SITES, SQUARE } from "../web/app/village/game/town.js";
import { nearRoad, NEW_TOWN_SITES } from "../web/app/village/game/town.js";
import { Roads } from "../web/app/village/game/roads.js";

/**
 * Old Town is the village players know: the world grows round it and never
 * moves it without an intentional redesign. The fixture records the user's
 * organic district layout (2026-10-06), including paths and each hall's props.
 */

type Rel = { dx: number; dy: number };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/old-town.json", import.meta.url), "utf8")) as {
  sites: Record<string, Rel & { scale: number; art: string; door: Rel | null }>;
  square: Rel & { rx: number; ry: number };
  carpet: { dx: number; y0: number; y1: number; width: number };
  field: Rel & { rx: number; ry: number };
  grounds: Rel[];
  pieces: (Rel & { key: string; scale: number })[];
};

const arena = SITES.arena!;
const rel = (p: { x: number; y: number }): Rel => ({ dx: p.x - arena.x, dy: p.y - arena.y });

describe("Old Town", () => {
  it("keeps the spacious landmarks anchored relative to the Arena as the world grows", () => {
    for (const [id, was] of Object.entries(fixture.sites)) {
      const site = SITES[id];
      expect(site, id).toBeDefined();
      expect({ ...rel(site!), scale: site!.scale, art: site!.art, door: site!.door ? rel(site!.door) : null }, id).toEqual(was);
    }
  });

  it("spaces landmarks apart and connects each entrance to the arena's approach", () => {
    const halls = Object.entries(SITES).filter(([id]) => id !== "arena" && !NEW_TOWN_SITES.has(id));
    for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) {
      const [aId, a] = halls[i]!, [bId, b] = halls[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${aId} and ${bId}`).toBeGreaterThan(280);
    }
    const doors = halls.map(([, s]) => s.door ?? { x: s.x, y: s.y + 5 });
    const roads = new Roads(ROADS.map((p) => p.points.map(([x, y]) => ({ x, y }))), doors);
    for (const door of doors) {
      const route = roads.route({ x: 1400, y: 1010 }, door);
      expect(route.at(-1)).toEqual(door);
      for (const p of route) expect(nearRoad(p, 32), `route to ${door.x},${door.y}`).toBe(true);
    }
  });

  it("offers different street widths and multiple routes without a perimeter", () => {
    expect(new Set(ROADS.map(r=>r.width)).size).toBeGreaterThan(3);
    for (const r of ROADS) expect(r.points[0]).not.toEqual(r.points.at(-1));
    // A local market circuit gives agents a choice without wrapping the town.
    const graph = new Roads(ROADS.filter(r=>r.style !== "main").map(r=>r.points.map(([x,y])=>({x,y}))),[]);
    const route = graph.route({x:830,y:875},{x:2130,y:790});
    expect(route.length).toBeGreaterThan(5);
    for (const p of route) expect(nearRoad(p,32)).toBe(true);
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
