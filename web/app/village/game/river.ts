import { nearRoad } from './town';
import { WORLD, type Box, type Pt } from './world';
import { oceanTerrain, ROUGH_SEA } from './landscape';

const TILE = 64;
export const riverCentre = (y: number) => 2336 + Math.sin(y / 440) * 96;
/** A north–south river east of the original halls, with crossings on existing roads. */
export const RIVER_ROWS = Array.from({ length: Math.ceil((WORLD.y1 - WORLD.y0) / TILE) }, (_, i) => {
  const row = Math.floor(WORLD.y0 / TILE) + i;
  const y = row * TILE + 32;
  const col = Math.round(riverCentre(y) / TILE);
  // A tapered westward mouth overlaps the upper lake; no hard rectangular connector.
  const t = Math.max(0, 1 - Math.abs(y - ROUGH_SEA.y) / 320);
  const flare = 192 * t * t * (3 - 2 * t);
  return { row, left: flare > 0 ? Math.min(col - 1, Math.floor((riverCentre(y) - 96 - flare) / TILE)) : col - 1, right: col + 1 };
});
export const RIVER_BANKS: Box[] = RIVER_ROWS.map(({ row, left, right }) => ({
  x0: (left - 1) * TILE, x1: (right + 2) * TILE, y0: row * TILE, y1: (row + 1) * TILE,
}));
export const byRiver = (p: Pt) => RIVER_BANKS.some((b) => p.x >= b.x0 - 40 && p.x <= b.x1 + 40 && p.y >= b.y0 && p.y <= b.y1);

/** The lake and river share one mask, so an old grass bank cannot divide their confluence. */
const water = new Set<string>();
for (const { row, left, right } of RIVER_ROWS) for (let col = left; col <= right; col++) water.add(`${col},${row}`);
for (let row = Math.floor((ROUGH_SEA.y - ROUGH_SEA.ry) / TILE); row <= Math.ceil((ROUGH_SEA.y + ROUGH_SEA.ry) / TILE); row++) {
  for (let col = Math.floor((ROUGH_SEA.x - ROUGH_SEA.rx) / TILE); col <= Math.ceil((ROUGH_SEA.x + ROUGH_SEA.rx) / TILE); col++) {
    if (((col * TILE + 32 - ROUGH_SEA.x) / ROUGH_SEA.rx) ** 2 + ((row * TILE + 32 - ROUGH_SEA.y) / ROUGH_SEA.ry) ** 2 < 1) water.add(`${col},${row}`);
  }
}
const wet = (col: number, row: number) => water.has(`${col},${row}`);
export const RIVER_BRIDGES: Pt[] = [...water].map((key) => {
  const [col, row] = key.split(',').map(Number);
  return { x: col! * TILE + 32, y: row! * TILE + 32 };
}).filter((p) => nearRoad(p, TILE / 2));

/** Exposed edges only: no artificial bank through the middle of the lake/river join. */
export const RIVER_SHORES = [...water].flatMap((key) => {
  const [col, row] = key.split(',').map(Number) as [number, number];
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([dx, dy]) => wet(col + dx!, row + dy!) ? [] : [{
    x: col * TILE + 32 + dx! * 32, y: row * TILE + 32 + dy! * 32, dx: dx!, dy: dy!, col, row,
  }]);
});
export function riverTerrain(): [number, number, string, number][] {
  const out: [number, number, string, number][] = [];
  const nearby = new Set<string>();
  for (const key of water) {
    const [col, row] = key.split(',').map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nearby.add(`${col + dx},${row + dy}`);
  }
  for (const key of nearby) {
    const [col, row] = key.split(',').map(Number) as [number, number];
    if (wet(col, row)) {
      out.push([col, row, 'terrain-water', 0]);
      const p = { x: col * TILE + 32, y: row * TILE + 32 };
      // A whole navigable tile under each crossing, including diagonal roads.
      if (nearRoad(p, TILE / 2)) {
        out.push([col, row, 'terrain-color1', 11]);
      }
      continue;
    }
    const up = wet(col, row - 1), down = wet(col, row + 1), left = wet(col - 1, row), right = wet(col + 1, row);
    out.push([col, row, 'terrain-water', 0]);
    out.push([col, row, 'terrain-color1', (up && down ? 1 : down ? 2 : up ? 0 : 1) * 10 + (left && right ? 1 : right ? 2 : left ? 0 : 1)]);
  }
  return out;
}

/** Replaces overlapping shore tiles as a group for both navigation and rendering. */
export function waterTerrain(): [number, number, string, number][] {
  const joined = riverTerrain();
  const covered = new Set(joined.map(([col, row]) => `${col},${row}`));
  return [...oceanTerrain().filter(([col, row]) => !covered.has(`${col},${row}`)), ...joined];
}
