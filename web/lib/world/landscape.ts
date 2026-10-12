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

/** The lake's animals in turn: fish, turtle, ray, fish, ... */
export const SEA_KINDS = ["fish", "turtle", "ray"] as const;
export type SeaKind = (typeof SEA_KINDS)[number];
export const SEA_ANIMALS = 12;
const SEA_PACE: Record<SeaKind, { speed: number; burst: number; rate: number; stroke: number }> = {
  // A fish darts and coasts, a turtle paddles slowly, a ray glides in long even sweeps.
  fish: { speed: 1.6, burst: 0.8, rate: 1.3, stroke: 7 },
  turtle: { speed: 0.45, burst: 0.5, rate: 0.4, stroke: 2.4 },
  ray: { speed: 0.7, burst: 0.35, rate: 0.6, stroke: 2.2 },
};

/**
 * Where a lake animal is and how it moves. Each wanders a loop that drifts on a slower,
 * non-repeating second loop, so no two laps match, and stays within 0.63 of the lake's radii -
 * entirely over water. Its pace surges and eases (a fish's most), never stopping or reversing.
 * `stroke` is the tail/flipper/wing beat's phase, quicker while it hurries; `submerged` runs
 * from 0 at the surface to 1 deep, so turtles come up and dive and rays keep low.
 */
export function seaAnimalPosition(index: number, seconds: number): Pt & { heading: number; kind: SeaKind; stroke: number; submerged: number } {
  const kind = SEA_KINDS[index % 3]!, pace = SEA_PACE[kind];
  const w = (0.07 + (index % 4) * 0.012) * pace.speed, amp = pace.burst * w / pace.rate;
  const dir = index % 2 ? 1 : -1, lane = index * 2.4;
  const local = seconds * w + amp * Math.sin(seconds * pace.rate + index * 1.7);
  const t = dir * local + lane;
  const a1 = 0.28 + (index % 4) * 0.07, a2 = 0.575 - a1, a3 = 0.025;
  const k = 0.37 + (index % 3) * 0.11, psi = index * 1.3;
  const u = a1 * Math.cos(t) + a2 * Math.cos(k * t + psi) + a3 * Math.sin(2.7 * t);
  const v = a1 * Math.sin(t) + a2 * Math.sin(k * t + psi) + a3 * Math.cos(2.7 * t);
  // a1 > a2·k + a3·2.7, so the path never cusps and the heading turns smoothly.
  const du = -a1 * Math.sin(t) - a2 * k * Math.sin(k * t + psi) + a3 * 2.7 * Math.cos(2.7 * t);
  const dv = a1 * Math.cos(t) + a2 * k * Math.cos(k * t + psi) - a3 * 2.7 * Math.sin(2.7 * t);
  const submerged = kind === "fish" ? 0.15 + 0.3 * Math.max(0, Math.sin(seconds * 0.3 + index * 2))
    : kind === "turtle" ? 0.5 + 0.5 * Math.sin(seconds * 0.17 + index) : 0.45 + 0.2 * Math.sin(seconds * 0.23 + index);
  return { x: OCEAN.x + u * OCEAN.rx, y: OCEAN.y + v * OCEAN.ry, heading: Math.atan2(dir * dv * OCEAN.ry, dir * du * OCEAN.rx),
    kind, stroke: pace.stroke * local / w, submerged };
}
