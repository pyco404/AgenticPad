/**
 * Fixed world coordinates and invisible expansion regions, with organic country lanes.
 * The Arena stays at (1400, 975). Legacy region sizes remain available to forest,
 * camera and growth code; their octagonal edges are never rendered as roads.
 * Pure data and geometry, shared by the renderer and navigation tests.
 */

export type Pt = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Path = { style: "main" | "secondary" | "trail" | "paved" | "dirt"; width: number; points: [number, number][] };

/** The middle of Old Town, which the rings are drawn round: a little below the Arena's centre, where the town's weight is. */
export const CENTRE: Pt = { x: 1400, y: 880 };

/** An octagon: a box with its corners cut off by `chamfer`. */
export type Octagon = { cx: number; cy: number; hw: number; hh: number; chamfer: number };

/** Invisible region containing the original village. */
export const INNER: Octagon = { cx: CENTRE.x, cy: CENTRE.y, hw: 1080, hh: 780, chamfer: 330 };
/** Invisible limit of the first expansion area. */
export const OUTER: Octagon = { cx: CENTRE.x, cy: CENTRE.y, hw: 1840, hh: 1480, chamfer: 560 };
/** Ring roads and main roads: wide and paved. District paths (checkpoint 2) are narrow dirt. */
export const RING_WIDTH = 64;
export const SPOKE_WIDTH = 64;
/** How far past the outer ring the world runs, for now: the Wilds' first band. The far edge is not built yet. */
const WILDS = 1560;

/** The world's extent: Old Town, both rings, and the Wilds round them. Grows with the districts later. */
export const WORLD: Box = {
  x0: OUTER.cx - OUTER.hw - WILDS,
  y0: OUTER.cy - OUTER.hh - WILDS,
  x1: OUTER.cx + OUTER.hw + WILDS,
  y1: OUTER.cy + OUTER.hh + WILDS,
};

/** An octagon's corners, clockwise from the top edge's left end. */
export function corners(o: Octagon): Pt[] {
  const { cx, cy, hw, hh, chamfer: c } = o;
  return [
    { x: cx - hw + c, y: cy - hh },
    { x: cx + hw - c, y: cy - hh },
    { x: cx + hw, y: cy - hh + c },
    { x: cx + hw, y: cy + hh - c },
    { x: cx + hw - c, y: cy + hh },
    { x: cx - hw + c, y: cy + hh },
    { x: cx - hw, y: cy + hh - c },
    { x: cx - hw, y: cy - hh + c },
  ];
}

/** Whether p is inside the octagon grown by `margin` on every side (a negative margin shrinks it). */
export function inOctagon(o: Octagon, p: Pt, margin = 0): boolean {
  const dx = Math.abs(p.x - o.cx);
  const dy = Math.abs(p.y - o.cy);
  return dx <= o.hw + margin && dy <= o.hh + margin && dx + dy <= o.hw + o.hh - o.chamfer + margin * Math.SQRT2;
}

/** How far p is from the octagon's edge: 0 on it, positive outside, negative inside. Exact on the edges, close at the corners. */
export function fromEdge(o: Octagon, p: Pt): number {
  const dx = Math.abs(p.x - o.cx);
  const dy = Math.abs(p.y - o.cy);
  return Math.max(dx - o.hw, dy - o.hh, (dx + dy - (o.hw + o.hh - o.chamfer)) / Math.SQRT2);
}

/**
 * Old Town's own ground, as the imported map has it: everything inside the
 * inner ring that was land before the world was laid out round it. The old
 * lake lay below OLD_SHORE; that ground is new, and the garden there is
 * grown (forest.ts) rather than imported.
 */
export const OLD_SHORE = 1472;
export const onOldGround = (p: Pt) => fromEdge(INNER, p) < -(RING_WIDTH / 2 + 30) && p.y < OLD_SHORE - 20;

/** In New Town: between the two rings, clear of both roads. */
export const inNewTown = (p: Pt, margin = RING_WIDTH / 2 + 10) => fromEdge(INNER, p) > margin && fromEdge(OUTER, p) < -margin;
/** In the garden strip: inside the inner ring, outside Old Town's ellipse (town.ts TOWN). */
export const inGarden = (p: Pt) => fromEdge(INNER, p) < -(RING_WIDTH / 2 + 10) && ((p.x - 1400) / 880) ** 2 + ((p.y - 860) / 540) ** 2 > 1;
/** Out in the Wilds: beyond the outer ring road. */
export const inWilds = (p: Pt) => fromEdge(OUTER, p) > RING_WIDTH / 2 + 10;

/** Sampled bends share the same vertices for rendering and routing. */
export function curvedPath(style: Path["style"], width: number, controls: [number, number][]): Path {
  const points: [number, number][] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[Math.max(0, i - 1)]!, b = controls[i]!, c = controls[i + 1]!, d = controls[Math.min(controls.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 36));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      points.push([0, 1].map((k) => Math.round(0.5 * (2 * b[k]! + (-a[k]! + c[k]!) * t + (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - d[k]!) * t2 + (-a[k]! + 3 * b[k]! - 3 * c[k]! + d[k]!) * t3))) as [number, number]);
    }
  }
  points.push(controls.at(-1)!);
  return { style, width, points };
}

/** Uneven routes into the countryside; none outlines the world's boundary. */
export const COUNTRY_LANES: { id: string; controls: [number, number][] }[] = [
  { id: "west", controls: [[665,790],[350,850],[80,980],[-60,1170],[-420,1030],[-800,890],[-1350,820]] },
  { id: "north-west", controls: [[1000,488],[930,390],[600,350],[420,180],[180,-40],[-100,-320],[-650,-550],[-1100,-800]] },
  { id: "north-east", controls: [[1800,488],[1770,280],[1840,100],[2060,-160],[2460,-260],[2850,-650],[3300,-950]] },
  { id: "east", controls: [[2130,790],[2200,850],[2336,864],[2490,850],[2690,1040],[2860,1267],[3200,1340],[3700,1190]] },
  { id: "south-east", controls: [[1966,1472],[2060,1710],[2240,1800],[2480,1840],[2790,2120],[3150,2300]] },
  { id: "south", controls: [[1400,1370],[1380,1550],[1220,1790],[1320,2060],[1460,2310],[1330,2600],[1560,2900]] },
];
/** Compatibility anchors for scenery: these are village waypoints, no longer ring crossings. */
export type Spoke = { id: string; start: Pt; inner: Pt; outer: Pt; end: Pt };
export const SPOKES: Spoke[] = COUNTRY_LANES.map(({id, controls}) => {
  const at = (i: number): Pt => ({ x: controls[i]![0], y: controls[i]![1] });
  return { id, start: at(0), inner: at(2), outer: at(4), end: at(controls.length - 1) };
});
/** A handful of small gathering places, rather than a roundabout at every bend. */
export const CROSSROADS: Pt[] = [{x:350,y:850},{x:2490,y:850},{x:1220,y:1790}];
export const WORLD_ROADS: Path[] = COUNTRY_LANES.map(({controls}) => curvedPath("dirt", 38, controls));
const round = (p: Pt): [number, number] => [Math.round(p.x), Math.round(p.y)];

/** How wide a spur is: a narrow walking path from a building to its lane. */
export const SPUR_WIDTH = 28;

/** Connect building doors to the nearest country lane, splitting at the shared junction. */
export function withSpurs(roads: readonly Path[], doors: readonly Pt[]): Path[] {
  const out = roads.map((r) => ({ ...r, points: [...r.points] }));
  const spurs: Path[] = [];
  for (const door of doors) {
    let best: { lane: Path; at: Pt; after: number; dist: number } | null = null;
    for (const lane of out) {
      lane.points.forEach(([ax, ay], i) => {
        const b = lane.points[i + 1];
        if (!b) return;
        const [bx, by] = b;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((door.x - ax) * dx + (door.y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const at = { x: ax + t * dx, y: ay + t * dy };
        const dist = Math.hypot(door.x - at.x, door.y - at.y);
        if (!best || dist < best.dist - 0.5) best = { lane, at, after: i, dist };
      });
    }
    if (!best) continue;
    const { lane, at, after, dist } = best as { lane: Path; at: Pt; after: number; dist: number };
    if (dist < 1) continue;
    const join = round(at);
    if (!lane.points.some(([x, y]) => x === join[0] && y === join[1])) lane.points.splice(after + 1, 0, join);
    spurs.push({ style: "dirt", width: SPUR_WIDTH, points: [round(door), join] });
  }
  return [...out, ...spurs];
}

/**
 * The lake: small and rounded, out in the Wilds off the south-west, between
 * the west and south main roads, well clear of the outer ring. Scenery only -
 * a pier from its north shore, one sailboat. In whole tiles, so it lies on the
 * ground's grid: a tile is water if its middle falls inside the ellipse.
 */
export const TILE = 64;
export const LAKE = { cx: 10.5, cy: 44, rx: 5.6, ry: 3.6 };
const isLake = (c: number, r: number) => ((c + 0.5 - LAKE.cx) / LAKE.rx) ** 2 + ((r + 0.5 - LAKE.cy) / LAKE.ry) ** 2 <= 1;
const LAKE_COLS = { c0: Math.floor(LAKE.cx - LAKE.rx) - 1, c1: Math.ceil(LAKE.cx + LAKE.rx) + 1 };
const LAKE_ROWS = { r0: Math.floor(LAKE.cy - LAKE.ry) - 1, r1: Math.ceil(LAKE.cy + LAKE.ry) + 1 };
/** Every water tile, as [column, row]. */
export const LAKE_TILES: [number, number][] = [];
for (let r = LAKE_ROWS.r0; r <= LAKE_ROWS.r1; r++) for (let c = LAKE_COLS.c0; c <= LAKE_COLS.c1; c++) if (isLake(c, r)) LAKE_TILES.push([c, r]);
export const LAKE_BOX: Box = {
  x0: Math.min(...LAKE_TILES.map(([c]) => c)) * TILE,
  y0: Math.min(...LAKE_TILES.map(([, r]) => r)) * TILE,
  x1: (Math.max(...LAKE_TILES.map(([c]) => c)) + 1) * TILE,
  y1: (Math.max(...LAKE_TILES.map(([, r]) => r)) + 1) * TILE,
};
/** The pier: out from the middle of the north shore into the water, where strollers walk and swimmers climb out. */
const pierCol = Math.floor(LAKE.cx);
const pierRow = Math.min(...LAKE_TILES.filter(([c]) => c === pierCol).map(([, r]) => r));
export const PIER: Pt = { x: pierCol * TILE + TILE / 2, y: pierRow * TILE + 40 };
/** The path down to the pier, branching from the southern country lane. */
export const LAKE_PATH: Path = {
  style: "dirt",
  width: 28,
  points: [[1220,1790], [1100,2130], [Math.round(PIER.x + 260), Math.round(PIER.y - 230)], [Math.round(PIER.x), Math.round(PIER.y - 70)]],
};

/**
 * The lake as the map's terrain: water tiles, and every grass tile beside the
 * water turned to face it (Tilemap_Flat's 3x3: 0 1 2 / 10 11 12 / 20 21 22,
 * the outer ones edged on the sides they sit on). Water runs under the edge
 * tiles too, so their rim shows water. A tile with water on opposite sides
 * keeps the plain middle.
 */
export function lakeTerrain(): [number, number, string, number][] {
  const water = new Set(LAKE_TILES.map(([c, r]) => `${c},${r}`));
  const wet = (c: number, r: number) => water.has(`${c},${r}`);
  const out: [number, number, string, number][] = [];
  for (let r = LAKE_ROWS.r0 - 1; r <= LAKE_ROWS.r1 + 1; r++) {
    for (let c = LAKE_COLS.c0 - 1; c <= LAKE_COLS.c1 + 1; c++) {
      if (wet(c, r)) {
        out.push([c, r, "terrain-water", 0]);
        continue;
      }
      const up = wet(c, r - 1);
      const down = wet(c, r + 1);
      const left = wet(c - 1, r);
      const right = wet(c + 1, r);
      const diagonal = wet(c - 1, r - 1) || wet(c + 1, r - 1) || wet(c - 1, r + 1) || wet(c + 1, r + 1);
      if (!up && !down && !left && !right && !diagonal) continue;
      // The grass tile's edge faces the water: water below it wants the bottom row (20-22), above it the top (0-2).
      const row = up && down ? 1 : down ? 2 : up ? 0 : 1;
      const col = left && right ? 1 : right ? 2 : left ? 0 : 1;
      out.push([c, r, "terrain-water", 0]);
      out.push([c, r, "terrain-color1", row * 10 + col]);
    }
  }
  return out;
}

/** The ground the world opens on: Old Town and as much of New Town as is built (scene.ts frames it). */
export const NEW_TOWN_BOX: Box = { x0: OUTER.cx - OUTER.hw, y0: OUTER.cy - OUTER.hh, x1: OUTER.cx + OUTER.hw, y1: OUTER.cy + OUTER.hh };
