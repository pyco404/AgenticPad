import type { VillageMap } from "./map-data";
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
  /** The world's top-left corner, in whole tiles: it grows round Old Town into negative coordinates. */
  private readonly col0: number;
  private readonly row0: number;
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
    this.col0 = Math.floor((map.world.x0 ?? 0) / TILE);
    this.row0 = Math.floor((map.world.y0 ?? 0) / TILE);
    this.cols = Math.ceil(map.world.width / TILE);
    this.rows = Math.ceil(map.world.height / TILE);
    this.open = new Array(this.cols * this.rows).fill(true);
    const water = this.wet;
    for (const [col, row, set] of map.terrain) {
      const c = col - this.col0;
      const r = row - this.row0;
      if (!set.includes("water") || c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      water.add(r * this.cols + c);
      this.open[r * this.cols + c] = false;
    }
    // A shore tile is grass drawn over water, so its rim shows water: the grass is what is stood on.
    for (const [col, row, set] of map.terrain) {
      const c = col - this.col0;
      const r = row - this.row0;
      if (set.includes("water") || c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      water.delete(r * this.cols + c);
      this.open[r * this.cols + c] = true;
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

  /** Trunks occupy ground cells; canopies remain overhead and do not become invisible walls. */
  blockTrunks(trunks: readonly Point[]): void {
    for (const p of trunks) {
      const index = this.index(p);
      if (index !== null) this.open[index] = false;
    }
  }

  /** Whether p is in the lake. */
  inWater(p: Point): boolean {
    const i = this.index(p);
    return i !== null && this.wet.has(i);
  }

  private index(p: Point): number | null {
    const col = Math.floor(p.x / TILE) - this.col0;
    const row = Math.floor(p.y / TILE) - this.row0;
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return row * this.cols + col;
  }

  private centre(i: number): Point {
    return { x: ((i % this.cols) + this.col0) * TILE + TILE / 2, y: (Math.floor(i / this.cols) + this.row0) * TILE + TILE / 2 };
  }

  walkable(p: Point): boolean {
    const i = this.index(p);
    return i !== null && this.open[i]!;
  }

  /** The nearest dry spot to p: p itself if it is dry. */
  nearestDry(p: Point): Point {
    if (this.walkable(p)) return p;
    let best = this.anywhere.find((q) => this.walkable(q)) ?? p;
    for (const q of this.anywhere) if (this.walkable(q) && Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = q;
    return best;
  }

  /** Visit every crossed cell, including both banks at an exact corner. Sampling can miss a thin wet corner. */
  private clear(a: Point, b: Point): boolean {
    if (!this.walkable(a) || !this.walkable(b)) return false;
    let col = Math.floor(a.x / TILE), row = Math.floor(a.y / TILE);
    const endCol = Math.floor(b.x / TILE), endRow = Math.floor(b.y / TILE);
    const dx = b.x - a.x, dy = b.y - a.y, sx = Math.sign(dx), sy = Math.sign(dy);
    const tx = dx === 0 ? Infinity : TILE / Math.abs(dx), ty = dy === 0 ? Infinity : TILE / Math.abs(dy);
    let nextX = dx === 0 ? Infinity : ((col + (sx > 0 ? 1 : 0)) * TILE - a.x) / dx;
    let nextY = dy === 0 ? Infinity : ((row + (sy > 0 ? 1 : 0)) * TILE - a.y) / dy;
    const open = (c: number, r: number) => this.walkable({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
    for (let steps = 0; col !== endCol || row !== endRow; steps++) {
      if (steps > this.cols + this.rows) return false;
      if (Math.abs(nextX - nextY) < 1e-9) {
        if (!open(col + sx, row) || !open(col, row + sy)) return false;
        col += sx; row += sy; nextX += tx; nextY += ty;
      } else if (nextX < nextY) { col += sx; nextX += tx; }
      else { row += sy; nextY += ty; }
      if (!open(col, row)) return false;
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
    const end = this.nearestDry(to);
    const start = this.index(this.nearestDry(from));
    const goal = this.index(end);
    if (start === null || goal === null) return [from];
    if (this.clear(from, end)) return [from, end];

    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const h = (i: number) => {
      const a = this.centre(i);
      const b = this.centre(goal);
      return Math.hypot(a.x - b.x, a.y - b.y) / TILE;
    };
    // A binary heap of [f, tile]: the world is too large now to scan every open tile for the next one.
    const heap: [number, number][] = [[h(start), start]];
    const push = (item: [number, number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up]![0] <= heap[i]![0]) break;
        [heap[up], heap[i]] = [heap[i]!, heap[up]!];
        i = up;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    const done = new Set<number>();
    while (heap.length > 0) {
      const [, current] = pop();
      if (done.has(current)) continue;
      done.add(current);
      if (current === goal) break;
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
          push([tentative + h(n), n]);
        }
      }
    }
    if (!came.has(goal) && start !== goal) return [from];

    const tiles: Point[] = [];
    for (let i: number | undefined = goal; i !== undefined && i !== start; i = came.get(i)) tiles.unshift(this.centre(i));
    // Keep the start and goal cell centres: off-centre endpoints may not have a safe diagonal to a neighbour.
    const coarse = [from, this.centre(start), ...tiles, end];
    // Pull the string: from each point, go to the farthest one still in a straight dry line.
    const out = [from];
    let at = 0;
    while (at < coarse.length - 1) {
      let next = coarse.length - 1;
      while (next > at + 1 && !this.clear(coarse[at]!, coarse[next]!)) next--;
      if (!this.clear(coarse[at]!, coarse[next]!)) return [from];
      out.push(coarse[next]!);
      at = next;
    }
    return out;
  }
}
