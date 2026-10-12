import type { VillageMap } from "./map-data";
import { CROSSROADS, lakeTerrain, WORLD, type Box, type Pt } from "./world";
import { HIDDEN_ROADS, lots, nearRoad, RESERVED, ROADS, SITES, SQUARE, stands, type Site } from "./town";
import { GARDEN_BENCHES, GARDEN_PONDS, GARDEN_RAILS, SOLAR_LIGHTS } from "./landmarks";
import { byLandscape, MOUNTAINS } from "./landscape";
import { byRiver, RIVER_BRIDGES, waterTerrain } from "./river";
import { COLOSSEUM } from "./arena-geometry";
import { overRoad, PIECES, type Piece } from "./pieces";
import { DISTRICT_PIECES } from "./district-pieces";
import { ACTIVITY_DESTINATIONS } from "./activity-destinations";
import { PIECE_ART, type Plot } from "./growth";
import type { Tree } from "./forest";
import type { ObjectSide, PhysicalKind } from "./object-appearance";
import type { SolidKind, SolidVariant } from "./solid-models";
import { applySolidAppearance } from "./solid-appearance";

export type WorldType = "arena" | "building" | "tree" | "road" | "water" | "bridge" | "mountain" | "stall" | "pond" | "plaza" | "prop" | "movement" | "agent";
export type WorldObject = {
  id: string;
  type: WorldType;
  /** Centre of the ground footprint. x grows east, y grows south; z grows up. */
  x: number; y: number; width: number; depth: number; height: number; elevation: number;
  orientation: "north" | "south" | "east" | "west";
  /** Physical shape and artwork on fixed faces; agents use their own character system. */
  appearance?: PhysicalKind;
  directionalAssets?: Partial<Record<ObjectSide, ArtRef>>;
  /** How a structure with all four views stands (directional-art.ts); without one, its kind's own geometry. */
  structure?: Structure;
  /** Drawn as this true 3D model (solid-models.ts) where WebGL2 allows, in place of its pictures. */
  solid?: SolidKind;
  /** Which build of its family (size, mirror, roof tone, planting); instances that share one share a mesh. */
  solidVariant?: SolidVariant;
  category: "surface" | "structure" | "vegetation" | "prop" | "movement" | "agent";
  shape?: "ellipse";
  points?: readonly Pt[];
  lineWidth?: number;
  metadata?: { texture?: string; label?: string; topAnchor?: Pt; frame?: number; mine?: boolean;
    /** Top's own picture of this object, drawn bottom-centred at `topAnchor`, `width` by `height`. */
    art?: ArtRef;
    /** Lies on the ground in Top (plots, yards, beds), so it is drawn on the ground plane. */
    flat?: boolean;
    /** Labelled in every view. */
    landmark?: boolean };
};

/**
 * A body is a closed volume with a picture on each wall, `depth` its width; a board is a panel
 * `thickness` thick; a cross is two crossed planes through its middle. A body's top is closed by a
 * cap from `eave` to `peak` (fractions of its height) in its own roof and wall colours.
 */
export type Structure = { form: 'body' | 'board' | 'cross'; depth: number; thickness?: number;
  cap?: { eave: number; peak: number; roof: string; wall: string } };
/** A Top texture frame. */
export type ArtRef = { key: string; frame: string | number; flipX?: boolean };
/** Where a frame's pixels are, for a 2D canvas to draw. The image is a browser CanvasImageSource; the model stays DOM-free. */
export type ArtFrame = { image: unknown; x: number; y: number; width: number; height: number;
  /** Opaque pixel bounds, measured once from this same frame; never changes world coordinates. */
  content?: { x: number; y: number; width: number; height: number } };
/** Top's ground layer, rendered once: terrain, roads, plazas, water, banks, flowers, shadows. */
export type TopGround = { image: unknown; x0: number; y0: number; width: number; height: number };

export type WorldModel = {
  bounds: Box;
  slabDepth: number;
  /** Exact top-view recipes, also consumed by navigation. Never projected in place. */
  map: VillageMap;
  sites: Record<string, Site>;
  pieces: readonly Piece[];
  districtPieces: typeof DISTRICT_PIECES;
  /** Top's canopy reservations, derived from the same actual sprite dimensions. */
  lots: Box[];
  hiddenRoads: readonly Pt[][];
  objects: readonly WorldObject[];
};
export type WorldSnapshot = { world: WorldModel; revision: number; agents: WorldObject[]; night: boolean; forestPending: boolean;
  /** Top's ground layer, once rendered; until then views draw the model's surfaces. */
  ground?: TopGround | null;
  /** Resolves an object's `art` to Top's loaded pixels. */
  art?: (ref: ArtRef) => ArtFrame | null };
export type ArtSize = (key: string) => { width: number; height: number } | null;

export function worldObject(id: string, type: WorldType, x: number, y: number, width: number, depth: number, height = 0): WorldObject {
  return { id, type, x, y, width, depth, height, elevation: 0, orientation: "south",
    category: type === "tree" ? "vegetation" : type === "agent" ? "agent" : type === "movement" ? "movement" :
      ["water", "pond", "road", "plaza"].includes(type) ? "surface" : ["arena", "building", "mountain", "stall", "bridge"].includes(type) ? "structure" : "prop" };
}

/** Adapt sprite foot anchors once; approximate missing vertical/depth art, never its world position. */
function standingObject(id: string, key: string, foot: Pt, width: number, artHeight: number, type?: WorldType): WorldObject {
  type ??= /tree/.test(key) ? "tree" : /house|office|apartments|shop|castle|building/.test(key) ? "building" : /market|kiosk/.test(key) ? "stall" : /pier|bridge/.test(key) ? "bridge" : "prop";
  const flat = /farm-bed|plot|yard/.test(key);
  const depth = flat ? artHeight : Math.max(8, Math.min(width * 0.65, artHeight * 0.35));
  const o = worldObject(id, type, foot.x, foot.y - (type === "tree" ? 0 : depth / 2), width, depth, flat ? 3 : artHeight * 0.85);
  o.metadata = { texture: key, topAnchor: { x: foot.x, y: foot.y } };
  return o;
}

/**
 * An object exactly as Top drew it: its texture frame, its natural (unstretched) size and
 * the ground point its picture stands on. `x, y` is the centre of an approximate footprint
 * behind that point, for depth ordering and occlusion only.
 */
export function pictureObject(id: string, art: ArtRef, foot: Pt, width: number, height: number, flat = false): WorldObject {
  const o = standingObject(id, art.key, foot, width, height);
  // Flat art covers its whole picture on the ground, from its foot back.
  if (flat) { o.type = "prop"; o.category = "prop"; o.depth = height; o.y = foot.y - height / 2; }
  o.height = flat ? 3 : height;
  o.metadata = { ...o.metadata, art, flat };
  if (!flat) o.directionalAssets = { front: art };
  return o;
}

/** Prepare the same tile mask for top art, alternate art and the collision grid. */
export function prepareWorldMap(imported: VillageMap): VillageMap {
  const lake = lakeTerrain(), scenic = waterTerrain();
  const covered = new Set(scenic.map(([c, r]) => `${c},${r}`));
  return { ...imported, world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
    baseFrame: 11, paths: ROADS, plazas: CROSSROADS.map((p) => [p.x, p.y]),
    terrain: [...lake.filter(([c, r]) => !covered.has(`${c},${r}`)), ...scenic] };
}

/** The top renderer passes its filtered decorations/props and actual loaded frame sizes. */
export function createWorldModel(map: VillageMap, size: ArtSize, labels: Readonly<Record<string, string>> = {}): WorldModel {
  const byPond = (p: Pt) => GARDEN_PONDS.some((b) => p.x > b.x0 - 42 && p.x < b.x1 + 42 && p.y > b.y0 - 42 && p.y < b.y1 + 42);
  const pieces = PIECES.filter((p) => size(p.key));
  const districtPieces = DISTRICT_PIECES.filter((p) => size(p.key) && !byRiver(p) && !byPond(p) && !nearRoad(p, 50) &&
    !RESERVED.some((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) &&
    !(p.x < 200 && !SITES.bazaar) && !(p.x > 2600 && !SITES.launchpad));
  const taken = lots([...pieces.map((p) => ({ x: p.x, y: p.y, width: size(p.key)!.width * p.scale, height: size(p.key)!.height * p.scale * (p.foot ?? 1) })),
    ...districtPieces.map((p) => ({ x: p.x, y: p.y, width: size(p.key)!.width * p.scale, height: size(p.key)!.height * p.scale }))]);
  map = { ...map, decorations: map.decorations.filter((d) => stands(d, taken) && !overRoad(d, ROADS) && !byPond(d) && !byLandscape(d) && !byRiver(d)) };
  const objects: WorldObject[] = [];
  for (const [i, road] of map.paths.entries()) {
    const points = road.points.map(([x, y]) => ({ x, y }));
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    objects.push({ ...worldObject(`road:${i}`, "road", (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + road.width, y1 - y0 + road.width), points, lineWidth: road.width });
  }
  // Water beneath shoreline sprites is a background layer, not a wet cell. Keep only uncovered tiles.
  const land = new Set(map.terrain.filter((t) => t[2] !== "terrain-water").map(([c, r]) => `${c},${r}`));
  const water = new Set<string>();
  for (const [c, r, key] of map.terrain) if (key === "terrain-water" && !land.has(`${c},${r}`)) water.add(`${c},${r}`);
  for (const cell of water) {
    const [c, r] = cell.split(",").map(Number) as [number, number];
    objects.push({ ...worldObject(`water:${cell}`, "water", c * 64 + 32, r * 64 + 32, 64, 64), elevation: -5 });
  }
  for (const [i, b] of GARDEN_PONDS.entries()) objects.push({ ...worldObject(`pond:${i}`, "pond", (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.x1 - b.x0, b.y1 - b.y0), shape: "ellipse", elevation: -3 });
  for (const [i, [x, y]] of (map.plazas ?? []).entries()) objects.push({ ...worldObject(`plaza:${i}`, "plaza", x, y, 150, 150), shape: "ellipse" });
  objects.push({ ...worldObject("plaza:town-square", "plaza", SQUARE.x, SQUARE.y, SQUARE.rx * 2, SQUARE.ry * 2), shape: "ellipse" });
  for (const [id, s] of Object.entries(SITES)) {
    if (id === "arena") {
      objects.push({ ...worldObject("site:arena", "arena", COLOSSEUM.x, COLOSSEUM.y, COLOSSEUM.rx * 2, COLOSSEUM.ry * 2, COLOSSEUM.wallHeight), shape: "ellipse", metadata: { label: "Arena", topAnchor: { x: s.x, y: s.y } } });
      continue;
    }
    const art = size(`building-${id}`) ?? { width: s.sheet?.width ?? 128, height: s.sheet?.height ?? 160 };
    const o = standingObject(`site:${id}`, `building-${id}`, s, art.width * s.scale, art.height * s.scale, "building");
    o.metadata!.label = labels[id] ?? (id === "launchpad" ? "Launch Pad" : id);
    objects.push(o);
  }
  for (const [i, p] of pieces.entries()) {
    const art = size(p.key);
    if (!art) continue;
    objects.push(standingObject(`piece:${p.key}:${p.x},${p.y}:${i}`, p.key, p, art.width * p.scale, art.height * p.scale * (p.foot ?? 1)));
  }
  for (const [i, p] of districtPieces.entries()) {
    const art = size(p.key);
    if (art) objects.push(standingObject(`district:${i}:${p.key}`, p.key, p, art.width * p.scale, art.height * p.scale));
  }
  for (const [i, d] of map.decorations.entries()) {
    const art = size(d.k);
    if (!art) continue;
    const foot = { x: d.x, y: d.y + (d.k.includes("tree") ? 0 : art.height * d.s / 2) };
    const o = standingObject(`decoration:${i}:${d.k}:${d.x},${d.y}`, d.k, foot, art.width * d.s, art.height * d.s);
    if (d.f !== undefined) o.metadata!.frame = d.f;
    objects.push(o);
  }
  for (const [i, m] of MOUNTAINS.entries()) objects.push({ ...worldObject(`mountain:${i}`, "mountain", m.x, m.y - m.width * 0.3, m.width, m.width * 0.6, m.height), metadata: { label: "Mountain" } });
  for (const [x, y, width] of GARDEN_RAILS) {
    const p = { x: x + width / 2, y };
    if (!nearRoad(p, 25) && !byRiver(p)) objects.push({ ...worldObject(`garden:rail:${x},${y}`, "prop", p.x, y, width, 6, 26), metadata: { texture: "fence" } });
  }
  for (const [x, y] of GARDEN_BENCHES) {
    if (!nearRoad({ x, y }, 15) && !byRiver({ x, y }) && !taken.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)) {
      const art = size("ac-bench");
      if (art) objects.push(standingObject(`garden:bench:${x},${y}`, "ac-bench", { x, y }, art.width * 2, art.height * 2));
    }
  }
  for (const [i, p] of SOLAR_LIGHTS.entries()) objects.push({ ...worldObject(`garden:solar:${i}`, "prop", p.x, p.y, 14, 10, 26), metadata: { texture: "lamp" } });
  for (const p of RIVER_BRIDGES) objects.push({ ...worldObject(`bridge:${p.x},${p.y}`, "bridge", p.x, p.y, 64, 64, 10), elevation: 2 });
  for (const d of ACTIVITY_DESTINATIONS) objects.push({ ...worldObject(`movement:${d.id}`, "movement", d.x, d.y, 64, 64), metadata: { label: d.name } });
  objects.push(worldObject("movement:spawn", "movement", map.spawn.x, map.spawn.y, 64, 64));
  return { bounds: { ...WORLD }, slabDepth: 120, map, sites: SITES, pieces, districtPieces, lots: taken, hiddenRoads: HIDDEN_ROADS, objects: objects.map((o) => applySolidAppearance(o)) };
}

export function treeObject(tree: Tree): WorldObject {
  const o = standingObject(`forest:${tree.id}`, tree.k, tree, 192 * tree.s, 192 * tree.s);
  o.metadata!.frame = tree.f;
  o.metadata!.art = { key: tree.k, frame: tree.f };
  o.height = 192 * tree.s;
  return applySolidAppearance(o);
}

export function plotObjects(plot: Plot): WorldObject[] {
  return plot.pieces.map((p, i) => {
    const art = PIECE_ART[p.image];
    // Top anchors each piece at its own foot fraction (scene.ts build); the picture's bottom sits below it.
    const bottom = { x: p.x, y: p.y + art.height * p.scale * (1 - art.foot) };
    return applySolidAppearance(pictureObject(`growth:${plot.id}:${i}`, { key: `growth-${p.image}`, frame: 0, flipX: p.flip ?? false }, bottom,
      art.width * p.scale, art.height * p.scale, ["Plot", "Yard", "planter"].includes(p.image)));
  });
}
