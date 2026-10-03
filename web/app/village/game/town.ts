import type { Point } from "./roads";

/**
 * The settlement's plan: where each building stands, the roads between them,
 * the agent grounds at the forest's edge, and which of the forest's trees give
 * way to it. The map (public/village/map.json) still brings the forest, the
 * lake and the ground; the town on it is laid out here, so an import of Agent
 * Quest's map (scripts/village-import.ts) never loses it.
 *
 * It is laid out to be read as the game is played, around the arena at its
 * heart:
 *
 *   - west, the way in: the Hiring Hall (get an agent), then the Strategy Lab
 *     (give it a strategy);
 *   - the middle: the arena, where agents compete, its front gate on the
 *     avenue up from the town square;
 *   - east: the Game Hall, with its screens of the matches playing;
 *   - north, behind the arena: the Treasury (what is won) and the Hall of
 *     Fame (who won it);
 *   - south, the town square: the leaderboard, the fountain, the Rulebook House;
 *   - round the edge, before the forest: the agent grounds, camps and a
 *     training yard where waiting agents wander.
 *
 * Positions are world pixels, each building's bottom-centre. The art drawn for
 * AgentClash (scripts/village-art.ts, in /village/agentclash) is at one art
 * pixel to two world pixels, so it is drawn at scale 2.
 */

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type Site = {
  x: number;
  y: number;
  /** Its picture, from the site's root, and how big it is drawn against it. */
  art: string;
  scale: number;
  /** A sprite sheet's frame size, for a building that animates; played on a slow loop. */
  sheet?: { width: number; height: number; frameRate: number };
  /** Where agents gather, when it is not just below its foot. */
  door?: Point;
  /** A fixed depth, for a building agents stand inside of rather than in front of. */
  depth?: number;
  /** Where its name sits, as a world y, when over its roof would be wrong. */
  labelY?: number;
  /** What is solid to walkers, when its picture's box is not. */
  blocks?: Rect[];
};

const ART = "/village/agentclash";

/** The arena: 330 × 230 art pixels (scripts/village-art.ts), its sand an oval 236 × 100 world pixels across. */
const ARENA_FOOT = { x: 1400, y: 975 };
const ARENA_TOP = ARENA_FOOT.y - 230 * 2;
export const ARENA_FIELD = { x: 1400, y: ARENA_TOP + 154 * 2, rx: 236, ry: 100 };

/** Matches stand on the sand in rows of this many, each pair this far from the next. */
export const ARENA_LAYOUT = { cols: 3, pairX: 132, pairY: 58 };

export const SITES: Record<string, Site> = {
  arena: {
    ...ARENA_FOOT,
    art: `${ART}/arena.png`,
    scale: 2,
    // The first row of matches: three rows fit on the sand.
    door: { x: ARENA_FIELD.x, y: ARENA_FIELD.y - 60 },
    depth: -300,
    // Over the canopied box at the back, clear of the running scores over the matches below it.
    labelY: ARENA_TOP + 146,
    // The stands and the walls; the sand and the three gates stay open.
    blocks: [
      { x0: 1080, y0: 600, x1: 1720, y1: 712 },
      { x0: 1072, y0: 712, x1: 1150, y1: 950 },
      { x0: 1650, y0: 712, x1: 1728, y1: 950 },
      { x0: 1150, y0: 928, x1: 1340, y1: 968 },
      { x0: 1412, y0: 928, x1: 1650, y1: 968 },
    ],
  },
  tavern: { x: 850, y: 1125, art: "/village/buildings/Tavern.png", scale: 0.5 },
  castle: { x: 800, y: 760, art: `${ART}/strategy-lab.png`, scale: 0.5 },
  forge: { x: 2010, y: 765, art: `${ART}/game-hall.png`, scale: 0.45 },
  library: { x: 1400, y: 452, art: "/village/buildings/Library.png", scale: 0.55 },
  chapel: { x: 1705, y: 452, art: "/village/buildings/Chapel.png", scale: 0.45 },
  watchtower: { x: 1090, y: 450, art: `${ART}/lookout.png`, scale: 0.4 },
  alchemist: { x: 1770, y: 1125, art: "/village/buildings/Alchemist.png", scale: 0.35 },
  board: { x: 1595, y: 1128, art: `${ART}/leaderboard.png`, scale: 1.6, sheet: { width: 84, height: 74, frameRate: 1.5 } },
};

/** The arena's sand: open to walkers, but nowhere anyone strolls to. */
export const RESERVED: Rect[] = [{ x0: 1150, y0: 712, x1: 1650, y1: 930 }];

/** Every road is drawn alike (map.ts); the style only says what kind of road it is. */
type Path = { style: "main" | "secondary" | "trail"; width: number; points: [number, number][] };

/**
 * The roads. A road joins another only at a point both name (roads.ts stitches
 * an end to the nearest vertex), so every junction is a vertex of the road it
 * meets.
 */
export const ROADS: Path[] = [
  // The ring round the arena, with a vertex at every road that leaves it.
  {
    style: "main",
    width: 54,
    points: [
      [1000, 488],
      [1090, 488],
      [1400, 488],
      [1705, 488],
      [1800, 488],
      [1800, 560],
      [1800, 790],
      [1800, 1010],
      [1400, 1010],
      [1000, 1010],
      [1000, 790],
      [1000, 560],
      [1000, 488],
    ],
  },
  // The avenue, from the square across the ring road and up to the arena's gate.
  { style: "main", width: 58, points: [[1400, 962], [1400, 1010], [1400, 1150]] },
  // The high street, west to east past the square, and on to the dock.
  {
    style: "main",
    width: 50,
    points: [
      [700, 1150],
      [850, 1150],
      [1000, 1150],
      [1400, 1150],
      [1595, 1150],
      [1770, 1150],
      [1800, 1150],
      [1966, 1150],
    ],
  },
  { style: "main", width: 50, points: [[1000, 1010], [1000, 1150]] },
  { style: "main", width: 50, points: [[1800, 1010], [1800, 1150]] },
  { style: "main", width: 52, points: [[1966, 1150], [1966, 1472]] },
  // To the halls either side of the arena.
  { style: "secondary", width: 44, points: [[1000, 790], [800, 790], [665, 790]] },
  { style: "secondary", width: 44, points: [[1800, 790], [2010, 790], [2130, 790]] },
  // To the buildings behind it.
  { style: "secondary", width: 36, points: [[1090, 488], [1090, 455]] },
  { style: "secondary", width: 36, points: [[1705, 488], [1705, 457]] },
  // Trails out to the agent grounds.
  { style: "trail", width: 34, points: [[1000, 560], [870, 560], [860, 600]] },
  { style: "trail", width: 34, points: [[665, 790], [655, 860], [650, 930]] },
  { style: "trail", width: 34, points: [[1800, 560], [1960, 560], [1975, 610]] },
  { style: "trail", width: 34, points: [[700, 1150], [660, 1210], [650, 1270]] },
  { style: "trail", width: 34, points: [[1400, 1150], [1400, 1370]] },
  { style: "trail", width: 34, points: [[1966, 1290], [2060, 1290]] },
];

/**
 * Ways only agents know: across the arena's sand to every spot a match can
 * take, so an agent called to one walks in by the gate rather than over the
 * wall. Never drawn.
 */
export const HIDDEN_ROADS: Point[][] = [
  [
    { x: 1400, y: 1010 },
    { x: 1400, y: 950 },
    { x: 1400, y: 880 },
    { x: 1400, y: 820 },
    { x: 1400, y: 762 },
  ],
  ...[762, 820, 878].map((y) => [-220, -150, -80, 0, 80, 150, 220].map((dx) => ({ x: 1400 + dx, y }))),
];

/** Paving the roads do not draw: the town square round the fountain, and a carpet up to the Hall of Fame. */
export const SQUARE = { x: 1400, y: 1160, rx: 150, ry: 58 };
export const CARPET = { x: 1400, y0: 454, y1: 490, width: 28 };

/** Where waiting agents wander to at the edge of town: camps, the training yard, the square, the lakeside. */
export const GROUNDS: Point[] = [
  { x: 862, y: 618 },
  { x: 800, y: 600 },
  { x: 650, y: 955 },
  { x: 610, y: 925 },
  { x: 1975, y: 630 },
  { x: 1925, y: 610 },
  { x: 650, y: 1295 },
  { x: 2050, y: 1310 },
  { x: 1330, y: 1215 },
  { x: 1470, y: 1215 },
  { x: 1400, y: 1405 },
  { x: 1350, y: 1395 },
];

/** The settlement: inside it, the forest gives way to the town. */
const TOWN = { x: 1400, y: 860, rx: 880, ry: 540 };
export const inTown = (p: Point) => ((p.x - TOWN.x) / TOWN.rx) ** 2 + ((p.y - TOWN.y) / TOWN.ry) ** 2 <= 1;

const segmentDistance = (p: Point, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
};

/** Whether a point is on a road, its edge within `margin`. */
export function nearRoad(p: Point, margin: number): boolean {
  return ROADS.some((r) => r.points.some((a, i) => i > 0 && segmentDistance(p, r.points[i - 1]!, a) < r.width / 2 + margin));
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * The town's lots: each building and the ground its agents stand on, each
 * piece of dressing, each spot in the grounds. Nothing of the forest is drawn
 * over one.
 */
export function lots(pieces: { x: number; y: number; width: number; height: number }[]): Rect[] {
  const out: Rect[] = [
    { x0: 1050, y0: 500, x1: 1750, y1: 990 },
    { x0: SQUARE.x - SQUARE.rx - 30, y0: SQUARE.y - SQUARE.ry - 40, x1: SQUARE.x + SQUARE.rx + 30, y1: SQUARE.y + SQUARE.ry + 30 },
  ];
  for (const [id, s] of Object.entries(SITES)) {
    if (id === "arena") continue;
    const w = 130 * s.scale * (s.sheet ? 0.5 : 1) + 60;
    out.push({ x0: s.x - w, y0: s.y - 300, x1: s.x + w, y1: s.y + 40 });
    // The queue below a hall's door.
    out.push({ x0: s.x - 120, y0: s.y, x1: s.x + 120, y1: s.y + 190 });
  }
  for (const p of pieces) out.push({ x0: p.x - p.width / 2 - 20, y0: p.y - p.height - 20, x1: p.x + p.width / 2 + 20, y1: p.y + 30 });
  for (const g of GROUNDS) out.push({ x0: g.x - 60, y0: g.y - 60, x1: g.x + 60, y1: g.y + 40 });
  return out;
}

/** Small things of the forest floor that may stay in town, off the roads and the lots. */
const SMALL = /^(bush-|rock-[123]$|stump-|deco-0[239]$|deco-1[01]$)/;

/**
 * Whether one of the map's decorations still stands with the town on it.
 * Outside the town, everything does. Inside it a tree stays only where its
 * canopy is clear of every road and lot - the woods between the town's
 * quarters - and the small things only off them; the rest of what the map put
 * there (a gold mine, a lone tower, rows of stones) belonged to the old
 * layout.
 */
export function stands(d: { k: string; x: number; y: number; s: number }, taken: Rect[]): boolean {
  if (d.k.includes("water") || d.k.includes("bridge")) return true;
  if (!inTown(d)) return true;
  if (d.k.includes("tree")) {
    const canopy = { x0: d.x - 62 * d.s, y0: d.y - 150 * d.s, x1: d.x + 62 * d.s, y1: d.y + 10 };
    if (taken.some((l) => overlaps(canopy, l))) return false;
    return ![{ x: d.x, y: d.y }, { x: d.x, y: d.y - 60 * d.s }, { x: d.x - 50 * d.s, y: d.y - 50 * d.s }, { x: d.x + 50 * d.s, y: d.y - 50 * d.s }].some((p) => nearRoad(p, 6));
  }
  if (!SMALL.test(d.k)) return false;
  return !nearRoad(d, 12) && !taken.some((l) => d.x > l.x0 && d.x < l.x1 && d.y > l.y0 && d.y < l.y1);
}

/** The part of the world worth framing: every building, with room for the names over the top row. */
export function townBounds(): Rect {
  const xs = Object.values(SITES).map((s) => s.x);
  const ys = Object.values(SITES).map((s) => s.y);
  return { x0: Math.min(...xs) - 170, y0: Math.min(...ys) - 230, x1: Math.max(...xs) + 170, y1: Math.max(...ys) + 150 };
}
