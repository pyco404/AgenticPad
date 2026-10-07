import { standee } from "./billboard";
import { groundDepth } from "./depth";
// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";

import { ROAD_COLOURS, warmMap } from "./palette";

import type { VillageMap } from "../../../lib/world/map-data";
export type { VillageMap } from "../../../lib/world/map-data";

const TILE = 64;

/**
 * All roads use the same grey stone palette, with worn cobbles on narrow paths.
 */
const PATH_COLOURS = ROAD_COLOURS.paved;
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
  scene.add.tileSprite(x0 + width / 2, y0 + height / 2, width, height, map.base, map.baseFrame ?? 0).setDepth(groundDepth(-1000));

  // Columns and rows count from the world's origin, not its corner: the lake out in the Wilds has negative ones.
  const ground = scene.add.container(0, 0).setDepth(groundDepth(-800));
  for (const [col, row, set, frame] of map.terrain) {
    if (scene.textures.exists(set)) ground.add(scene.add.sprite(col * TILE + TILE / 2, row * TILE + TILE / 2, set, frame));
  }

  // Draw layers across all roads together so edges never cut across junctions.
  // Discs at the vertices round the corners and connect the paths.
  const roads = scene.add.container(0, 0).setDepth(groundDepth(-400));
  const all = map.paths.filter((p) => p.points.length >= 2);
  const weathered = (style: string) => style === "dirt" || style === "trail" || style === "country";
  {
    const layer = (width: (w: number) => number, colour: number, alpha: number) => {
      const g = scene.add.graphics();
      for (const path of all) {
        const w = width(path.width);
        g.lineStyle(w, colour, alpha).beginPath();
        path.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        g.strokePath();
        // The shadow is translucent: discs over its own line would show darker, so it keeps square corners under the road.
        if (alpha >= 1) for (const [x, y] of path.points) g.fillStyle(colour, 1).fillCircle(x, y, w / 2);
      }
      roads.add(g);
    };
    layer((w) => w + 6, PATH_COLOURS.shadow, PATH_COLOURS.shadowAlpha);
    layer((w) => w, PATH_COLOURS.edge, 1);
    layer((w) => Math.max(4, Math.round(w * 0.6)), PATH_COLOURS.surface, 1);
  }
  // Smaller, less regular cobbles on worn paths keep the same stone language.
  const stones = scene.add.graphics();
  for (const road of all) {
    const worn = weathered(road.style);
    const colours = PATH_COLOURS;
    for (let i=1;i<road.points.length;i++) {
      const [ax,ay]=road.points[i-1]!, [bx,by]=road.points[i]!;
      const len=Math.hypot(bx-ax,by-ay);
      if (!len) continue;
      const nx=-(by-ay)/len, ny=(bx-ax)/len;
      for(let d=8;d<len;d+=worn ? 19 : 16) for(const side of [-1,0,1]) {
        if (worn && (i + side + Math.round(d)) % 4 === 0) continue;
        const offset = Math.max(0, Math.min(8, road.width * 0.3 - 4));
        const x=Math.round(ax+(bx-ax)*d/len+nx*side*offset), y=Math.round(ay+(by-ay)*d/len+ny*side*offset);
        stones.fillStyle((i+side)%3 ? colours.hi : colours.line,worn ? 0.5 : 0.7).fillRect(x-3,y-2,worn ? 4 : 6,4);
      }
    }
  }
  roads.add(stones);
  // A few gathering clearings rather than roundabouts around the world.
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
    if (d.k.includes("tree")) sprite.setOrigin(0.5, 1);
    if (d.a !== undefined && sprite instanceof Phaser.GameObjects.Sprite && scene.anims.exists(d.a)) sprite.play(d.a);
    sprite.setDepth(d.d ?? (d.k.includes("tree") ? d.y : d.y + sprite.displayHeight * 0.5));
    standee(sprite, d.k.includes("tree"));
    if (d.k.includes("tree")) trees.push({ d, sprite });
  }
  return trees;
}
