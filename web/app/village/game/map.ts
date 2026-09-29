// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";

/** public/village/map.json, as scripts/village-import.ts writes it. */
export type VillageMap = {
  world: { width: number; height: number };
  base: string;
  /** [column, row, tileset, frame] */
  terrain: [number, number, string, number][];
  paths: { style: keyof typeof PATH_STYLES; width: number; points: [number, number][] }[];
  /** k: texture, f: frame, s: scale, d: fixed depth, a: animation to play. */
  decorations: { k: string; f?: number; x: number; y: number; s: number; d?: number; a?: string }[];
  buildings: { id: string; x: number; y: number }[];
  spawn: { x: number; y: number };
  heroScale: number;
  textures: { key: string; path: string; frameWidth?: number; frameHeight?: number }[];
  animations: { key: string; texture: string; start: number; end: number; frameRate: number; repeat: number }[];
};

const TILE = 64;

const PATH_STYLES = {
  main: { fill: 0x7a6548, stroke: 0x4a3a24, strokeAlpha: 0.55, fillAlpha: 0.92 },
  secondary: { fill: 0x8a7858, stroke: 0x5a4a2c, strokeAlpha: 0.5, fillAlpha: 0.88 },
  trail: { fill: 0x5c4a30, stroke: 0x3a2a18, strokeAlpha: 0.55, fillAlpha: 0.9 },
  plaza: { fill: 0x7a6548, stroke: 0x5c4e3a, strokeAlpha: 0.6, fillAlpha: 0.95 },
} as const;

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
export function drawMap(scene: Phaser.Scene, map: VillageMap): void {
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

  const roads = scene.add.container(0, 0).setDepth(-400);
  for (const path of map.paths) {
    if (path.points.length < 2) continue;
    const style = PATH_STYLES[path.style];
    const g = scene.add.graphics();
    const stroke = (width: number, colour: number, alpha: number) => {
      g.lineStyle(width, colour, alpha);
      g.beginPath();
      path.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.strokePath();
    };
    stroke(path.width + 6, style.stroke, style.strokeAlpha * 0.5); // shadow
    stroke(path.width, style.fill, style.fillAlpha);
    stroke(Math.max(2, path.width - 14), style.fill + 0x0a0a0a, Math.min(1, style.fillAlpha + 0.05)); // highlight
    stroke(1.5, style.stroke, style.strokeAlpha); // edge
    roads.add(g);
  }

  for (const d of map.decorations) {
    if (!scene.textures.exists(d.k)) continue;
    const sprite = d.f !== undefined || d.a !== undefined ? scene.add.sprite(d.x, d.y, d.k, d.f ?? 0) : scene.add.image(d.x, d.y, d.k);
    sprite.setScale(d.s);
    if (d.a !== undefined && sprite instanceof Phaser.GameObjects.Sprite && scene.anims.exists(d.a)) sprite.play(d.a);
    sprite.setDepth(d.d ?? d.y + sprite.displayHeight * 0.5);
  }
}
