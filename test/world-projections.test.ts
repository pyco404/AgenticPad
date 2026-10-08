import { describe, expect, it } from "vitest";
import imported from "../web/public/village/map.json";
import type { VillageMap } from "../web/lib/world/map-data";
import { createWorldModel, plotObjects, prepareWorldMap, treeObject, worldObject } from "../web/lib/world/model";
import { CAMERA_ANGLES, dragCamera, easeCamera, yawDelta, depthOrder, DIRECTIONAL_TILT, FIELD_VIEWS, footprint, frameProjection, project, projectedBounds, unprojectGround } from "../web/lib/world/projection";
import { directionalVisibility } from "../web/lib/world/visibility";
import { COLOSSEUM } from "../web/lib/world/arena-geometry";
import { chunkTrees } from "../web/lib/world/forest";
import { NEW_TOWN, PIECE_ART } from "../web/lib/world/growth";
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

  it("draws growth and forest with Top's own art, anchored where Top anchors it", () => {
    for (const plot of NEW_TOWN.plots) for (const [i, o] of plotObjects(plot).entries()) {
      const piece = plot.pieces[i]!, size = PIECE_ART[piece.image];
      // Top's build(): texture growth-<image>, origin at the foot fraction, scaled, flipped.
      expect(o.metadata?.art).toEqual({ key: `growth-${piece.image}`, frame: 0, flipX: piece.flip ?? false });
      expect(o.metadata?.topAnchor).toEqual({ x: piece.x, y: piece.y + size.height * piece.scale * (1 - size.foot) });
      expect(o.width).toBe(size.width * piece.scale);
      const flat = ["Plot", "Yard", "planter"].includes(piece.image);
      expect(o.metadata?.flat).toBe(flat);
      expect(flat ? o.depth : o.height).toBe(size.height * piece.scale);
    }
    const rules = { inOldTown: () => false, onRoad: () => false, taken: [], cleared: [] };
    for (const tree of chunkTrees(4, 4, rules)) {
      // Top's forest: tree.k at frame tree.f, bottom-centred on the tree's point.
      const o = treeObject(tree);
      expect(o.metadata?.art).toEqual({ key: tree.k, frame: tree.f });
      expect(o.metadata?.topAnchor).toEqual({ x: tree.x, y: tree.y });
    }
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
  it("reverses opposite ground axes without changing span or vertical scale", () => {
    for (const [a, b] of [["front", "back"], ["left", "right"]] as const) {
      const one = projectedBounds(a, WORLD), two = projectedBounds(b, WORLD);
      expect(one.x1 - one.x0).toBe(two.x1 - two.x0);
      expect(one.y1 - one.y0).toBeCloseTo(two.y1 - two.y0, 8);
      for (const p of [{ x: -900, y: 250 }, { x: 3060, y: 1190 }, { x: COLOSSEUM.x, y: COLOSSEUM.y }]) {
        expect(project(a, p, 140).x).toBe(-project(b, p, 140).x);
        expect(project(a, p).y).toBe(-project(b, p).y);
        expect(project(a, p, 140).y - project(a, p).y).toBeCloseTo(project(b, p, 140).y - project(b, p).y, 8);
        expect(project(a, p).depth).toBe(-project(b, p).depth);
      }
    }
    expect(projectedBounds("front", WORLD).x1 - projectedBounds("front", WORLD).x0).toBe(WORLD.x1 - WORLD.x0);
    expect(projectedBounds("left", WORLD).x1 - projectedBounds("left", WORLD).x0).toBe(WORLD.y1 - WORLD.y0);
  });

  it("maps each viewing direction and vertical height correctly", () => {
    expect(project("front", { x: 100, y: 0 }).x).toBeGreaterThan(project("front", { x: 0, y: 0 }).x);
    expect(project("left", { x: 0, y: 100 }).x).toBeGreaterThan(project("left", { x: 0, y: 0 }).x);
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

  it("reveals both ground axes in every directional camera and leaves Top/Isometric unchanged", () => {
    for (const view of ["front", "back", "left", "right"] as const) {
      const a = project(view, { x: 0, y: 0 }), b = project(view, { x: 1000, y: 1000 });
      expect(Math.abs(b.y - a.y)).toBeCloseTo(1000 * Math.sin(DIRECTIONAL_TILT));
      for (const p of [{ x: -2000, y: -2160 }, { x: 1400, y: 775 }, { x: 4800, y: 3920 }]) {
        const original = unprojectGround(view, project(view, p));
        expect(original.x).toBeCloseTo(p.x, 8); expect(original.y).toBeCloseTo(p.y, 8);
      }
    }
    expect(project("top", { x: 80, y: 110 }, 40)).toEqual({ x: 80, y: 110, depth: 110 });
    expect(project("isometric", { x: 200, y: 100 }, 40)).toEqual({ x: 100 * Math.SQRT1_2, y: 300 / Math.sqrt(6) - 40 * Math.sqrt(2 / 3), depth: 300 });
  });

  it("fills the directional viewport while retaining a true whole-world framing option", () => {
    for (const view of ["front", "back", "left", "right"] as const) for (const [w, h] of [[1440, 894], [390, 788]]) {
      const b = projectedBounds(view, WORLD, -120, 320);
      const immersive = frameProjection(view, WORLD, w!, h!), overview = frameProjection(view, WORLD, w!, h!, 120, "overview");
      expect((b.y1 - b.y0) * immersive.scale).toBeGreaterThanOrEqual((h! - 100) * 0.9 - 1e-8);
      expect((b.x1 - b.x0) * overview.scale).toBeLessThanOrEqual(w! - 32 + 1e-8);
      expect((b.y1 - b.y0) * overview.scale).toBeLessThanOrEqual(h! - 100 + 1e-8);
      expect(immersive.x).toBe(overview.x); expect(immersive.y).toBe(overview.y);
    }
  });

  it("sorts opaque trees among structures and uses the near edge of a wide footprint", () => {
    const building = worldObject("hall", "building", 0, 100, 100, 400, 80);
    const tree = worldObject("tree", "tree", 0, 220, 40, 20, 100);
    expect(depthOrder("front", [building, tree]).map((o) => o.id)).toEqual(["tree", "hall"]);
    expect(depthOrder("back", [building, tree]).map((o) => o.id)).toEqual(["tree", "hall"]);
  });

  it("never hides agents behind thin props such as flags, lamps and stalls", () => {
    for (const texture of ["ac-banner", "garden-lantern", "dress-market-stall"]) {
      const prop = { ...worldObject("prop", "prop", 0, 80, 60, 40, 130), metadata: { texture } };
      expect(directionalVisibility("front", [prop])({ x: 0, y: 0 }, 19)).toBe(true);
    }
    const thin = worldObject("post", "prop", 0, 80, 10, 10, 130);
    expect(directionalVisibility("front", [thin])({ x: 0, y: 0 }, 19)).toBe(true);
  });

  it("lets nearer scenery occlude agents along the tilted sight ray in all four directions", () => {
    for (const [view, x, y] of [["front", 0, 80], ["back", 0, -80], ["left", -80, 0], ["right", 80, 0]] as const) {
      for (const type of ["building", "tree"] as const) {
        const block = worldObject("near", type, x, y, 40, 40, 130);
        const visible = directionalVisibility(view, [block]);
        expect(visible({ x: 0, y: 0 }, 19)).toBe(false);
        expect(visible({ x: 0, y: 0 }, 200)).toBe(true);
        expect(visible({ x: x * 2, y: y * 2 }, 19)).toBe(true);
        expect(directionalVisibility(view, [{ ...block, height: 20 }])({ x: 0, y: 0 }, 19)).toBe(true);
      }
    }
    const arena = world.objects.find((o) => o.type === "arena")!;
    expect(directionalVisibility("front", [arena])({ x: 1400, y: 800 }, 19)).toBe(true);
    expect(directionalVisibility("front", [arena])({ x: 1400, y: 910 }, 19)).toBe(true);
    expect(directionalVisibility("front", [arena])({ x: 1260, y: 910 }, 19)).toBe(false);
  });
});


describe("continuous world camera", () => {
  it("matches every canonical basis, including physical left/right orientation", () => {
    const p = { x: -137, y: 924 };
    for (const view of FIELD_VIEWS) {
      const canonical = project(view, p, 80), orbit = project(CAMERA_ANGLES[view], p, 80);
      expect(orbit.x).toBeCloseTo(canonical.x, 8); expect(orbit.y).toBeCloseTo(canonical.y, 8);
      const original = unprojectGround(CAMERA_ANGLES[view], project(CAMERA_ANGLES[view], p));
      expect(original.x).toBeCloseTo(p.x, 8); expect(original.y).toBeCloseTo(p.y, 8);
    }
    for (const view of ["front", "back", "left", "right", "isometric"] as const) {
      const a = frameProjection(view, WORLD, 390, 788), b = frameProjection(CAMERA_ANGLES[view], WORLD, 390, 788);
      expect(b.scale).toBeCloseTo(a.scale, 8);
    }
  });
  it("orbits through west, north and east and can continue through a full revolution", () => {
    const start = CAMERA_ANGLES.front;
    let angle = { ...start };
    for (const view of ["left", "back", "right", "front"] as const) {
      angle = dragCamera(angle, Math.PI / 2 / 0.006, 0);
      expect(yawDelta(angle.yaw, CAMERA_ANGLES[view].yaw)).toBeCloseTo(0, 8);
      expect(angle.tilt).toBe(start.tilt);
    }
    expect(project(angle, { x: 50, y: 90 }, 100).x).toBeCloseTo(project(start, { x: 50, y: 90 }, 100).x, 8);
  });
  it("raises the camera on upward drag and clamps before the ground degenerates", () => {
    expect(dragCamera(CAMERA_ANGLES.front, 0, -20).tilt).toBeGreaterThan(DIRECTIONAL_TILT);
    expect(dragCamera(CAMERA_ANGLES.front, 0, -10000).tilt).toBe(Math.PI / 2);
    expect(dragCamera(CAMERA_ANGLES.front, 0, 10000).tilt).toBeCloseTo(15 * Math.PI / 180);
  });
  it("eases across the yaw seam along the short arc, independently of frame rate", () => {
    const start = { yaw: Math.PI - 0.1, tilt: 0.5 }, target = { yaw: -Math.PI + 0.1, tilt: 1 };
    const step = easeCamera(start, target, 1 / 60);
    expect(step.yaw).toBeGreaterThan(start.yaw); expect(step.yaw - start.yaw).toBeLessThan(0.2);
    expect(step.tilt).toBeGreaterThan(start.tilt); expect(step.tilt).toBeLessThan(target.tilt);
    let sixty = start, thirty = start;
    for (let i = 0; i < 60; i++) sixty = easeCamera(sixty, target, 1 / 60);
    for (let i = 0; i < 30; i++) thirty = easeCamera(thirty, target, 1 / 30);
    expect(sixty.yaw).toBeCloseTo(thirty.yaw, 8); expect(sixty.tilt).toBeCloseTo(thirty.tilt, 8);
  });
  it("occludes live markers at intermediate camera angles without changing objects", () => {
    const o = worldObject("near", "building", 80, 80, 40, 40, 130), original = { ...o };
    const angle = { yaw: Math.PI / 4, tilt: DIRECTIONAL_TILT };
    expect(directionalVisibility(angle, [o])({ x: 0, y: 0 }, 19)).toBe(false);
    expect(directionalVisibility(angle, [o])({ x: 160, y: 160 }, 19)).toBe(true);
    expect(o).toEqual(original);
  });
});
