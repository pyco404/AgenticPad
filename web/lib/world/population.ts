import type { Point } from "./roads";
import type { Plot } from "./growth";

type Resident = { id: string; house: boolean; place: string; standIn?: string };

/** Each token agent counts separately; demo residents and replay stand-ins do not build districts. */
export function agentPopulation(residents: readonly Resident[]): number {
  return new Set(residents.filter((r) => !r.house && !r.standIn && r.place !== "gate").map((r) => r.id)).size;
}

/** Small forecourts in the opened neighbourhoods, spread across plots before filling another row. */
export function neighbourhoodSpots(plots: readonly Plot[], walkable: (p: Point) => boolean): Point[] {
  const spots: Point[] = [];
  const seen = new Set<string>();
  for (let dy = 64; dy <= 184; dy += 24) for (let dx = -112; dx <= 112; dx += 28) {
    for (const plot of plots) {
      const p = { x: plot.door.x + dx, y: plot.door.y + dy };
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || !walkable(p)) continue;
      // Adjacent forecourts must not put two people in almost the same spot.
      if (spots.some((s) => Math.abs(s.x - p.x) < 20 && Math.abs(s.y - p.y) < 20)) continue;
      seen.add(key);
      spots.push(p);
    }
  }
  return spots;
}

/** Keep existing residents' addresses as neighbours arrive, leave or start matches. */
export function allocateHomes(ids: readonly string[], spots: readonly Point[], previous: ReadonlyMap<string, Point>): Map<string, Point> {
  const current = new Set(ids);
  const homes = new Map([...previous].filter(([id]) => current.has(id)));
  const used = new Set([...homes.values()].map((p) => `${p.x},${p.y}`));
  let next = 0;
  for (const id of ids) {
    if (homes.has(id)) continue;
    while (next < spots.length && used.has(`${spots[next]!.x},${spots[next]!.y}`)) next++;
    const p = spots[next++];
    if (!p) break;
    homes.set(id, p);
    used.add(`${p.x},${p.y}`);
  }
  return homes;
}

/** A preferred street route still has to respect water, new buildings and walls. */
export function clearRoute(path: readonly Point[], walkable: (p: Point) => boolean): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16));
    for (let k = 0; k <= steps; k++) {
      if (!walkable({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps })) return false;
    }
  }
  return true;
}
