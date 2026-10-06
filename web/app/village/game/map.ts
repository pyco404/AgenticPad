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
  /** Retains routing styles; every road uses the shared sandy trail colours. */
  paths: { style: string; width: number; points: [number, number][] }[];
  /** Sandy plazas, one at each crossroads of the world's roads. */
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
 * Every road shares the small trail's sandy colour and darker earthen edge.
 */
const PATH_COLOURS = ROAD_COLOURS.dirt;
/** A plaza at every crossroads, this wide across. */
const PLAZA = 150;

/**
 * Queue every texture the map, the heroes and the buildings use. Paths are
 * relative to the loader's path. The pack's ground, water, trees and bushes
 * come recoloured to the terrain palette (palette.ts warmMap).
 */
export function loadMap(scene: Phaser.Scene, map: VillageMap): void {
  for (const t of map.textures) {
    const path = t.key === "resources-trees-tree" ? "reference/trees.png" : warmMap(t.path);
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

  // Draw layers across all roads together so edges never cut across junctions.
  // Discs at the vertices round the corners and connect the paths.
  const roads = scene.add.container(0, 0).setDepth(-400);
  const all = map.paths.filter((p) => p.points.length >= 2);
  // Every road shares the small trail's existing sandy palette and edge treatment.
  const kinds: [typeof PATH_COLOURS, typeof all][] = [[PATH_COLOURS, all]];
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
    layer((w) => w + 6, colours.shadow, colours.shadowAlpha);
    layer((w) => w, colours.edge, 1);
    layer((w) => Math.max(4, Math.round(w * 0.6)), colours.surface, 1);
  }
  // Roundabouts use the same sand, with the darker trail edge.
  const plazas = scene.add.graphics();
  for (const [x, y] of map.plazas ?? []) {
    plazas.fillStyle(PATH_COLOURS.edge, 1).fillCircle(x, y, PLAZA / 2);
    plazas.fillStyle(PATH_COLOURS.surface, 1).fillCircle(x, y, PLAZA / 2 - 9);
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
