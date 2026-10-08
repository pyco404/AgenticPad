import { describe, expect, it } from "vitest";
import imported from "../web/public/village/map.json";
import type { VillageMap } from "../web/lib/world/map-data";
import { createWorldModel, plotObjects, prepareWorldMap, treeObject, worldObject } from "../web/lib/world/model";
import { depthOrder, FIELD_VIEWS, footprint, project, projectedBounds, unprojectGround } from "../web/lib/world/projection";
import { COLOSSEUM } from "../web/lib/world/arena-geometry";
import { chunkTrees } from "../web/lib/world/forest";
import { NEW_TOWN } from "../web/lib/world/growth";
import { GARDEN_PONDS } from "../web/lib/world/landmarks";
import { byLandscape } from "../web/lib/world/landscape";
import { PIECES, overRoad } from "../web/lib/world/pieces";
import { byRiver, waterTerrain } from "../web/lib/world/river";
import { lots, ROADS, SITES, stands } from "../web/lib/world/town";
import { lakeTerrain, WORLD } from "../web/lib/world/world";

const art = () => ({ width: 192, height: 192 });
const prepared = prepareWorldMap(imported as unknown as VillageMap);
const world = createWorldModel(prepared, art);

describe("shared field geometry", () => {
  it("preserves the existing top tile recipe, roads, landmark anchors and dimensions", () => {
    const scenic = waterTerrain(), occupied = new Set(scenic.map(([c, r]) => `${c},${r}`));
    expect(prepared.terrain).toEqual([...lakeTerrain().filter(([c, r]) => !occupied.has(`${c},${r}`)), ...scenic]);
    expect(world.bounds).toEqual(WORLD);
    expect(world.map.paths).toBe(ROADS);
    expect(world.sites).toBe(SITES);
    const arena = world.objects.find((o) => o.id === "site:arena")!;
    expect(arena).toMatchObject({ x: COLOSSEUM.x, y: COLOSSEUM.y, width: COLOSSEUM.rx * 2, depth: COLOSSEUM.ry * 2, height: COLOSSEUM.wallHeight });
    for (const [id, site] of Object.entries(SITES)) expect(world.objects.find((o) => o.id === `site:${id}`)?.metadata?.topAnchor).toEqual({ x: site.x, y: site.y });
  });

  it("keeps the original canopy reservations and decoration exclusion rules", () => {
    const placed = [...PIECES.map((p) => ({ x: p.x, y: p.y, width: 192 * p.scale, height: 192 * p.scale * (p.foot ?? 1) })),
      ...world.districtPieces.map((p) => ({ x: p.x, y: p.y, width: 192 * p.scale, height: 192 * p.scale }))];
    const taken = lots(placed);
    expect(world.lots).toEqual(taken);
    const byPond = (p: { x: number; y: number }) => GARDEN_PONDS.some((b) => p.x > b.x0 - 42 && p.x < b.x1 + 42 && p.y > b.y0 - 42 && p.y < b.y1 + 42);
    expect(world.map.decorations).toEqual(prepared.decorations.filter((d) => stands(d, taken) && !overRoad(d, ROADS) && !byPond(d) && !byLandscape(d) && !byRiver(d)));
  });

  it("does not classify dry bridge/shore tiles as open water", () => {
    const dry = new Set(prepared.terrain.filter((t) => t[2] !== "terrain-water").map(([c, r]) => `water:${c},${r}`));
    for (const o of world.objects.filter((o) => o.type === "water")) expect(dry.has(o.id)).toBe(false);
    expect(world.objects.some((o) => o.type === "bridge")).toBe(true);
    expect(world.objects.filter((o) => o.type === "pond")).toHaveLength(GARDEN_PONDS.length);
  });

  it("retains stable growth and forest identities across repeated projections", () => {
    const rules = { inOldTown: () => false, onRoad: () => false, taken: [], cleared: [] };
    const trees = chunkTrees(4, 4, rules);
    expect(trees.length).toBeGreaterThan(0);
    const objects = trees.map(treeObject);
    expect(objects).toEqual(chunkTrees(4, 4, rules).map(treeObject));
    expect(plotObjects(NEW_TOWN.plots[0]!)).toEqual(plotObjects(NEW_TOWN.plots[0]!));
    expect(new Set(world.objects.map((o) => o.id)).size).toBe(world.objects.length);
    const original = JSON.stringify(world);
    for (const view of FIELD_VIEWS) depthOrder(view, world.objects).forEach((o) => footprint(o).forEach((p) => project(view, p, o.height)));
    expect(JSON.stringify(world)).toBe(original);
  });
});

describe("camera projections", () => {
  it("mirrors opposite elevations without changing span or vertical scale", () => {
    for (const [a, b] of [["front", "back"], ["left", "right"]] as const) {
      const one = projectedBounds(a, WORLD), two = projectedBounds(b, WORLD);
      expect(one.x1 - one.x0).toBe(two.x1 - two.x0);
      expect(one.y1 - one.y0).toBe(two.y1 - two.y0);
      for (const p of [{ x: -900, y: 250 }, { x: 3060, y: 1190 }, { x: COLOSSEUM.x, y: COLOSSEUM.y }]) {
        expect(project(a, p, 140).x).toBe(-project(b, p, 140).x);
        expect(project(a, p, 140).y).toBe(project(b, p, 140).y);
        expect(project(a, p).depth).toBe(-project(b, p).depth);
      }
    }
    expect(projectedBounds("front", WORLD).x1 - projectedBounds("front", WORLD).x0).toBe(WORLD.x1 - WORLD.x0);
    expect(projectedBounds("left", WORLD).x1 - projectedBounds("left", WORLD).x0).toBe(WORLD.y1 - WORLD.y0);
  });

  it("maps each viewing direction and vertical height correctly", () => {
    expect(project("front", { x: 100, y: 0 }).x).toBeGreaterThan(project("front", { x: 0, y: 0 }).x);
    expect(project("left", { x: 0, y: -100 }).x).toBeGreaterThan(project("left", { x: 0, y: 0 }).x);
    for (const view of FIELD_VIEWS.filter((v) => v !== "top")) {
      const bottom = project(view, { x: 42, y: -127 }), roof = project(view, { x: 42, y: -127 }, 100);
      expect(roof.x).toBe(bottom.x); expect(roof.y).toBeLessThan(bottom.y); expect(roof.depth).toBe(bottom.depth);
    }
  });

  it("round trips the isometric floor and uses a true orthographic basis", () => {
    for (const p of [{ x: 1400, y: 775 }, { x: -2000, y: -2160 }, { x: 4800, y: 3920 }]) {
      const roundTrip = unprojectGround("isometric", project("isometric", p));
      expect(roundTrip.x).toBeCloseTo(p.x, 8); expect(roundTrip.y).toBeCloseTo(p.y, 8);
    }
    const x = project("isometric", { x: 1, y: 0 }), y = project("isometric", { x: 0, y: 1 });
    expect(Math.hypot(x.x, x.y)).toBeCloseTo(Math.hypot(y.x, y.y));
  });

  it("orders by distance to the camera, independently of roof height", () => {
    const south = worldObject("south", "building", 0, 300, 30, 30, 1);
    const north = worldObject("north", "building", 0, -300, 30, 30, 1000);
    expect(depthOrder("front", [south, north]).map((o) => o.id)).toEqual(["north", "south"]);
    expect(depthOrder("back", [south, north]).map((o) => o.id)).toEqual(["south", "north"]);
  });
});
