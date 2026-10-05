import { describe, expect, it } from "vitest";
import { chunkTrees, type ForestRules } from "../web/app/village/game/forest.js";
import { PIECES } from "../web/app/village/game/pieces.js";
import { inTown, NEW_TOWN_SITES, nearRoad, ROADS, SITES } from "../web/app/village/game/town.js";
import { corners, CROSSROADS, fromEdge, inOctagon, INNER, LAKE_BOX, onOldGround, OUTER, PIER, SPOKES, WORLD, WORLD_ROADS } from "../web/app/village/game/world.js";

// The world round Old Town (web/app/village/game/world.ts). Presentation only.

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const toSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const oldTown = Object.entries(SITES).filter(([id]) => !NEW_TOWN_SITES.has(id));

describe("the world round Old Town", () => {
  it("rings Old Town with the inner road, a garden strip between: every building and prop well inside it", () => {
    for (const [id, s] of oldTown) expect(fromEdge(INNER, s), id).toBeLessThan(-100);
    for (const p of PIECES.filter((p) => p.key !== "ac-pier")) expect(fromEdge(INNER, p), p.key).toBeLessThan(-80);
  });

  it("lays both rings out as octagons, the outer round the inner with New Town between", () => {
    expect(corners(INNER)).toHaveLength(8);
    for (const c of corners(INNER)) expect(inOctagon(OUTER, c, -500)).toBe(true);
    expect(OUTER.hw - INNER.hw).toBeGreaterThan(600);
    expect(OUTER.hh - INNER.hh).toBeGreaterThan(600);
  });

  it("runs six main roads from Old Town's own roads straight out through both rings to the world's edge", () => {
    expect(SPOKES).toHaveLength(6);
    const oldVertices = ROADS.filter((r) => r.style !== "paved" && r.style !== "dirt").flatMap((r) => r.points.map(([x, y]) => `${x},${y}`));
    for (const s of SPOKES) {
      expect(oldVertices, s.id).toContain(`${s.start.x},${s.start.y}`);
      expect(Math.abs(fromEdge(INNER, s.inner)), s.id).toBeLessThan(2);
      expect(Math.abs(fromEdge(OUTER, s.outer)), s.id).toBeLessThan(2);
      const onEdge = s.end.x <= WORLD.x0 + 1 || s.end.x >= WORLD.x1 - 1 || s.end.y <= WORLD.y0 + 1 || s.end.y >= WORLD.y1 - 1;
      expect(onEdge, s.id).toBe(true);
      // Straight: the crossroads lie on the line from its start to its end.
      for (const c of [s.inner, s.outer]) expect(toSegment(c, s.start, s.end), s.id).toBeLessThan(2);
    }
  });

  it("joins each main road to each ring at a crossroads both name, so walkers can turn there", () => {
    const [inner, outer] = WORLD_ROADS;
    const has = (road: typeof inner, p: { x: number; y: number }) => road!.points.some(([x, y]) => dist({ x, y }, p) < 1.5);
    for (const s of SPOKES) {
      expect(has(inner, s.inner), s.id).toBe(true);
      expect(has(outer, s.outer), s.id).toBe(true);
    }
    expect(CROSSROADS).toHaveLength(12);
  });

  it("runs no main road over an Old Town building", () => {
    for (const s of SPOKES) for (const [id, site] of oldTown) expect(toSegment({ x: site.x, y: site.y - 40 }, s.start, s.end), `${s.id} over ${id}`).toBeGreaterThan(80);
  });

  it("puts the small lake out in the Wilds, off every road, with the pier in its water", () => {
    for (const c of [{ x: LAKE_BOX.x0, y: LAKE_BOX.y0 }, { x: LAKE_BOX.x1, y: LAKE_BOX.y1 }, { x: LAKE_BOX.x0, y: LAKE_BOX.y1 }, { x: LAKE_BOX.x1, y: LAKE_BOX.y0 }]) {
      expect(fromEdge(OUTER, c)).toBeGreaterThan(40);
      expect(nearRoad(c, 0)).toBe(false);
    }
    expect(PIER.x > LAKE_BOX.x0 && PIER.x < LAKE_BOX.x1 && PIER.y > LAKE_BOX.y0 && PIER.y < LAKE_BOX.y1).toBe(true);
  });

  it("grows the same forest from its seed every time, and none of it in Old Town, on a road or in the lake", () => {
    const rules: ForestRules = { inOldTown: (p) => onOldGround(p), onRoad: (p) => nearRoad(p, 10), taken: [], cleared: [] };
    for (const [cx, cy] of [
      [-3, -3],
      [0, 2],
      [2, 5],
      [8, 0],
    ] as const) {
      const once = chunkTrees(cx, cy, rules);
      expect(chunkTrees(cx, cy, rules)).toEqual(once);
      for (const t of once) {
        expect(inTown(t)).toBe(false);
        expect(onOldGround(t)).toBe(false);
        expect(nearRoad(t, 10)).toBe(false);
        expect(t.x > LAKE_BOX.x0 - 20 && t.x < LAKE_BOX.x1 + 20 && t.y > LAKE_BOX.y0 - 20 && t.y < LAKE_BOX.y1 + 20).toBe(false);
      }
    }
  });
});
