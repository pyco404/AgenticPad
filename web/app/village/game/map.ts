// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";

import { ROAD_COLOURS, warmMap } from "./palette";

/** public/village/map.json, as scripts/village-import.ts writes it. */
export type VillageMap = {
  /** The world's size, and where its top-left corner is: the world grows round Old Town into negative coordinates (world.ts). */
  world: { width: number; height: number; x0?: number; y0?: number };
  base: string;
  /** The frame of `base` repeated under everything: plain ground, with no edge. */
  baseFrame?: number;
  /** [column, row, tileset, frame] */
  terrain: [number, number, string, number][];
  /** Its style is kept as the map names it; every road is drawn alike, in one grey (PAVED). */
  paths: { style: string; width: number; points: [number, number][] }[];
  /** Paved plazas, one at each crossroads of the world's roads. */
  plazas?: [number, number][];
  /** k: texture, f: frame, s: scale, d: fixed depth, a: animation to play. */
  decorations: { k: string; f?: number; x: number; y: number; s: number; d?: number; a?: string }[];
  buildings: { id: string; x: number; y: number }[];
  spawn: { x: number; y: number };
  heroScale: number;
  textures: { key: string; path: string; frameWidth?: number; frameHeight?: number }[];
  animations: { key: string; texture: string; start: number; end: number; frameRate: number; repeat: number }[];
};

const TILE = 64;

/**
 * Every road's colours, from the terrain palette (palette.ts): one grey for
 * all of them, Old Town's and the world's alike, with a darker kerb.
 */
const PAVED = ROAD_COLOURS.paved;
/** A paved plaza at every crossroads, this wide across. */
const PLAZA = 150;

/**
 * Queue every texture the map, the heroes and the buildings use. Paths are
 * relative to the loader's path. The pack's ground, water, trees and bushes
 * come recoloured to the terrain palette (palette.ts warmMap).
 */
export function loadMap(scene: Phaser.Scene, map: VillageMap): void {
  for (const t of map.textures) {
    const path = warmMap(t.path);
    if (t.frameWidth !== undefined && t.frameHeight !== undefined) {
      scene.load.spritesheet(t.key, path, { frameWidth: t.frameWidth, frameHeight: t.frameHeight });
    } else {
      scene.load.image(t.key, path);
    }
  }
}

/**
 * Ground, roads and props. Decorations go straight on the scene rather than in
 * a container, each at the depth of its foot, so a hero walking in front of a
 * tree's trunk covers it and one behind is hidden.
 */
/** Draws the map; returns its trees, each with the sprite drawn for it, so the village can clear them as it grows. */
export function drawMap(
  scene: Phaser.Scene,
  map: VillageMap,
): { d: { k: string; x: number; y: number; s: number }; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite }[] {
  const trees: { d: { k: string; x: number; y: number; s: number }; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite }[] = [];
  for (const a of map.animations) {
    if (scene.anims.exists(a.key) || !scene.textures.exists(a.texture)) continue;
    scene.anims.create({
      key: a.key,
      frames: scene.anims.generateFrameNumbers(a.texture, { start: a.start, end: a.end }),
      frameRate: a.frameRate,
      repeat: a.repeat,
    });
  }

  const { width, height, x0 = 0, y0 = 0 } = map.world;
  scene.add.tileSprite(x0 + width / 2, y0 + height / 2, width, height, map.base, map.baseFrame ?? 0).setDepth(-1000);

  // Columns and rows count from the world's origin, not its corner: the lake out in the Wilds has negative ones.
  const ground = scene.add.container(0, 0).setDepth(-800);
  for (const [col, row, set, frame] of map.terrain) {
    if (scene.textures.exists(set)) ground.add(scene.add.sprite(col * TILE + TILE / 2, row * TILE + TILE / 2, set, frame));
  }

  // Layer by layer across every road of a kind at once, not road by road: where two meet, neither's edge or
  // shadow is drawn over the other, and they join as one. A disc at every vertex rounds each corner and
  // fills each junction. Earth first, then paving over it, so a paved road crossing a path stays whole.
  const roads = scene.add.container(0, 0).setDepth(-400);
  stoneTexture(scene);
  const all = map.paths.filter((p) => p.points.length >= 2);
  // Every road is drawn alike now, whatever its style: one width, one grey (palette.ts, town.ts ROAD_WIDTH).
  const kinds: [typeof PAVED, typeof all][] = [[PAVED, all]];
  for (const [colours, paths] of kinds) {
    const layer = (width: (w: number) => number, colour: number, alpha: number) => {
      const g = scene.add.graphics();
      for (const path of paths) {
        const w = width(path.width);
        g.lineStyle(w, colour, alpha).beginPath();
        path.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        g.strokePath();
        // The shadow is translucent: discs over its own line would show darker, so it keeps square corners under the road.
        if (alpha >= 1) for (const [x, y] of path.points) g.fillStyle(colour, 1).fillCircle(x, y, w / 2);
      }
      roads.add(g);
    };
    const paved = colours === PAVED;
    layer((w) => w + 6, colours.shadow, colours.shadowAlpha);
    layer((w) => w, colours.edge, 1);
    // Paving: a highlight just inside the kerb, the surface within it. Earth: the surface down the middle.
    if (paved) layer((w) => Math.round(w * 0.8), colours.hi, 1);
    layer((w) => Math.max(4, Math.round(paved ? w * 0.8 - 5 : w * 0.6)), colours.surface, 1);
  }
  // The courses follow each street, with staggered joints and a worn stone
  // surface. A small repeating texture keeps the large world inexpensive.
  for (const path of all) {
    for (let i = 1; i < path.points.length; i++) {
      const [ax, ay] = path.points[i - 1]!;
      const [bx, by] = path.points[i]!;
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1) continue;
      roads.add(scene.add.tileSprite((ax + bx) / 2, (ay + by) / 2, length, path.width - 14, "village-stone")
        .setRotation(Math.atan2(by - ay, bx - ax)));
    }
  }
  // A paved plaza at every crossroads, with a kerb.
  const plazas = scene.add.graphics();
  for (const [x, y] of map.plazas ?? []) {
    plazas.fillStyle(PAVED.edge, 1).fillCircle(x, y, PLAZA / 2);
    plazas.fillStyle(PAVED.hi, 1).fillCircle(x, y, PLAZA / 2 - 6);
    plazas.fillStyle(PAVED.surface, 1).fillCircle(x, y, PLAZA / 2 - 9);
    // Concentric cobbles, as a garden roundabout rather than an asphalt disc.
    for (let r = 28; r < PLAZA / 2 - 8; r += 12) {
      plazas.lineStyle(1.5, PAVED.line, 0.8).strokeCircle(x, y, r);
      for (let a = 0; a < Math.PI * 2; a += 0.28) {
        plazas.lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 11), y + Math.sin(a) * (r + 11));
      }
    }
  }
  roads.add(plazas);

  for (const d of map.decorations) {
    if (!scene.textures.exists(d.k)) continue;
    const sprite = d.f !== undefined || d.a !== undefined ? scene.add.sprite(d.x, d.y, d.k, d.f ?? 0) : scene.add.image(d.x, d.y, d.k);
    sprite.setScale(d.s);
    if (d.a !== undefined && sprite instanceof Phaser.GameObjects.Sprite && scene.anims.exists(d.a)) sprite.play(d.a);
    sprite.setDepth(d.d ?? d.y + sprite.displayHeight * 0.5);
    if (d.k.includes("tree")) trees.push({ d, sprite });
  }
  return trees;
}

function stoneTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists("village-stone")) return;
  const texture = scene.textures.createCanvas("village-stone", 48, 32)!;
  const ctx = texture.getContext();
  ctx.fillStyle = "#8d887c";
  ctx.fillRect(0, 0, 48, 32);
  const shades = ["#b9b2a3", "#bdb6a8", "#c7beb0", "#b3ad9f"];
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 4; col++) {
      const x = col * 16 + (row % 2) * 8;
      const y = row * 8;
      ctx.fillStyle = shades[(row * 3 + col + 4) % shades.length]!;
      ctx.fillRect(x + 1, y + 1, 15, 7);
      ctx.fillStyle = "#d4cbbc";
      ctx.fillRect(x + 1, y + 1, 15, 1);
      ctx.fillStyle = "#a6a093";
      ctx.fillRect(x + 2, y + 6, 12, 1);
    }
  }
  texture.refresh();
}
