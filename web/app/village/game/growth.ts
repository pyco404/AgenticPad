/**
 * The village grows with its holders (docs/holder-agents.md, The village):
 * as more wallets hold an agent, house agents put up new structures and the
 * forest gives way to them. Presentation only - nothing here is read by
 * anything that plays, pairs or pays.
 *
 * Pure, and free of Phaser and the web app's aliases, so the root suite can
 * test it. The scene (scene.ts) draws what this says.
 *
 * The plan is a list of plots, each opening at a holder count, laid out in a
 * ring in the forest round the town: first just past the town's edge, then
 * further out as the count climbs, so the land opens outward. A plot never
 * moves and never closes again once open in a page's life; if the count falls,
 * what stands stays standing until the page is reloaded.
 */

export type GrowthPiece = {
  /** A fixture's picture (public/fixtures), and how it is drawn. */
  image: "House_Blue" | "House_Red" | "House_Yellow" | "House_Purple" | "Plot" | "Yard" | "Pumpkin" | "Fence" | "Sheep";
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

/** Each fixture's frame, in its own pixels: what a piece's footprint is reckoned from. */
export const FIXTURE_SIZE: Record<GrowthPiece["image"], { width: number; height: number; foot: number; frames?: number }> = {
  House_Blue: { width: 128, height: 192, foot: 172 / 192 },
  House_Red: { width: 128, height: 192, foot: 172 / 192 },
  House_Yellow: { width: 128, height: 192, foot: 172 / 192 },
  House_Purple: { width: 128, height: 192, foot: 172 / 192 },
  Plot: { width: 90, height: 54, foot: 1 },
  Yard: { width: 288, height: 107, foot: 1 },
  Pumpkin: { width: 64, height: 64, foot: 1 },
  Fence: { width: 96, height: 30, foot: 1 },
  // A sheet of eight frames, 128 across.
  Sheep: { width: 128, height: 128, foot: 0.8, frames: 8 },
};

const house = (colour: "Blue" | "Red" | "Yellow" | "Purple", x: number, y: number, flip = false): GrowthPiece => ({
  image: `House_${colour}`,
  x,
  y,
  scale: 0.55,
  flip,
});
const cottage = (id: string, at: number, colour: "Blue" | "Red" | "Yellow" | "Purple", x: number, y: number, flip = false): Plot => ({
  id,
  at,
  door: { x, y: y + 24 },
  pieces: [house(colour, x, y, flip)],
});

/**
 * The plots, in the order they open. Coordinates are world pixels, each
 * piece's foot; the town is an ellipse round (1400, 860), 880 by 540 (town.ts),
 * the lake below y 1480 west of x 2130, and the world 2800 by 1800.
 */
export const PLOTS: Plot[] = [
  // The first holder: a cottage at the west edge of town, where the high street runs out.
  cottage("west-1", 1, "Blue", 450, 1040),
  // A few: one east, and a garden by the first.
  cottage("east-1", 3, "Red", 2370, 980, true),
  { id: "west-garden", at: 3, door: { x: 350, y: 1170 }, pieces: [{ image: "Plot", x: 345, y: 1160, scale: 1.4 }, { image: "Pumpkin", x: 392, y: 1158, scale: 0.7 }] },
  // Five: north, past the Lookout, and a sheepfold east.
  cottage("north-1", 5, "Yellow", 1170, 140),
  {
    id: "east-fold",
    at: 5,
    door: { x: 2420, y: 1210 },
    pieces: [
      // The sheep stand a little below the pen's foot, so they are drawn in front of it.
      { image: "Yard", x: 2440, y: 1190, scale: 0.7 },
      { image: "Sheep", x: 2410, y: 1196, scale: 0.6 },
      { image: "Sheep", x: 2475, y: 1200, scale: 0.6, flip: true },
    ],
  },
  // Ten: a cottage either side, a little further out.
  cottage("west-2", 10, "Purple", 430, 780),
  cottage("east-2", 10, "Blue", 2400, 740, true),
  // Twenty: a row north of the Hall of Fame, fenced.
  cottage("north-2", 20, "Red", 1620, 140, true),
  {
    id: "north-fence",
    at: 20,
    door: { x: 1370, y: 160 },
    pieces: [
      { image: "Fence", x: 1320, y: 150, scale: 1.2 },
      { image: "Fence", x: 1420, y: 150, scale: 1.2 },
      { image: "Pumpkin", x: 1370, y: 146, scale: 0.7 },
    ],
  },
  // Thirty-five: the north corners.
  cottage("north-west", 35, "Blue", 640, 360),
  cottage("north-east", 35, "Yellow", 2160, 360, true),
  // Fifty: the land opens on the far west and the south-east shore.
  cottage("far-west-1", 50, "Red", 230, 900),
  cottage("south-east", 50, "Purple", 2470, 1450, true),
  { id: "far-west-garden", at: 50, door: { x: 250, y: 1060 }, pieces: [{ image: "Plot", x: 240, y: 1050, scale: 1.4 }, { image: "Pumpkin", x: 285, y: 1046, scale: 0.7 }] },
  // Seventy-five and up: further out on every side.
  cottage("far-east-1", 75, "Blue", 2620, 900, true),
  cottage("far-north-1", 75, "Purple", 900, 180),
  cottage("far-north-2", 100, "Red", 1900, 180, true),
  cottage("far-west-2", 100, "Yellow", 210, 620),
  {
    id: "far-east-fold",
    at: 150,
    door: { x: 2650, y: 1320 },
    pieces: [
      { image: "Yard", x: 2650, y: 1300, scale: 0.7 },
      { image: "Sheep", x: 2620, y: 1306, scale: 0.6 },
    ],
  },
  cottage("far-east-2", 150, "Red", 2640, 620, true),
  cottage("far-north-3", 250, "Blue", 1540, 140),
  cottage("far-west-3", 250, "Purple", 230, 1260),
  cottage("far-north-west", 400, "Yellow", 380, 260),
  cottage("far-north-east", 400, "Blue", 2440, 250, true),
  cottage("far-east-3", 600, "Purple", 2660, 1500, true),
  cottage("far-north-4", 1000, "Red", 650, 140),
  cottage("far-north-5", 1000, "Yellow", 2150, 140, true),
];

/** The plots open at this many holders, in the order they opened. */
export function openPlots(holders: number): Plot[] {
  return PLOTS.filter((p) => holders >= p.at);
}

/** The next plot to open, and the count it opens at; null once every plot is open. */
export function nextPlot(holders: number): Plot | null {
  return PLOTS.find((p) => holders < p.at) ?? null;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The ground a plot takes: every piece's picture and some room round it. The
 * forest gives way here - a tree whose canopy reaches into it is taken down
 * when the plot opens. That clearing is the land expanding.
 */
export function plotClearing(plot: Plot, margin = 40): Box {
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of plot.pieces) {
    const size = FIXTURE_SIZE[p.image];
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
