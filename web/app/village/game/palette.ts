/**
 * The village's terrain palette: every colour of its grass, trees, roads and
 * water, in one table. Warm and saturated, sampled from the road-web concept
 * art (2026-10-05).
 *
 * Nothing else names a terrain colour. scripts/village-art.ts recolours the
 * pack's ground, water, trees and bushes from this table (into
 * public/village/warm, which loadMap reads in place of the originals), and
 * map.ts and dressing.ts draw the roads and the square from it.
 *
 * Night is derived, not picked: every colour darker and a little cooler
 * (nightOf), which the scene applies as one multiply over the world.
 *
 * Pure, and free of Phaser and the web app's aliases, so the art script and
 * the root suite can both read it.
 */

export const TERRAIN = {
  grass: { light: "#91b75c", base: "#7ba34c", low: "#719748", shade: "#52763a" },
  tree: { tip: "#899a2b", light: "#5f8a2c", mid: "#3d6a2a", low: "#29542a", deep: "#163e24", shadow: "#051d18" },
  /** Warm limestone paving, shaded joints, and a darker kerb. */
  paved: { hi: "#c6c8b5", base: "#a5aa9c", mid: "#879183", edge: "#6d7169" },
  /** Old Town's roads, the square, and the paths out in the Wilds. */
  dirt: { hi: "#dcbb88", base: "#d2ae79", edge: "#a8875a" },
  water: { base: "#398cc0", mid: "#327fb0", edge: "#286687" },
} as const;

/** Night: how much light is left, and how far it leans to blue. */
export const NIGHT = { light: 0.56, cool: 0.2 };

export type Rgb = [number, number, number];

export const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
/** A colour as Phaser takes it. */
export const num = (hex: string): number => parseInt(hex.slice(1), 16);

/** A colour darkened toward black by `by` (0 none, 1 black). */
export const darker = (hex: string, by: number): string => toHex(rgb(hex).map((v) => v * (1 - by)) as Rgb);

/** What night does to each channel: less light, the red going first and the blue last. */
export const NIGHT_FACTORS: Rgb = [NIGHT.light * (1 - NIGHT.cool), NIGHT.light * (1 - NIGHT.cool / 3), NIGHT.light * (1 + NIGHT.cool)];

/** A colour as it looks at night: darker, and slightly cooler, the same hue family. */
export const nightOf = (hex: string): string => toHex(rgb(hex).map((v, i) => v * NIGHT_FACTORS[i]!) as Rgb);

/** One road kind's colours: a soft shadow on the grass, an edge, the surface, a highlight, a line. */
export type RoadColours = { shadow: number; shadowAlpha: number; edge: number; surface: number; hi: number; line: number };

export const ROAD_COLOURS: Record<"dirt" | "paved", RoadColours> = {
  dirt: {
    shadow: num(darker(TERRAIN.dirt.edge, 0.6)),
    shadowAlpha: 0.25,
    edge: num(TERRAIN.dirt.edge),
    surface: num(TERRAIN.dirt.base),
    hi: num(TERRAIN.dirt.hi),
    line: num(darker(TERRAIN.dirt.base, 0.12)),
  },
  paved: {
    shadow: num(darker(TERRAIN.paved.edge, 0.6)),
    shadowAlpha: 0.3,
    edge: num(TERRAIN.paved.edge),
    surface: num(TERRAIN.paved.base),
    hi: num(TERRAIN.paved.hi),
    line: num(TERRAIN.paved.mid),
  },
};

/** Behind the world, where the map ends: the forest's own shadow. */
export const VOID = TERRAIN.tree.shadow;

/**
 * The pack's pictures recoloured from this table, as paths under public/.
 * The art script writes each to public/village/warm/ at the same path; the
 * scene loads it from there (warm, warmMap).
 */
export const RECOLOURED = [
  "village/tiny-swords/Terrain/Ground/Tilemap_Flat.png",
  "village/tiny-swords/Terrain/Water/Water.png",
  "village/tiny-swords/Resources/Trees/Tree.png",
  ...["04", "05", "06", "07", "08", "09", "10", "11", "12", "17"].map((n) => `village/tiny-swords/Deco/${n}.png`),
  "fixtures/Fountain.png",
  "fixtures/Yard.png",
  "fixtures/Pumpkin.png",
];
const recoloured = new Set(RECOLOURED);

/** A picture's URL from the site's root ("/fixtures/Fountain.png"), or its recoloured copy's if it has one. */
export const warm = (url: string): string => (recoloured.has(url.replace(/^\//, "")) ? `/village/warm/${url.replace(/^\//, "")}` : url);
/** The same for a path relative to /village/, as the map names its textures. */
export const warmMap = (path: string): string => (recoloured.has(`village/${path}`) ? `warm/village/${path}` : path);
