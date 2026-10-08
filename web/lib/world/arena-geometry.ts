import type { Point } from "./roads";

/** Logical geometry shared by the pixel art, wall collisions and match destinations. */
export const COLOSSEUM = { x: 1400, y: 775, rx: 380, ry: 200, wallHeight: 48 };
export const COLOSSEUM_FLOOR = { x: 1400, y: 800, rx: 270, ry: 125 };
export const ARENA_ENTRANCES = { front: { x: 1400, y: 1010 }, east: { x: 1810, y: 775 } };
export const ARENA_GATE_WIDTH = 192;
export const ARENA_SIDE_WIDTH = 128;
export const insideOval = (p: Point, oval: { x: number; y: number; rx: number; ry: number }) => ((p.x - oval.x) / oval.rx) ** 2 + ((p.y - oval.y) / oval.ry) ** 2 <= 1;
/** Open corridors shared by navigation and sight rays through the arena shell. */
export const ARENA_PASSAGES = [
  { x0: COLOSSEUM.x - ARENA_GATE_WIDTH / 2, x1: COLOSSEUM.x + ARENA_GATE_WIDTH / 2, y0: COLOSSEUM_FLOOR.y, y1: Infinity },
  { x0: COLOSSEUM_FLOOR.x + 170, x1: Infinity, y0: COLOSSEUM.y - ARENA_SIDE_WIDTH / 2, y1: COLOSSEUM.y + ARENA_SIDE_WIDTH / 2 },
] as const;
const corridor = (p: Point) => ARENA_PASSAGES.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
export const arenaSolid = (p: Point) => insideOval(p, COLOSSEUM) && !insideOval(p, COLOSSEUM_FLOOR) && !corridor(p);

/** Tile-aligned boxes never spill into adjacent gate cells on the existing 64px grid. */
export const ARENA_BLOCKS: { x0: number; y0: number; x1: number; y1: number }[] = [];
for (let y = Math.floor((COLOSSEUM.y - COLOSSEUM.ry) / 64) * 64; y < COLOSSEUM.y + COLOSSEUM.ry; y += 64) {
  for (let x = Math.floor((COLOSSEUM.x - COLOSSEUM.rx) / 64) * 64; x < COLOSSEUM.x + COLOSSEUM.rx; x += 64) {
    const centre = { x: x + 32, y: y + 32 };
    const solid = [16, 32, 48].some((dx) => [16, 32, 48].some((dy) => arenaSolid({ x: x + dx, y: y + dy })));
    if (solid && !corridor(centre)) ARENA_BLOCKS.push({ x0: x + 1, y0: y + 1, x1: x + 62, y1: y + 62 });
  }
}
export const ARENA_RESERVED = [{ x0: COLOSSEUM_FLOOR.x - COLOSSEUM_FLOOR.rx, y0: COLOSSEUM_FLOOR.y - COLOSSEUM_FLOOR.ry, x1: COLOSSEUM_FLOOR.x + COLOSSEUM_FLOOR.rx, y1: COLOSSEUM_FLOOR.y + COLOSSEUM_FLOOR.ry }];

/** The four torch posts at the Arena's gates: two either side of the south gate, two by the north. */
export const ARENA_TORCHES: readonly Point[] = [{ x: 1280, y: 994 }, { x: 1520, y: 994 }, { x: 1070, y: 640 }, { x: 1730, y: 640 }];
