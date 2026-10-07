import type { Box, Pt } from "./world";

/** Scenic regions in the Wilds, clear of the ring roads and future town plots. */
export const OCEAN = { x: -1220, y: 1480, rx: 580, ry: 420 };
export const OCEAN_BOX: Box = { x0: OCEAN.x - OCEAN.rx - 100, y0: OCEAN.y - OCEAN.ry - 100, x1: OCEAN.x + OCEAN.rx + 100, y1: OCEAN.y + OCEAN.ry + 100 };
export const ROUGH_SEA = { x: 1400, y: -1500, rx: 900, ry: 550 };
export const ROUGH_SEA_BOX: Box = { x0: 430, y0: -2120, x1: 2370, y1: -880 };
export const MOUNTAINS = [
  // The clearing southwest of the northwest outer-ring crossroads.
  { x: -960, y: -20, width: 280, height: 287 },
];
export const MOUNTAIN_BOXES: Box[] = MOUNTAINS.map((m) => ({ x0: m.x - m.width / 2, y0: m.y - m.height, x1: m.x + m.width / 2, y1: m.y + 15 }));
export const LANDSCAPE_BOXES = [OCEAN_BOX, ROUGH_SEA_BOX, ...MOUNTAIN_BOXES];
export const byLandscape = (p: Pt) => LANDSCAPE_BOXES.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);

/** Tile-aligned water with the pack's existing grass shoreline tiles. */
export function oceanTerrain(): [number, number, string, number][] {
  return [...seaTerrain(OCEAN, OCEAN_BOX), ...seaTerrain(ROUGH_SEA, ROUGH_SEA_BOX)];
}

function seaTerrain(sea: typeof OCEAN, box: Box): [number, number, string, number][] {
  const c0 = Math.floor(box.x0 / 64), c1 = Math.ceil(box.x1 / 64);
  const r0 = Math.floor(box.y0 / 64), r1 = Math.ceil(box.y1 / 64);
  const water = new Set<string>();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const dx = (c * 64 + 32 - sea.x) / sea.rx, dy = (r * 64 + 32 - sea.y) / sea.ry;
    if (dx * dx + dy * dy < 1) water.add(`${c},${r}`);
  }
  const wet = (c: number, r: number) => water.has(`${c},${r}`);
  const out: [number, number, string, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (wet(c, r)) { out.push([c, r, "terrain-water", 0]); continue; }
    const up = wet(c, r - 1), down = wet(c, r + 1), left = wet(c - 1, r), right = wet(c + 1, r);
    const diagonal = wet(c - 1, r - 1) || wet(c + 1, r - 1) || wet(c - 1, r + 1) || wet(c + 1, r + 1);
    if (!up && !down && !left && !right && !diagonal) continue;
    out.push([c, r, "terrain-water", 0]);
    out.push([c, r, "terrain-color1", (up && down ? 1 : down ? 2 : up ? 0 : 1) * 10 + (left && right ? 1 : right ? 2 : left ? 0 : 1)]);
  }
  return out;
}

/** Fast currents travel across the sea, wrapping within its curved shoreline. */
export function roughWavePosition(index: number, seconds: number): Pt {
  const dy = (((index * 43) % 157) / 157 - 0.5) * ROUGH_SEA.ry * 1.4;
  const span = ROUGH_SEA.rx * Math.sqrt(1 - (dy / ROUGH_SEA.ry) ** 2) * 0.82;
  const travel = (index * 131 + seconds * (45 + index % 5 * 12)) % (span * 2);
  return { x: ROUGH_SEA.x - span + travel, y: ROUGH_SEA.y + dy + Math.sin(seconds * 1.3 + index) * 5 };
}

/** Each animal follows an ellipse entirely within the water, never over land. */
export function seaAnimalPosition(index: number, seconds: number): Pt & { heading: number } {
  const phase = seconds * (0.055 + index * 0.006) + index * 2.4;
  const radius = 0.27 + (index % 4) * 0.12;
  const dx = -Math.sin(phase) * OCEAN.rx * radius, dy = Math.cos(phase) * OCEAN.ry * radius;
  return { x: OCEAN.x + Math.cos(phase) * OCEAN.rx * radius, y: OCEAN.y + Math.sin(phase) * OCEAN.ry * radius, heading: Math.atan2(dy, dx) };
}
