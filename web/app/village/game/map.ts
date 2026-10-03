// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";

/** public/village/map.json, as scripts/village-import.ts writes it. */
export type VillageMap = {
  world: { width: number; height: number };
  base: string;
  /** [column, row, tileset, frame] */
  terrain: [number, number, string, number][];
  /** Its style is kept as the map names it; every road is drawn alike (ROAD). */
  paths: { style: string; width: number; points: [number, number][] }[];
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
 * Every road's colours, the same on all of them: a dark outer band, a lighter
 * middle, a thin line down the centre, over a soft shadow on the grass.
 */
const ROAD = { shadow: 0x3a2f1e, shadowAlpha: 0.3, outer: 0x584c31, inner: 0x5e4e38, line: 0x483a27 };

/** Queue every texture the map, the heroes and the buildings use. Paths are relative to the loader's path. */
export function loadMap(scene: Phaser.Scene, map: VillageMap): void {
  for (const t of map.textures) {
    if (t.frameWidth !== undefined && t.frameHeight !== undefined) {
      scene.load.spritesheet(t.key, t.path, { frameWidth: t.frameWidth, frameHeight: t.frameHeight });
    } else {
      scene.load.image(t.key, t.path);
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

  const { width, height } = map.world;
  scene.add.tileSprite(width / 2, height / 2, width, height, map.base, 0).setDepth(-1000);

  const ground = scene.add.container(0, 0).setDepth(-800);
  for (const [col, row, set, frame] of map.terrain) {
    if (scene.textures.exists(set)) ground.add(scene.add.sprite(col * TILE + TILE / 2, row * TILE + TILE / 2, set, frame));
  }

  // Layer by layer across every road at once, not road by road: where two meet, neither's edge or
  // shadow is drawn over the other, and they join as one. A disc at every vertex rounds each corner
  // and fills each junction.
  const roads = scene.add.container(0, 0).setDepth(-400);
  const paths = map.paths.filter((p) => p.points.length >= 2);
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
  layer((w) => w + 6, ROAD.shadow, ROAD.shadowAlpha);
  layer((w) => w, ROAD.outer, 1);
  layer((w) => Math.max(4, Math.round(w * 0.5)), ROAD.inner, 1);
  layer(() => 1.5, ROAD.line, 1);

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
