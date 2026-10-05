/**
 * The village grows with its holders (docs/holder-agents.md, The village):
 * as more wallets hold an agent, plots open and buildings go up, and the
 * trees on their ground come down. Presentation only - nothing here is read
 * by anything that plays, pairs or pays.
 *
 * Pure, and free of Phaser and the web app's aliases, so the root suite can
 * test it. The scene (scene.ts) draws what this says.
 *
 * Growth comes in plans: a list of plots, each opening at a holder count, in
 * the order they open. New Town is one plan, opened by $AGP holders; each
 * launch district will be another (checkpoint 2), opened by its own token's.
 * A plot never moves and never closes again once open in a page's life; if
 * the count falls, what stands stays standing until the page is reloaded.
 */

import { CENTRE, fromEdge, inNewTown, INNER, OUTER, SPOKES, type Octagon, type Pt } from "./world";

/** Every picture a plot can be built from, with where it comes from and how it stands. */
export const PIECE_ART = {
  // The pack's own (public/fixtures).
  House_Blue: { src: "/village/agenticpad/modern-villa-blue.png", width: 128, height: 192, foot: 172 / 192 },
  House_Red: { src: "/village/agenticpad/modern-villa-red.png", width: 128, height: 192, foot: 172 / 192 },
  House_Yellow: { src: "/village/agenticpad/modern-villa-yellow.png", width: 128, height: 192, foot: 172 / 192 },
  House_Purple: { src: "/village/agenticpad/modern-villa-purple.png", width: 128, height: 192, foot: 172 / 192 },
  Plot: { src: "/fixtures/Plot.png", width: 90, height: 54, foot: 1 },
  Yard: { src: "/fixtures/Yard.png", width: 288, height: 107, foot: 1 },
  Pumpkin: { src: "/fixtures/Pumpkin.png", width: 64, height: 64, foot: 1 },
  Fence: { src: "/fixtures/Fence.png", width: 96, height: 30, foot: 1 },
  // A sheet of eight frames, 128 across.
  Sheep: { src: "/fixtures/Sheep.png", width: 128, height: 128, foot: 0.8, frames: 8 },
  // New Town's, drawn for AgenticPad (scripts/village-art.ts): glass, flat roofs, screens, lamps.
  office: { src: "/village/agenticpad/modern-office.png", width: 56, height: 74, foot: 1 },
  "house-a": { src: "/village/agenticpad/modern-house-a.png", width: 54, height: 50, foot: 1 },
  "house-b": { src: "/village/agenticpad/modern-house-b.png", width: 54, height: 50, foot: 1 },
  shop: { src: "/village/agenticpad/modern-shop.png", width: 58, height: 54, foot: 1 },
  apartments: { src: "/village/agenticpad/modern-apartments.png", width: 60, height: 86, foot: 1 },
  kiosk: { src: "/village/agenticpad/modern-kiosk.png", width: 38, height: 42, foot: 1 },
  lamp: { src: "/village/agenticpad/modern-lamp.png", width: 10, height: 38, foot: 1 },
  planter: { src: "/village/agenticpad/modern-planter.png", width: 22, height: 14, foot: 1 },
} as const satisfies Record<string, { src: string; width: number; height: number; foot: number; frames?: number }>;

export type PieceArt = keyof typeof PIECE_ART;

export type GrowthPiece = {
  image: PieceArt;
  x: number;
  y: number;
  scale: number;
  flip?: boolean;
};

export type Plot = {
  /** Stable, so a page can tell which plots it has already drawn. */
  id: string;
  /** Opens once this many wallets hold an agent. */
  at: number;
  /** What a builder works at: the plot's front. */
  door: { x: number; y: number };
  pieces: GrowthPiece[];
};

/** A plan: plots in the order they open, by one count of holders. */
export type Plan = { id: string; plots: Plot[] };

/** The plots of a plan open at this many holders, in the order they opened. */
export function openPlots(plan: Plan, holders: number): Plot[] {
  return plan.plots.filter((p) => holders >= p.at);
}

/** The next plot to open, and the count it opens at; null once every plot is open. */
export function nextPlot(plan: Plan, holders: number): Plot | null {
  return plan.plots.find((p) => holders < p.at) ?? null;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The ground a plot takes: every piece's picture and some room round it. The
 * forest gives way here - a tree whose canopy reaches into it is taken down
 * when the plot opens, and never grows back, since a plot never closes.
 */
export function plotClearing(plot: Plot, margin = 40): Box {
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of plot.pieces) {
    const size = PIECE_ART[p.image];
    const w = size.width * p.scale;
    const h = size.height * p.scale;
    box = {
      x0: Math.min(box.x0, p.x - w / 2),
      y0: Math.min(box.y0, p.y - h * size.foot),
      x1: Math.max(box.x1, p.x + w / 2),
      y1: Math.max(box.y1, p.y + h * (1 - size.foot)),
    };
  }
  return { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin + 30 };
}

/** A tree's canopy, as the forest draws it: a tree sheet's frame is 192 pixels, drawn from its middle. */
export function canopy(tree: { x: number; y: number; s: number }): Box {
  return { x0: tree.x - 62 * tree.s, y0: tree.y - 150 * tree.s, x1: tree.x + 62 * tree.s, y1: tree.y + 10 };
}

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** The trees a set of open plots takes down: indexes into the list given. */
export function felled(trees: readonly { x: number; y: number; s: number }[], plots: readonly Plot[]): number[] {
  const clearings = plots.map((p) => plotClearing(p));
  const out: number[] = [];
  trees.forEach((t, i) => {
    if (clearings.some((c) => overlaps(canopy(t), c))) out.push(i);
  });
  return out;
}

// --- New Town ------------------------------------------------------------------

/** The New Town plots' fixed neighbours, which no plot is laid over: the Launch Pad east, the bazaar west (town.ts). */
export const NEW_TOWN_FIXED: { id: string; at: Pt; room: number }[] = [
  { id: "launchpad", at: { x: 2860, y: 1250 }, room: 230 },
  { id: "bazaar", at: { x: -60, y: 1150 }, room: 250 },
];

/** How far apart New Town's buildings stand along a row, and how far each row is from its ring road. */
const SLOT_STEP = 190;
const ROW_OFFSET = 210;
/** No building this close to a main road's centre line. */
const SPOKE_ROOM = 150;

/** The holder count each plot opens at, in order: one at a time at first, then further apart as the town fills. */
export function thresholds(n: number): number[] {
  const out: number[] = [];
  let at = 1;
  for (let i = 0; i < n; i++) {
    out.push(Math.round(at));
    at = i < 6 ? at + 1 : Math.max(at + 1, at * 1.12);
  }
  return out;
}

/** The octagon `o` grown outward by `by`, its edges kept parallel. */
const grown = (o: Octagon, by: number): Octagon => ({ ...o, hw: o.hw + by, hh: o.hh + by, chamfer: o.chamfer + by * (Math.SQRT2 - 1) });

/** Points `step` apart round an octagon, starting from the middle of its left edge. */
function around(o: Octagon, step: number): Pt[] {
  const { cx, cy, hw, hh, chamfer: c } = o;
  const cs: Pt[] = [
    { x: cx - hw, y: cy },
    { x: cx - hw, y: cy - hh + c },
    { x: cx - hw + c, y: cy - hh },
    { x: cx + hw - c, y: cy - hh },
    { x: cx + hw, y: cy - hh + c },
    { x: cx + hw, y: cy + hh - c },
    { x: cx + hw - c, y: cy + hh },
    { x: cx - hw + c, y: cy + hh },
    { x: cx - hw, y: cy + hh - c },
    { x: cx - hw, y: cy },
  ];
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1]!;
    const b = cs[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = carry; d < len; d += step) out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
    carry = (step - ((len - carry) % step)) % step;
  }
  return out;
}

const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** A deterministic random stream, so New Town is laid out the same on every load. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDINGS: PieceArt[] = ["house-a", "office", "shop", "house-b", "apartments", "kiosk"];

/**
 * New Town: two rows of plots round the band between the rings, one facing
 * each ring road, kept off the main roads and away from the Launch Pad and the
 * bazaar. Each plot is a modern building, a street lamp, and now and then a
 * planter. They open in arrival order, from the west - the way in, past the
 * Hiring Hall - outward round both sides, the inner row first.
 */
function newTownPlan(): Plan {
  const rand = rng(20261005);
  const rows = [
    { name: "inner", ring: grown(INNER, ROW_OFFSET) },
    { name: "outer", ring: grown(OUTER, -ROW_OFFSET) },
  ];
  const slots: { id: string; at: Pt; row: number; turn: number }[] = [];
  rows.forEach((row, r) => {
    around(row.ring, SLOT_STEP).forEach((p, i) => {
      if (!inNewTown(p, 120)) return;
      if (SPOKES.some((s) => distToSegment(p, s.start, s.end) < SPOKE_ROOM)) return;
      if (NEW_TOWN_FIXED.some((f) => Math.hypot(f.at.x - p.x, f.at.y - p.y) < f.room)) return;
      // How far round from the west, either way: 0 at the west, π at the east.
      const turn = Math.abs(Math.atan2(p.y - CENTRE.y, -(p.x - CENTRE.x)));
      slots.push({ id: `${row.name}-${i}`, at: { x: Math.round(p.x), y: Math.round(p.y) }, row: r, turn });
    });
  });
  slots.sort((a, b) => a.row - b.row || a.turn - b.turn);
  // Each slot's building, lamp and maybe a planter; a slot whose ground would overlap one already laid -
  // where a row turns a corner, or tall buildings stack up an upright side - is left as open ground.
  const laid: { id: string; door: Pt; pieces: GrowthPiece[] }[] = [];
  for (const s of slots) {
    const image = BUILDINGS[Math.floor(rand() * BUILDINGS.length)]!;
    const size = PIECE_ART[image];
    // The building's foot sits a little below the slot, so it stands centred on it.
    const foot = { x: s.at.x, y: s.at.y + size.height };
    const flip = rand() < 0.5;
    const planter = rand() < 0.4;
    const pieces: GrowthPiece[] = [
      { image, x: foot.x, y: foot.y, scale: 2, flip },
      { image: "lamp", x: foot.x + (flip ? -1 : 1) * (size.width + 12), y: foot.y + 6, scale: 2 },
    ];
    if (planter) pieces.push({ image: "planter", x: foot.x + (flip ? 1 : -1) * (size.width + 8), y: foot.y + 8, scale: 2 });
    const plot = { id: `new-town-${s.id}`, at: 0, door: { x: foot.x, y: foot.y + 20 }, pieces };
    const ground = plotClearing(plot, 0);
    if (laid.some((other) => overlaps(ground, plotClearing({ ...other, at: 0 }, 0)))) continue;
    if (NEW_TOWN_FIXED.some((f) => overlaps(ground, { x0: f.at.x - 140, y0: f.at.y - 220, x1: f.at.x + 140, y1: f.at.y + 60 }))) continue;
    laid.push(plot);
  }
  const at = thresholds(laid.length);
  return { id: "new-town", plots: laid.map((p, i) => ({ ...p, at: at[i]! })) };
}

export const NEW_TOWN: Plan = newTownPlan();

/** Whether a point is inside New Town's band at all (for the forest, which grows sparse there until plots open). */
export const inBand = (p: Pt) => fromEdge(INNER, p) > 0 && fromEdge(OUTER, p) < 0;
