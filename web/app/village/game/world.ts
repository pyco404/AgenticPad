/**
 * The world round the village: Old Town at the centre, as it always stood
 * (town.ts), a garden strip, the inner ring road, New Town, the outer ring
 * road, six main roads running out from Old Town through both rings to the
 * edge of the map, and the Wilds beyond - forest, and a small lake off one
 * side. Launch districts (checkpoint 2) go out in the Wilds.
 *
 * Old Town keeps its own coordinates - the Arena at (1400, 975) - and the
 * world grows round it, into negative coordinates where it must: nothing
 * players know moves. The rings are octagons, not circles: they read as
 * rings at a glance and lie well on the 64-pixel grid.
 *
 * Pure, and free of Phaser and the web app's aliases, so the root suite can
 * test it; the scene draws what it says.
 */

export type Pt = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
type Path = { style: "main" | "secondary" | "trail" | "paved" | "dirt"; width: number; points: [number, number][] };

/** The middle of Old Town, which the rings are drawn round: a little below the Arena's centre, where the town's weight is. */
export const CENTRE: Pt = { x: 1400, y: 880 };

/** An octagon: a box with its corners cut off by `chamfer`. */
export type Octagon = { cx: number; cy: number; hw: number; hh: number; chamfer: number };

/** The inner ring road, round Old Town and its garden strip. */
export const INNER: Octagon = { cx: CENTRE.x, cy: CENTRE.y, hw: 1080, hh: 780, chamfer: 330 };
/** The outer ring road, round New Town. */
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

/**
 * The six main roads. Each starts at the end of one of Old Town's own roads
 * and runs straight out, away from the centre, to the edge of the world. The
 * angles are uneven on purpose - they follow where Old Town's roads leave it,
 * and none runs through the south-west camp or over a building.
 */
export const SPOKE_STARTS: { id: string; from: [number, number]; dir: [number, number] }[] = [
  // West, from the lane past the Strategy Lab.
  { id: "west", from: [665, 790], dir: [-1, -0.06] },
  // North-west and north-east, from the ring road's corners behind the Arena.
  { id: "north-west", from: [1000, 488], dir: [-1, -0.98] },
  { id: "north-east", from: [1800, 488], dir: [1, -0.98] },
  // East, from the lane past the Game Hall.
  { id: "east", from: [2130, 790], dir: [1, -0.06] },
  // South-east, from the end of the dock road, where the old dock was.
  { id: "south-east", from: [1966, 1472], dir: [1, 1.05] },
  // South, from the trail down from the square, between its two benches.
  { id: "south", from: [1400, 1370], dir: [0, 1] },
];

/** Where the ray from `a` along `d` first crosses the segment p-q, and how far along the ray; null if it doesn't. */
function crossing(a: Pt, d: Pt, p: Pt, q: Pt): { t: number; at: Pt } | null {
  const e = { x: q.x - p.x, y: q.y - p.y };
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p.x - a.x) * e.y - (p.y - a.y) * e.x) / den;
  const u = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / den;
  if (t <= 0 || u < 0 || u > 1) return null;
  return { t, at: { x: a.x + d.x * t, y: a.y + d.y * t } };
}

/** Where a ray leaves the world's box. */
function toEdge(a: Pt, d: Pt): Pt {
  const ts = [
    d.x > 0 ? (WORLD.x1 - a.x) / d.x : d.x < 0 ? (WORLD.x0 - a.x) / d.x : Infinity,
    d.y > 0 ? (WORLD.y1 - a.y) / d.y : d.y < 0 ? (WORLD.y0 - a.y) / d.y : Infinity,
  ];
  const t = Math.min(...ts);
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

const round = (p: Pt): [number, number] => [Math.round(p.x), Math.round(p.y)];

/** A main road: its start in Old Town, where it crosses each ring (its crossroads), and its end at the world's edge. */
export type Spoke = { id: string; start: Pt; inner: Pt; outer: Pt; end: Pt };

export const SPOKES: Spoke[] = SPOKE_STARTS.map(({ id, from, dir }) => {
  const start = { x: from[0], y: from[1] };
  const d = { x: dir[0], y: dir[1] };
  const hit = (o: Octagon) => {
    const cs = corners(o);
    let best: { t: number; at: Pt } | null = null;
    cs.forEach((p, i) => {
      const c = crossing(start, d, p, cs[(i + 1) % cs.length]!);
      if (c && (!best || c.t < best.t)) best = c;
    });
    return (best as { t: number; at: Pt } | null)?.at ?? start;
  };
  const r = (p: Pt) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  return { id, start, inner: r(hit(INNER)), outer: r(hit(OUTER)), end: r(toEdge(start, d)) };
});

/** Every crossroads: where a main road crosses a ring. Each gets a paved plaza. */
export const CROSSROADS: Pt[] = SPOKES.flatMap((s) => [s.inner, s.outer]);

/**
 * A ring as a road: its corners in order, with a vertex at every crossroads
 * on it, so the main roads join it there (roads.ts joins roads only at a
 * point both name).
 */
function ringPath(o: Octagon, at: (s: Spoke) => Pt): Path {
  const cs = corners(o);
  const points: Pt[] = [];
  cs.forEach((p, i) => {
    const q = cs[(i + 1) % cs.length]!;
    points.push(p);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const on = SPOKES.map(at)
      .filter((c) => Math.abs((q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x)) / len < 2)
      .filter((c) => Math.min(p.x, q.x) - 2 <= c.x && c.x <= Math.max(p.x, q.x) + 2 && Math.min(p.y, q.y) - 2 <= c.y && c.y <= Math.max(p.y, q.y) + 2)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    points.push(...on);
  });
  points.push(cs[0]!);
  return { style: "paved", width: RING_WIDTH, points: points.map(round) };
}

/** The world's roads beyond Old Town's own: both rings and the six main roads, all paved. */
export const WORLD_ROADS: Path[] = [
  ringPath(INNER, (s) => s.inner),
  ringPath(OUTER, (s) => s.outer),
  ...SPOKES.map((s) => ({ style: "paved" as const, width: SPOKE_WIDTH, points: [s.start, s.inner, s.outer, s.end].map(round) })),
];

/** How wide a spur is: a short paved road from a building out in New Town to its ring road. */
export const SPUR_WIDTH = RING_WIDTH;

/**
 * Short paved roads from New Town's buildings to the nearer ring road (the
 * inner one when both are as near), each joining it at a new vertex on the
 * ring so walkers can turn there. Returns the world's roads with those
 * vertices added, then the spurs.
 */
export function withSpurs(roads: readonly Path[], doors: readonly Pt[]): Path[] {
  const out = roads.map((r) => ({ ...r, points: [...r.points] }));
  const rings = out.slice(0, 2);
  const spurs: Path[] = [];
  for (const door of doors) {
    let best: { ring: Path; at: Pt; after: number; dist: number } | null = null;
    for (const ring of rings) {
      ring.points.forEach(([ax, ay], i) => {
        const b = ring.points[i + 1];
        if (!b) return;
        const [bx, by] = b;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((door.x - ax) * dx + (door.y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const at = { x: ax + t * dx, y: ay + t * dy };
        const dist = Math.hypot(door.x - at.x, door.y - at.y);
        if (!best || dist < best.dist - 0.5) best = { ring, at, after: i, dist };
      });
    }
    if (!best) continue;
    const { ring, at, after } = best as { ring: Path; at: Pt; after: number };
    const join = round(at);
    if (!ring.points.some(([x, y]) => x === join[0] && y === join[1])) ring.points.splice(after + 1, 0, join);
    spurs.push({ style: "paved", width: SPUR_WIDTH, points: [round(door), join] });
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
/** The path down to the pier, from the south main road where it crosses the outer ring. */
export const LAKE_PATH: Path = {
  style: "dirt",
  width: RING_WIDTH,
  points: [round(SPOKES.find((s) => s.id === "south")!.outer), [Math.round(PIER.x + 260), Math.round(PIER.y - 230)], [Math.round(PIER.x), Math.round(PIER.y - 70)]],
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
