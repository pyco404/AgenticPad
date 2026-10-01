import type { VillageMap } from "./map";
import type { Point } from "./roads";
import type { Rect } from "./town";

const TILE = 64;

/** Eight directions, straight ones first; each step costs its length. */
const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Where a villager can set foot, on the map's own 64-pixel tiles: grass is
 * ground, water is not, and neither is a building's footprint. Heroes use it
 * to go anywhere in the world - down to the lake, out into the woods - by the
 * shortest dry way. Inside the village they keep to the roads instead (Roads).
 */
export class Ground {
  readonly cols: number;
  readonly rows: number;
  private open: boolean[];
  /** Dry tiles with water beside them: somewhere to stand and look at the lake. */
  readonly shore: Point[];
  /** Every dry tile away from the world's rim, so a stroll never ends half off the map. */
  readonly anywhere: Point[];
  /** The middle of every water tile: somewhere to swim. */
  readonly water: Point[] = [];
  private wet = new Set<number>();

  constructor(
    map: VillageMap,
    buildings: { x: number; y: number; width: number; height: number }[],
    /** Solid as they are drawn: walls a building's box would get wrong, like the arena's round its open sand. */
    blocks: Rect[] = [],
    /** Open ground nobody strolls to: the arena's sand is for matches. */
    reserved: Rect[] = [],
  ) {
    this.cols = Math.ceil(map.world.width / TILE);
    this.rows = Math.ceil(map.world.height / TILE);
    this.open = new Array(this.cols * this.rows).fill(true);
    const water = this.wet;
    for (const [col, row, set] of map.terrain) {
      if (set.includes("water")) {
        water.add(row * this.cols + col);
        this.open[row * this.cols + col] = false;
      }
    }
    // A building is solid from a little above its foot to its roof; its door, just below, stays open.
    for (const b of buildings) {
      for (let x = b.x - b.width * 0.4; x <= b.x + b.width * 0.4; x += TILE / 2) {
        for (let y = b.y - b.height * 0.7; y <= b.y - 12; y += TILE / 2) {
          const i = this.index({ x, y });
          if (i !== null) this.open[i] = false;
        }
      }
    }

    for (const b of blocks) {
      for (let x = b.x0; x <= b.x1; x += TILE / 2) {
        for (let y = b.y0; y <= b.y1; y += TILE / 2) {
          const i = this.index({ x, y });
          if (i !== null) this.open[i] = false;
        }
      }
    }

    this.shore = [];
    this.anywhere = [];
    for (let row = 1; row < this.rows - 1; row++) {
      for (let col = 1; col < this.cols - 1; col++) {
        const i = row * this.cols + col;
        if (!this.open[i]) continue;
        const centre = this.centre(i);
        if (reserved.some((r) => centre.x >= r.x0 && centre.x <= r.x1 && centre.y >= r.y0 && centre.y <= r.y1)) continue;
        this.anywhere.push(centre);
        if ([i - 1, i + 1, i - this.cols, i + this.cols].some((n) => water.has(n))) this.shore.push(centre);
      }
    }
    for (const i of water) this.water.push(this.centre(i));
  }

  /** Whether p is in the lake. */
  inWater(p: Point): boolean {
    const i = this.index(p);
    return i !== null && this.wet.has(i);
  }

  private index(p: Point): number | null {
    const col = Math.floor(p.x / TILE);
    const row = Math.floor(p.y / TILE);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return row * this.cols + col;
  }

  private centre(i: number): Point {
    return { x: (i % this.cols) * TILE + TILE / 2, y: Math.floor(i / this.cols) * TILE + TILE / 2 };
  }

  walkable(p: Point): boolean {
    const i = this.index(p);
    return i !== null && this.open[i]!;
  }

  /** The nearest dry spot to p: p itself if it is dry. */
  nearestDry(p: Point): Point {
    if (this.walkable(p)) return p;
    let best = this.anywhere[0] ?? p;
    for (const q of this.anywhere) if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = q;
    return best;
  }

  /** Whether the straight line a-b stays on dry ground, checked every half tile. */
  private clear(a: Point, b: Point): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (TILE / 2));
    for (let k = 1; k < n; k++) {
      if (!this.walkable({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    }
    return true;
  }

  /**
   * The points to walk from `from` to `to` over dry ground, starting at
   * `from`: A* across the tiles, never cutting a corner of water or wall,
   * then pulled straight wherever a straight line stays dry, so a villager
   * walks the way a person would rather than tile by tile.
   */
  route(from: Point, to: Point): Point[] {
    const start = this.index(this.nearestDry(from));
    const goal = this.index(this.nearestDry(to));
    if (start === null || goal === null) return [from, to];
    if (this.clear(from, to)) return [from, to];

    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const h = (i: number) => {
      const a = this.centre(i);
      const b = this.centre(goal);
      return Math.hypot(a.x - b.x, a.y - b.y) / TILE;
    };
    const open = new Map<number, number>([[start, h(start)]]);
    while (open.size > 0) {
      let current = -1;
      let lowest = Infinity;
      for (const [i, f] of open) if (f < lowest) [current, lowest] = [i, f];
      if (current === goal) break;
      open.delete(current);
      const col = current % this.cols;
      const row = Math.floor(current / this.cols);
      for (const [dc, dr, cost] of STEPS) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const n = r * this.cols + c;
        if (!this.open[n]) continue;
        // No squeezing diagonally between two blocked tiles.
        if (dc !== 0 && dr !== 0 && (!this.open[row * this.cols + c] || !this.open[r * this.cols + col])) continue;
        const tentative = g.get(current)! + cost;
        if (tentative < (g.get(n) ?? Infinity)) {
          g.set(n, tentative);
          came.set(n, current);
          open.set(n, tentative + h(n));
        }
      }
    }
    if (!came.has(goal) && start !== goal) return [from, to];

    const tiles: Point[] = [];
    for (let i: number | undefined = goal; i !== undefined && i !== start; i = came.get(i)) tiles.unshift(this.centre(i));
    const coarse = [from, ...tiles.slice(0, -1), to];
    // Pull the string: from each point, go to the farthest one still in a straight dry line.
    const out = [from];
    let at = 0;
    while (at < coarse.length - 1) {
      let next = coarse.length - 1;
      while (next > at + 1 && !this.clear(coarse[at]!, coarse[next]!)) next--;
      out.push(coarse[next]!);
      at = next;
    }
    return out;
  }
}
