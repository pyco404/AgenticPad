/**
 * Where the village shows a match: in the Arena for the one it shows
 * (village/arena.ts), and for the rest wherever its two agents meet - a spot on the paths between them,
 * with a small ring drawn round it while the rounds play out.
 *
 * Presentation only. The village replays matches that have already happened:
 * pairing and results come from the server, and nothing here is read by the
 * matchmaker, the runner, scoring or the ledger (test/duels.test.ts checks
 * that nothing in src/ imports the village). Pure, and free of Phaser, so the
 * root suite can test it; the scene draws what it says.
 */

export type Spot = { x: number; y: number };

/** The most rings drawn in full at once; the rest show as a marker. */
export const RING_CAP = 12;
/**
 * How far apart two rings stand, across and up and down: an ellipse, wider
 * than tall, so two matches' running scores - drawn over each ring, and
 * growing as the camera zooms out - never run into each other.
 */
export const RING_GAP = { x: 260, y: 130 };

/** Whether two rings are far enough apart (RING_GAP). */
export const apart = (p: Spot, q: Spot, gap = RING_GAP) => ((p.x - q.x) / gap.x) ** 2 + ((p.y - q.y) / gap.y) ** 2 >= 1;
/** Idle agents within this of a ring stop and watch it. */
export const WATCH_RADIUS = 170;
/** A replay's last moment - its final score - stays up this long before the ring fades. */
export const LINGER_MS = 1_800;
/** How long a match with no rounds to show stands its sides together. */
export const BARE_MS = 3_000;

/** Points along the paths, about `step` apart: the spots a ring may go. */
export function pathSpots(paths: readonly { points: readonly (readonly [number, number])[] }[], step = 32): Spot[] {
  const out: Spot[] = [];
  for (const p of paths) {
    for (let i = 1; i < p.points.length; i++) {
      const [ax, ay] = p.points[i - 1]!;
      const [bx, by] = p.points[i]!;
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k <= n; k++) out.push({ x: ax + ((bx - ax) * k) / n, y: ay + ((by - ay) * k) / n });
    }
  }
  return out;
}

const dist = (p: Spot, q: Spot) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * Where two agents meet: the open spot on the paths nearest the point between
 * them, RING_GAP clear of every ring already drawn; with the paths full, the
 * nearest such spot in a clearing - open ground off the paths. `open` says
 * whether a spot is clear ground - never a building, the water or the Arena's
 * sand. With nowhere left that far from the others, the nearest open spot on
 * the paths will do; with nowhere open at all, null.
 */
export function meetingSpot(
  a: Spot,
  b: Spot,
  spots: readonly Spot[],
  taken: readonly Spot[],
  open: (p: Spot) => boolean = () => true,
  gap: { x: number; y: number } = RING_GAP,
  clearings: readonly Spot[] = [],
): Spot | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nearest = (pool: readonly Spot[]) => {
    let best: Spot | null = null;
    for (const s of pool) if (!best || dist(s, mid) < dist(best, mid)) best = s;
    return best;
  };
  const free = spots.filter(open);
  const clear = (pool: readonly Spot[]) => pool.filter((s) => taken.every((t) => apart(s, t, gap)));
  return nearest(clear(free)) ?? nearest(clear(clearings.filter(open))) ?? nearest(free);
}

/** The rings drawn in full: the RING_CAP nearest the middle of the screen. The rest show as markers. */
export function ringsInFull(rings: readonly ({ id: string } & Spot)[], centre: Spot, cap = RING_CAP): Set<string> {
  return new Set([...rings].sort((p, q) => dist(p, centre) - dist(q, centre)).slice(0, cap).map((r) => r.id));
}

/**
 * Where a ring's replay stands at `now`. It waits for both sides to arrive -
 * `metAt` - and then plays the whole match from that moment, however long ago
 * the server finished it: a match never waits for the village, and the
 * village never cuts a replay short because the result came first.
 */
export function duelPhase(now: number, metAt: number | null, playMs: number | null): "walking" | "playing" | "done" {
  if (metAt === null) return "walking";
  return now - metAt < (playMs ?? BARE_MS) + LINGER_MS ? "playing" : "done";
}
