// Adapted from Agent Quest (MIT, see ./LICENSE).

export type Point = { x: number; y: number };

/** Path vertices this close together are one waypoint. */
const MERGE_DIST = 15;
/** How close a path's end must come to another path to be joined to it. */
const STITCH_DIST = 40;
/** Legs longer than this are walked in steps, so a hero doesn't glide across one in a single tween. */
const SUBDIVIDE_ABOVE = 40;
const SUBDIVIDE_STEP = 25;

const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Distance from p to the segment a-b, and where along it (0..1) the nearest point is. */
function project(p: Point, a: Point, b: Point): { dist: number; t: number } {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const lenSq = ax * ax + ay * ay;
  if (lenSq < 1e-6) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ax + (p.y - a.y) * ay) / lenSq));
  return { dist: Math.hypot(p.x - (a.x + t * ax), p.y - (a.y + t * ay)), t };
}

/** The points after `a` on the way to `b`, in even steps when the leg is long. Always ends at `b`. */
function steps(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= SUBDIVIDE_ABOVE) return [b];
  const n = Math.max(2, Math.round(len / SUBDIVIDE_STEP));
  return Array.from({ length: n }, (_, i) => ({ x: a.x + ((i + 1) / n) * dx, y: a.y + ((i + 1) / n) * dy }));
}

/**
 * The village's roads as a graph: every vertex of a painted path is a
 * waypoint, path ends that nearly meet another path are joined to it, and
 * each building's door joins the nearest waypoint. Heroes walk the shortest
 * route through it, so they keep to the roads.
 */
export class Roads {
  private points: Point[] = [];
  private next = new Map<number, number[]>();

  constructor(paths: readonly Point[][], doors: readonly Point[]) {
    const edges: [number, number][] = [];
    const add = (p: Point): number => {
      const near = this.points.findIndex((q) => manhattan(q, p) <= MERGE_DIST);
      if (near !== -1) return near;
      this.points.push(p);
      return this.points.length - 1;
    };

    const byPath = paths.map((path) => {
      const ids: number[] = [];
      for (const p of path) {
        const id = add(p);
        const prev = ids.at(-1);
        if (prev !== undefined && prev !== id) edges.push([prev, id]);
        ids.push(id);
      }
      return ids;
    });

    // Join each path's ends to the nearer end of the closest segment of any other path.
    for (let pi = 0; pi < byPath.length; pi++) {
      const ids = byPath[pi]!;
      const first = ids[0];
      const last = ids.at(-1);
      if (first === undefined || last === undefined) continue;
      for (const end of first === last ? [first] : [first, last]) {
        const p = this.points[end]!;
        let best: { dist: number; to: number } | null = null;
        for (let pj = 0; pj < byPath.length; pj++) {
          if (pj === pi) continue;
          const other = byPath[pj]!;
          for (let k = 0; k < other.length - 1; k++) {
            const a = other[k]!;
            const b = other[k + 1]!;
            if (a === end || b === end) continue;
            const { dist, t } = project(p, this.points[a]!, this.points[b]!);
            if (dist < STITCH_DIST && (best === null || dist < best.dist)) best = { dist, to: t < 0.5 ? a : b };
          }
        }
        if (best !== null && best.to !== end) edges.push([end, best.to]);
      }
    }

    const onRoads = this.points.length;
    for (const door of doors) {
      const id = add(door);
      let nearest = -1;
      let dist = Infinity;
      for (let i = 0; i < onRoads; i++) {
        const d = manhattan(this.points[i]!, door);
        if (d < dist) [nearest, dist] = [i, d];
      }
      if (nearest !== -1) edges.push([id, nearest]);
    }

    for (let i = 0; i < this.points.length; i++) this.next.set(i, []);
    for (const [a, b] of edges) {
      this.next.get(a)!.push(b);
      this.next.get(b)!.push(a);
    }
  }

  /** Whether p is within `distance` of a waypoint on the roads. */
  near(p: Point, distance: number): boolean {
    return this.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= distance);
  }

  private nearest(p: Point): number {
    let best = 0;
    for (let i = 1; i < this.points.length; i++) if (manhattan(p, this.points[i]!) < manhattan(p, this.points[best]!)) best = i;
    return best;
  }

  /** Fewest waypoints from one to the other, by breadth-first search; straight there if unconnected. */
  private hops(from: number, to: number): number[] {
    if (from === to) return [from];
    const seen = new Set([from]);
    const queue = [[from]];
    while (queue.length > 0) {
      const route = queue.shift()!;
      for (const n of this.next.get(route.at(-1)!) ?? []) {
        if (n === to) return [...route, n];
        if (!seen.has(n)) {
          seen.add(n);
          queue.push([...route, n]);
        }
      }
    }
    return [from, to];
  }

  /** The points to walk from `from` to `to`, along the roads, in short steps. Starts at `from`. */
  route(from: Point, to: Point): Point[] {
    if (this.points.length === 0) return [from, ...steps(from, to)];
    const coarse = [from];
    for (const id of this.hops(this.nearest(from), this.nearest(to))) {
      const p = this.points[id]!;
      if (manhattan(coarse.at(-1)!, p) > 10) coarse.push(p);
    }
    if (manhattan(coarse.at(-1)!, to) > 10) coarse.push(to);
    const out = [from];
    for (let i = 1; i < coarse.length; i++) out.push(...steps(coarse[i - 1]!, coarse[i]!));
    return out;
  }
}
