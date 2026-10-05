/**
 * The forest: every tree outside Old Town, worked out from a seed rather than
 * stored, a chunk at a time. A chunk is the same trees every time it is made,
 * so the scene destroys the chunks far from the camera and makes them again
 * when it comes back, and a world twice the size costs no more to look at.
 *
 * The Wilds are forest: a tree every few steps, crowns touching, so the roads
 * read as cut through it, with clearings opened in it here and there. The
 * garden strip and New Town's open ground stay sparse. Never on a road (with a
 * little verge either side), the lake, a building's lot or an open plot - so
 * a tree an open plot took down never grows back, since a plot never closes.
 * Old Town's own trees are the map's (map.json), as they always were.
 *
 * Pure, and free of Phaser, so the root suite can test it.
 */

import { canopy, inBand, overlaps, type Box } from "./growth";
import { fromEdge, inGarden, inWilds, LAKE_BOX, OUTER, WORLD, type Pt } from "./world";

export const CHUNK = 512;

/**
 * One tree, or in the garden strip a bush: the texture and frame it is drawn
 * from (the pack's tree sheet, or one of the map's bushes), where it stands,
 * and its size.
 */
export type Tree = { id: string; k: string; f: number; x: number; y: number; s: number };
const BUSHES = ["bush-1", "bush-2", "bush-4"];

/** How many trees a chunk tries in the garden and over New Town, and how many of them stand: thin, both. */
const TRIES = 64;
const DENSITY = { wilds: 1, garden: 0.35, band: 0.14 };
/**
 * The Wilds' forest: one tree to a cell this big, every other row set half a
 * cell over and each tree shaken about its cell, so it reads as grown rather
 * than planted. Crowns are about 60 across: the cells are a little smaller.
 */
const CELL = { w: 58, h: 46 };
const JITTER = 0.38;
/** The clearings: where the noise (0-1) is below OPEN there is none; below THIN, fewer. On a lattice this far apart. */
const CLEARING = { open: 0.3, thin: 0.38, scale: 560, ringRoom: 420 };
/** How far every tree keeps from a building's lot or an open plot, past its canopy. */
const LOT_MARGIN = 20;
/** In the garden strip most of what grows is bushes, as a garden's would be. */
const GARDEN_BUSHES = 0.12;

/** FNV-1a, so a chunk's seed is the same in every browser. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

/** The chunks that cover a box. */
export function chunksIn(b: Box): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = [];
  for (let cy = Math.floor(b.y0 / CHUNK); cy <= Math.floor(b.y1 / CHUNK); cy++) {
    for (let cx = Math.floor(b.x0 / CHUNK); cx <= Math.floor(b.x1 / CHUNK); cx++) out.push({ cx, cy });
  }
  return out;
}

export type ForestRules = {
  /** Old Town's ground, where the map's own trees stand instead. */
  inOldTown: (p: Pt) => boolean;
  /** Whether a tree's canopy would cover a road. */
  onRoad: (p: Pt, s: number) => boolean;
  /** Ground nothing grows on: buildings and their lots. */
  taken: readonly Box[];
  /** The open plots: their ground is cleared, and stays so. */
  cleared: readonly Box[];
};

/** The noise's lattice, kept: a few hundred points cover the whole world. */
const LATTICE = new Map<string, number>();

/** Smooth value noise, 0-1, from the seed: the same everywhere for a given point. */
function noise(x: number, y: number, seed: number): number {
  // Through the stream once, not the hash alone: FNV barely moves its top bits for a last digit changed, and
  // neighbouring rows would come out nearly alike.
  const at = (c: number, r: number) => {
    const key = `${seed}:n:${c}:${r}`;
    let v = LATTICE.get(key);
    if (v === undefined) LATTICE.set(key, (v = rng(hash(key))()));
    return v;
  };
  const fx = x / CLEARING.scale;
  const fy = y / CLEARING.scale;
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const u = ease(fx - c);
  const v = ease(fy - r);
  const top = at(c, r) * (1 - u) + at(c + 1, r) * u;
  const bottom = at(c, r + 1) * (1 - u) + at(c + 1, r + 1) * u;
  return top * (1 - v) + bottom * v;
}

/**
 * How open the forest is at p, 0-1, low where it opens into a clearing: two
 * octaves, so a clearing's edge is ragged. Never along the outer ring road,
 * so it runs through forest rather than along a meadow.
 */
export function clearingAt(p: Pt, seed = 20261005): number {
  const n = noise(p.x, p.y, seed) * 0.7 + noise(p.x * 2.3 + 1000, p.y * 2.3 + 1000, seed) * 0.3;
  const out = fromEdge(OUTER, p);
  return out < CLEARING.ringRoom ? n + ((CLEARING.ringRoom - out) / CLEARING.ringRoom) * 0.3 : n;
}

const grown = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });

/**
 * The trees of one chunk. The same chunk and rules always give the same
 * trees; opening a plot only ever removes some.
 */
export function chunkTrees(cx: number, cy: number, rules: ForestRules, seed = 20261005): Tree[] {
  const out: Tree[] = [];
  const taken = rules.taken.map((t) => grown(t, LOT_MARGIN));
  const cleared = rules.cleared.map((t) => grown(t, LOT_MARGIN));
  const inside = (x: number, y: number) => x >= WORLD.x0 + 40 && x <= WORLD.x1 - 40 && y >= WORLD.y0 + 140 && y <= WORLD.y1 - 20;
  /** Whether a tree of this size can stand here: off the lake, the roads, every lot and open plot. */
  const free = (x: number, y: number, s: number) => {
    const c = canopy({ x, y, s });
    if (overlaps(c, { x0: LAKE_BOX.x0 - 40, y0: LAKE_BOX.y0 - 60, x1: LAKE_BOX.x1 + 40, y1: LAKE_BOX.y1 + 30 })) return false;
    if (rules.onRoad({ x, y }, s)) return false;
    return !taken.some((t) => overlaps(c, t)) && !cleared.some((t) => overlaps(c, t));
  };

  // The garden strip and New Town: a few tries a chunk, most of them left as open ground.
  const rand = rng(hash(`${seed}:${cx}:${cy}`));
  for (let i = 0; i < TRIES; i++) {
    // Every try draws its numbers whether or not it keeps the tree, so one rule changing never reshuffles the rest.
    const x = (cx + rand()) * CHUNK;
    const y = (cy + rand()) * CHUNK;
    const s = 0.42 + rand() * 0.2;
    const f = Math.floor(rand() * 4);
    const keep = rand();
    const bushy = rand();
    const p = { x, y };
    if (!inside(x, y) || inWilds(p)) continue;
    if (rules.inOldTown(p)) continue;
    const garden = inGarden(p);
    // A bush: low and small, so it is checked against the ground it covers, not a tree's canopy.
    if (garden && keep < GARDEN_BUSHES) {
      const bush = { x0: x - 24, y0: y - 30, x1: x + 24, y1: y + 10 };
      if (rules.onRoad(p, 0.3) || taken.some((t) => overlaps(bush, t)) || cleared.some((t) => overlaps(bush, t))) continue;
      out.push({ id: `${cx},${cy}:${i}`, k: BUSHES[Math.floor(bushy * BUSHES.length)]!, f: 0, x: Math.round(x), y: Math.round(y), s: 0.6 });
      continue;
    }
    const density = garden ? DENSITY.garden : inBand(p) ? DENSITY.band : DENSITY.wilds;
    if (keep > density || !free(x, y, s)) continue;
    out.push({ id: `${cx},${cy}:${i}`, k: "resources-trees-tree", f, x: Math.round(x), y: Math.round(y), s });
  }

  // The Wilds: a tree in every cell whose middle falls in this chunk, unless a clearing, a road or the lake is there.
  // Each cell's numbers come from the cell itself, not the chunk, so where a chunk's edge falls never matters.
  for (let r = Math.ceil((cy * CHUNK) / CELL.h); r * CELL.h < (cy + 1) * CHUNK; r++) {
    const shift = r % 2 === 0 ? 0 : CELL.w / 2;
    for (let c = Math.ceil((cx * CHUNK - shift) / CELL.w); c * CELL.w + shift < (cx + 1) * CHUNK; c++) {
      const cell = rng(hash(`${seed}:w:${c}:${r}`));
      const x = c * CELL.w + shift + (cell() - 0.5) * 2 * JITTER * CELL.w;
      const y = r * CELL.h + (cell() - 0.5) * 2 * JITTER * CELL.h;
      const s = 0.44 + cell() * 0.2;
      const f = Math.floor(cell() * 4);
      const keep = cell();
      const p = { x, y };
      if (!inside(x, y) || !inWilds(p)) continue;
      const open = clearingAt(p, seed);
      if (open < CLEARING.open) continue;
      // The clearing's rim: thinning out toward it rather than stopping at a line.
      if (open < CLEARING.thin && keep > (open - CLEARING.open) / (CLEARING.thin - CLEARING.open)) continue;
      if (!free(x, y, s)) continue;
      out.push({ id: `${cx},${cy}:w${c},${r}`, k: "resources-trees-tree", f, x: Math.round(x), y: Math.round(y), s });
    }
  }
  // Drawn back to front.
  return out.sort((a, b) => a.y - b.y);
}