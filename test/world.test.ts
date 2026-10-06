import { describe, expect, it } from "vitest";
import { chunkTrees, type ForestRules } from "../web/app/village/game/forest.js";
import { Roads } from "../web/app/village/game/roads.js";
import { inTown, NEW_TOWN_SITES, nearRoad, ROADS, SITES } from "../web/app/village/game/town.js";
import { COUNTRY_LANES, corners, CROSSROADS, fromEdge, inOctagon, INNER, LAKE_BOX, onOldGround, OUTER, PIER, SPOKES, WORLD, WORLD_ROADS } from "../web/app/village/game/world.js";

// The world round Old Town (web/app/village/game/world.ts). Presentation only.

const toSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const oldTown = Object.entries(SITES).filter(([id]) => !NEW_TOWN_SITES.has(id));

describe("the world round Old Town", () => {
  it("keeps landmarks inside the playable world without an enclosing road", () => {
    for (const [id,s] of oldTown) {
      expect(s.x,id).toBeGreaterThan(WORLD.x0 + 150);
      expect(s.x,id).toBeLessThan(WORLD.x1 - 150);
      expect(s.y,id).toBeGreaterThan(WORLD.y0 + 250);
      expect(s.y,id).toBeLessThan(WORLD.y1 - 100);
    }
    for (const road of ROADS) {
      const first=road.points[0]!, last=road.points.at(-1)!;
      expect(first, "no enclosing road loop").not.toEqual(last);
    }
  });

  it("keeps the legacy expansion regions available without rendering their boundaries", () => {
    expect(corners(INNER)).toHaveLength(8);
    for (const c of corners(INNER)) expect(inOctagon(OUTER, c, -500)).toBe(true);
    expect(OUTER.hw - INNER.hw).toBeGreaterThan(600);
    expect(OUTER.hh - INNER.hh).toBeGreaterThan(600);
  });

  it("winds six countryside routes away from town, stopping naturally inside the world", () => {
    expect(COUNTRY_LANES).toHaveLength(6);
    for (const [i,lane] of COUNTRY_LANES.entries()) {
      const road=WORLD_ROADS[i]!;
      const start=SPOKES[i]!.start, end=SPOKES[i]!.end;
      expect(road.points[0]).toEqual([start.x,start.y]);
      expect(road.points.at(-1)).toEqual([end.x,end.y]);
      expect(Math.max(...lane.controls.map(([x,y])=>toSegment({x,y},start,end))),lane.id).toBeGreaterThan(60);
      expect(end.x).toBeGreaterThan(WORLD.x0 + 100);
      expect(end.x).toBeLessThan(WORLD.x1 - 100);
      expect(end.y).toBeGreaterThan(WORLD.y0 + 100);
      expect(end.y).toBeLessThan(WORLD.y1 - 100);
    }
  });

  it("connects every countryside branch and gathering place to the Arena approach", () => {
    const graph = new Roads(ROADS.map(r=>r.points.map(([x,y])=>({x,y}))), []);
    for (const goal of [...SPOKES.map(s=>s.end), ...CROSSROADS]) {
      const route=graph.route({x:1400,y:1010},goal);
      expect(route.at(-1)).toEqual(goal);
      for (const p of route) expect(nearRoad(p,25),`connected route to ${goal.x},${goal.y}`).toBe(true);
    }
  });

  it("keeps winding countryside roads clear of the building footprints", () => {
    for (const road of WORLD_ROADS) for (const [id,site] of oldTown) {
      const body={x:site.x,y:site.y-60};
      for(let i=1;i<road.points.length;i++) {
        const a=road.points[i-1]!, b=road.points[i]!;
        expect(toSegment(body,{x:a[0],y:a[1]},{x:b[0],y:b[1]}),id).toBeGreaterThan(80);
      }
    }
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
