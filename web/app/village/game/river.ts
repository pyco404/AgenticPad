import { nearRoad } from './town';
import { WORLD, type Box, type Pt } from './world';

const TILE = 64;
export const riverCentre = (y: number) => 2336 + Math.sin(y / 440) * 96;
/** A north–south river east of the original halls, with crossings on existing roads. */
export const RIVER_ROWS = Array.from({ length: Math.ceil((WORLD.y1 - WORLD.y0) / TILE) }, (_, i) => {
  const row = Math.floor(WORLD.y0 / TILE) + i;
  const col = Math.round(riverCentre(row * TILE + 32) / TILE);
  return { row, left: col - 1, right: col + 1 };
});
export const RIVER_BANKS: Box[] = RIVER_ROWS.map(({ row, left, right }) => ({
  x0: (left - 1) * TILE, x1: (right + 2) * TILE, y0: row * TILE, y1: (row + 1) * TILE,
}));
export const byRiver = (p: Pt) => Math.abs(p.x - riverCentre(p.y)) < 210;
export const RIVER_BRIDGES: Pt[] = RIVER_ROWS.flatMap(({ row, left, right }) =>
  Array.from({ length: right - left + 1 }, (_, i) => ({ x: (left + i) * TILE + 32, y: row * TILE + 32 }))
    .filter((p) => nearRoad(p, TILE / 2)),
);
export function riverTerrain(): [number, number, string, number][] {
  const out: [number, number, string, number][] = [];
  for (const { row, left, right } of RIVER_ROWS) {
    for (let col = left; col <= right; col++) {
      out.push([col, row, 'terrain-water', 0]);
      const p = { x: col * TILE + 32, y: row * TILE + 32 };
      // A whole navigable tile under each crossing, including diagonal roads.
      if (nearRoad(p, TILE / 2)) {
        out.push([col, row, 'terrain-color1', 11]);
      }
    }
    // Grass-edged shore tiles match the rest of the world's water.
    out.push([left - 1, row, 'terrain-water', 0], [left - 1, row, 'terrain-color1', 12]);
    out.push([right + 1, row, 'terrain-water', 0], [right + 1, row, 'terrain-color1', 10]);
  }
  return out;
}
