/**
 * The village's set dressing as data: every piece's picture, place and size,
 * kept apart from the drawing (dressing.ts) and free of Phaser, so the root
 * suite can check it - Old Town's pieces are pinned in test/old-town.test.ts.
 */

import { PIER } from "./world";

export type Piece = {
  key: string;
  image: string;
  x: number;
  y: number;
  scale: number;
  /** Where the foot is, as a share of the picture's height: art is often padded below. */
  foot?: number;
  flip?: boolean;
  /** Solid to walkers: this wide and deep, in world pixels, above the foot. */
  solid?: { width: number; height: number };
  /** A sprite sheet, played on a loop. */
  sheet?: { frameWidth: number; frameHeight: number; frameRate: number; start?: number };
  /** A texture the map already loads, so it is not loaded again. */
  mapped?: boolean;
  /** Rides the water: a slow rise and fall. */
  bob?: boolean;
  /** A fixed depth, for a piece the map's own layering would bury: the lake's water is drawn over anything low in it. */
  depth?: number;
};

const ART = "/village/agenticpad";

/** A piece of the AgenticPad art, drawn at its two world pixels to the art pixel unless told otherwise. */
const art = (name: string, x: number, y: number, scale = 2, more: Partial<Piece> = {}): Piece => ({
  key: `ac-${name}`,
  image: `${ART}/${name}.png`,
  x,
  y,
  scale,
  ...more,
});
const banner = (x: number, y: number, kind: "banner" | "banner-fame" | "banner-gold" = "banner") => art(kind, x, y, 1.5);
/** A flag on a tall pole, the crest on it, in two frames of a slow wave. */
const flag = (x: number, y: number, start = 0) =>
  art("flag", x, y, 1.6, { sheet: { frameWidth: 28, frameHeight: 58, frameRate: 1.6, start } });
const tent = (x: number, y: number, flip = false) => art("tent", x, y, 1.6, { flip, solid: { width: 60, height: 40 } });
const fire = (x: number, y: number): Piece => ({
  key: "effects-fire-fire",
  image: "",
  x,
  y,
  scale: 0.34,
  foot: 0.75,
  mapped: true,
  sheet: { frameWidth: 128, frameHeight: 128, frameRate: 12 },
});
const cottage = (colour: "Blue" | "Red" | "Purple" | "Yellow", x: number, y: number, flip = false): Piece => ({
  key: `dress-house-${colour.toLowerCase()}`,
  image: `${ART}/modern-villa-${colour.toLowerCase()}.png`,
  x,
  y,
  scale: 0.55,
  foot: 172 / 192,
  flip,
  solid: { width: 56, height: 70 },
});
const bush = (key: string, x: number, y: number): Piece => ({ key, image: "", x, y, scale: 0.6, mapped: true });
const gold = (x: number, y: number, scale: number): Piece => ({ key: "prop-gold", image: "/fixtures/Gold.png", x, y, scale });

export const PIECES: Piece[] = [
  // The town's flags: at the ring road's corners and either side of the avenue up to the arena.
  flag(975, 468),
  flag(1825, 468, 1),
  flag(975, 1040, 1),
  flag(1825, 1040),
  flag(1372, 1075, 1),
  flag(1450, 1075),

  // The Hiring Hall: the agents for hire on a board, one picked out.
  art("hiring-board", 738, 1128, 1.6),
  banner(925, 1126),
  banner(778, 1126),

  // The Strategy Lab: a decision tree on an easel and a planning table.
  art("strategy-board", 662, 768, 1.6),
  art("war-table", 935, 702, 1.5),
  banner(712, 762),

  // The Game Hall: screens of the matches playing.
  art("scoreboard", 2168, 772, 1.6, { sheet: { frameWidth: 66, frameHeight: 66, frameRate: 1.2 } }),
  banner(1925, 770),
  banner(2095, 770),

  // The Hall of Fame: a champion in gold and a cup, a banner of navy and gold, a path to the door.
  art("statue", 1300, 474, 1.6),
  art("trophy", 1465, 482, 1.4),
  banner(1538, 456, "banner-fame"),

  // The Treasury: a chest, coins and a sack of gold at its door.
  art("chest", 1640, 476, 1.6),
  art("coins", 1752, 490, 1.4),
  gold(1792, 478, 0.36),
  banner(1602, 456, "banner-gold"),

  // The Lookout.
  banner(1135, 452),

  // Bushes in the corners the arena leaves inside the ring road, the pack's own.
  bush("bush-1", 1046, 548),
  bush("bush-2", 1070, 566),
  bush("bush-4", 1752, 546),
  bush("bush-1", 1730, 566),
  bush("bush-2", 1046, 972),
  bush("bush-4", 1066, 958),
  bush("bush-1", 1754, 972),
  bush("bush-2", 1734, 958),

  // The town square: the fountain, benches round it.
  { key: "dress-fountain", image: "/fixtures/Fountain.png", x: 1400, y: 1172, scale: 0.6, solid: { width: 52, height: 26 } },
  art("bench", 1300, 1204, 1.6),
  art("bench", 1500, 1204, 1.6),

  // The agent grounds. North-west, a camp: tents round a fire.
  tent(795, 560),
  tent(918, 532, true),
  fire(862, 600),
  art("log", 826, 618, 1.6),
  art("log", 900, 620, 1.6, { flip: true }),

  // West, the training yard.
  art("dummy", 610, 905, 1.6),
  art("dummy", 682, 918, 1.6),
  art("bench", 718, 970, 1.6),
  flag(560, 960),

  // North-east, a terrace off the ring: benches, a tent, a fire.
  art("bench", 1925, 604, 1.6),
  art("bench", 2018, 606, 1.6),
  tent(2068, 568, true),
  fire(1972, 660),

  // South-west, a camp at the end of the high street.
  tent(598, 1262),
  fire(655, 1312),
  art("log", 700, 1312, 1.6, { flip: true }),

  // South-east, cottages off the dock road, a fire between them.
  cottage("Blue", 2085, 1250),
  cottage("Yellow", 2160, 1365, true),
  cottage("Red", 1880, 1300),
  fire(2100, 1318),
  art("bench", 2036, 1345, 1.6),

  // The lakeside, at the end of the trail south from the square.
  art("bench", 1340, 1428, 1.6),
  art("bench", 1460, 1428, 1.6),

  // A ship moored off the dock.
  // The pier on the small lake out in the Wilds (world.ts), from its north shore into the water. The old lake
  // below Old Town, its dock and its moored ship went when the world was laid out round it.
  art("pier", PIER.x, PIER.y + 60, 2, { depth: PIER.y + 60 }),
];

/** The tree sheet's frame, in its own pixels: a tree is drawn from the middle of it. */
const TREE_FRAME = 192;

const toSegment = (x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};

/**
 * Whether a tree stands on a road: its canopy clearly over the road, not just
 * brushing its edge. The map places trees without regard to its own roads, so
 * some hid stretches of them; those are not drawn. A positive `verge` keeps
 * the canopy that far off the road's edge instead, as the forest does.
 */
export function overRoad(
  d: { k: string; x: number; y: number; s: number },
  paths: { width: number; points: [number, number][] }[],
  verge = -6,
): boolean {
  if (!d.k.includes("tree")) return false;
  const h = TREE_FRAME * d.s;
  // Only the segments that come near the tree at all: the forest asks this of thousands of trees.
  const near: [[number, number], [number, number], number][] = [];
  for (const p of paths) {
    const reach = p.width / 2 + verge;
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1]!;
      const b = p.points[i]!;
      if (Math.min(a[0], b[0]) - reach > d.x + h * 0.2 || Math.max(a[0], b[0]) + reach < d.x - h * 0.2) continue;
      if (Math.min(a[1], b[1]) - reach > d.y + h * 0.25 || Math.max(a[1], b[1]) + reach < d.y - h * 0.3) continue;
      near.push([a, b, reach]);
    }
  }
  if (near.length === 0) return false;
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-0.3, -0.1, 0.1, 0.25]) {
      const x = d.x + fx * h * 0.2;
      const y = d.y + fy * h;
      for (const [a, b, reach] of near) if (toSegment(x, y, a, b) < reach) return true;
    }
  }
  return false;
}

/** Queue every picture the dressing needs that the map does not already load. Paths are from the site's root. */
