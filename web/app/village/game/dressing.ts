import * as Phaser from "phaser";

import { CARPET, SQUARE } from "./town";

/**
 * The village's set dressing: what makes the map read as a town built round
 * the game rather than eight landmarks in a forest - the crest flying over it,
 * each building's props (the leaderboard aside, which is a building), the
 * agent grounds at the forest's edge, the town square.
 * Placed here rather than in the map, so an import of Agent Quest's map
 * (scripts/village-import.ts) never loses it.
 *
 * The banners, flags, boards, statues, chests, tents and the rest are drawn
 * for AgentClash (scripts/village-art.ts) in the Tiny Swords pack's palette
 * and the crest's. The cottages, the fountain, the gold sacks and the ship
 * are the pack's own or drawn for it before (public/fixtures/LICENSE.txt).
 *
 * Nothing here is clickable, and none of it is a building: it only decorates.
 * What is solid - a cottage, the fountain, a tent - is solid to walkers too,
 * so an agent goes round it rather than through it.
 */

type Piece = {
  key: string;
  image: string;
  x: number;
  y: number;
  scale: number;
  /** Where the foot is, as a share of the picture's height: art is often padded below. */
  foot?: number;
  flip?: boolean;
  /** Solid to walkers: this wide and deep, in world pixels, above the foot. */
  solid?: { width: number; height: number };
  /** A sprite sheet, played on a loop. */
  sheet?: { frameWidth: number; frameHeight: number; frameRate: number; start?: number };
  /** A texture the map already loads, so it is not loaded again. */
  mapped?: boolean;
  /** Rides the water: a slow rise and fall. */
  bob?: boolean;
  /** A fixed depth, for a piece the map's own layering would bury: the lake's water is drawn over anything low in it. */
  depth?: number;
};

const ART = "/village/agentclash";

/** A piece of the AgentClash art, drawn at its two world pixels to the art pixel unless told otherwise. */
const art = (name: string, x: number, y: number, scale = 2, more: Partial<Piece> = {}): Piece => ({
  key: `ac-${name}`,
  image: `${ART}/${name}.png`,
  x,
  y,
  scale,
  ...more,
});
const banner = (x: number, y: number, kind: "banner" | "banner-fame" | "banner-gold" = "banner") => art(kind, x, y, 1.5);
/** A flag on a tall pole, the crest on it, in two frames of a slow wave. */
const flag = (x: number, y: number, start = 0) =>
  art("flag", x, y, 1.6, { sheet: { frameWidth: 28, frameHeight: 58, frameRate: 1.6, start } });
const tent = (x: number, y: number, flip = false) => art("tent", x, y, 1.6, { flip, solid: { width: 60, height: 40 } });
const fire = (x: number, y: number): Piece => ({
  key: "effects-fire-fire",
  image: "",
  x,
  y,
  scale: 0.34,
  foot: 0.75,
  mapped: true,
  sheet: { frameWidth: 128, frameHeight: 128, frameRate: 12 },
});
const cottage = (colour: "Blue" | "Red" | "Purple" | "Yellow", x: number, y: number, flip = false): Piece => ({
  key: `dress-house-${colour.toLowerCase()}`,
  image: `/fixtures/House_${colour}.png`,
  x,
  y,
  scale: 0.55,
  foot: 172 / 192,
  flip,
  solid: { width: 56, height: 70 },
});
const bush = (key: string, x: number, y: number): Piece => ({ key, image: "", x, y, scale: 0.6, mapped: true });
const gold = (x: number, y: number, scale: number): Piece => ({ key: "prop-gold", image: "/fixtures/Gold.png", x, y, scale });

export const PIECES: Piece[] = [
  // The town's flags: at the ring road's corners and either side of the avenue up to the arena.
  flag(975, 468),
  flag(1825, 468, 1),
  flag(975, 1040, 1),
  flag(1825, 1040),
  flag(1372, 1075, 1),
  flag(1450, 1075),

  // The Hiring Hall: the agents for hire on a board, one picked out.
  art("hiring-board", 738, 1128, 1.6),
  banner(925, 1126),
  banner(778, 1126),

  // The Strategy Lab: a decision tree on an easel and a planning table.
  art("strategy-board", 662, 768, 1.6),
  art("war-table", 935, 702, 1.5),
  banner(712, 762),

  // The Game Hall: screens of the matches playing.
  art("scoreboard", 2168, 772, 1.6, { sheet: { frameWidth: 66, frameHeight: 66, frameRate: 1.2 } }),
  banner(1925, 770),
  banner(2095, 770),

  // The Hall of Fame: champions in gold, cups, banners of navy and gold, a carpet to the door.
  art("statue", 1300, 474, 1.6),
  art("statue", 1500, 474, 1.6, { flip: true }),
  art("trophy", 1335, 482, 1.4),
  art("trophy", 1465, 482, 1.4),
  banner(1262, 456, "banner-fame"),
  banner(1538, 456, "banner-fame"),

  // The Treasury: chests, coins and sacks of gold at its door.
  art("chest", 1640, 476, 1.6),
  art("chest-shut", 1775, 472, 1.5),
  art("coins", 1664, 488, 1.6),
  art("coins", 1752, 490, 1.4),
  gold(1622, 470, 0.42),
  gold(1792, 478, 0.36),
  banner(1602, 456, "banner-gold"),
  banner(1812, 456, "banner-gold"),

  // The Lookout.
  banner(1135, 452),

  // Bushes in the corners the arena leaves inside the ring road, the pack's own.
  bush("bush-1", 1046, 548),
  bush("bush-2", 1070, 566),
  bush("bush-4", 1752, 546),
  bush("bush-1", 1730, 566),
  bush("bush-2", 1046, 972),
  bush("bush-4", 1066, 958),
  bush("bush-1", 1754, 972),
  bush("bush-2", 1734, 958),

  // The town square: the fountain, benches round it.
  { key: "dress-fountain", image: "/fixtures/Fountain.png", x: 1400, y: 1172, scale: 0.6, solid: { width: 52, height: 26 } },
  art("bench", 1300, 1204, 1.6),
  art("bench", 1500, 1204, 1.6),

  // The agent grounds. North-west, a camp: tents round a fire.
  tent(795, 560),
  tent(918, 532, true),
  fire(862, 600),
  art("log", 826, 618, 1.6),
  art("log", 900, 620, 1.6, { flip: true }),

  // West, the training yard.
  art("dummy", 592, 905, 1.6),
  art("dummy", 646, 922, 1.6),
  art("dummy", 700, 905, 1.6),
  art("bench", 718, 970, 1.6),
  flag(560, 960),

  // North-east, a terrace off the ring: benches, a tent, a fire.
  art("bench", 1925, 604, 1.6),
  art("bench", 2018, 606, 1.6),
  tent(2068, 568, true),
  fire(1972, 660),

  // South-west, a camp at the end of the high street.
  tent(598, 1262),
  fire(655, 1312),
  art("log", 700, 1312, 1.6, { flip: true }),

  // South-east, cottages off the dock road, a fire between them.
  cottage("Blue", 2085, 1250),
  cottage("Yellow", 2160, 1365, true),
  cottage("Red", 1880, 1300),
  fire(2100, 1318),
  art("bench", 2036, 1345, 1.6),

  // The lakeside, at the end of the trail south from the square.
  art("bench", 1340, 1428, 1.6),
  art("bench", 1460, 1428, 1.6),

  // A ship moored off the dock.
  { key: "dress-ship", image: "/fixtures/Ship.png", x: 1838, y: 1602, scale: 0.62, bob: true, depth: 2_000 },
];

/** The tree sheet's frame, in its own pixels: a tree is drawn from the middle of it. */
const TREE_FRAME = 192;

const toSegment = (x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};

/**
 * Whether a tree stands on a road: its canopy clearly over the road, not just
 * brushing its edge. The map places trees without regard to its own roads, so
 * some hid stretches of them; those are not drawn.
 */
export function overRoad(d: { k: string; x: number; y: number; s: number }, paths: { width: number; points: [number, number][] }[]): boolean {
  if (!d.k.includes("tree")) return false;
  const h = TREE_FRAME * d.s;
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-0.3, -0.1, 0.1, 0.25]) {
      const x = d.x + fx * h * 0.2;
      const y = d.y + fy * h;
      for (const p of paths) {
        for (let i = 1; i < p.points.length; i++) {
          if (toSegment(x, y, p.points[i - 1]!, p.points[i]!) < p.width / 2 - 6) return true;
        }
      }
    }
  }
  return false;
}

/** Queue every picture the dressing needs that the map does not already load. Paths are from the site's root. */
export function loadDressing(scene: Phaser.Scene): void {
  const seen = new Set<string>();
  for (const p of PIECES) {
    if (p.mapped || seen.has(p.key) || scene.textures.exists(p.key)) continue;
    seen.add(p.key);
    if (p.sheet) scene.load.spritesheet(p.key, p.image, { frameWidth: p.sheet.frameWidth, frameHeight: p.sheet.frameHeight });
    else scene.load.image(p.key, p.image);
  }
}

/** A piece's place on the ground, for the town's lots: the forest keeps clear of it. */
export type Bounds = { x: number; y: number; width: number; height: number };

/** Draw the dressing, each piece at the depth of its foot like the map's own; return what is solid, and where everything is. */
export function drawDressing(scene: Phaser.Scene, still: boolean): { solids: Bounds[]; placed: Bounds[] } {
  // The square and the carpet first, just over the map's roads, so they join them without a seam.
  const g = scene.add.graphics().setDepth(-399);
  const sq = SQUARE;
  // In the roads' own colours (map.ts), so they run into it without a seam.
  g.fillStyle(0x3a2f1e, 0.3).fillEllipse(sq.x, sq.y, sq.rx * 2 + 6, sq.ry * 2 + 6);
  g.fillStyle(0x584c31, 1).fillEllipse(sq.x, sq.y, sq.rx * 2, sq.ry * 2);
  g.fillStyle(0x5e4e38, 1).fillEllipse(sq.x, sq.y, sq.rx * 2 - 26, sq.ry * 2 - 16);
  // A ring of teal stone set in it, the crest's colour.
  g.lineStyle(4, 0x189b68, 0.8).strokeEllipse(sq.x, sq.y, sq.rx * 2 - 44, sq.ry * 2 - 26);
  const c = CARPET;
  g.fillStyle(0xb07a2a, 1).fillRect(c.x - c.width / 2 - 3, c.y0, c.width + 6, c.y1 - c.y0);
  g.fillStyle(0x015f68, 1).fillRect(c.x - c.width / 2, c.y0, c.width, c.y1 - c.y0);
  g.fillStyle(0x189b68, 1).fillRect(c.x - c.width / 2 + 4, c.y0, c.width - 8, c.y1 - c.y0);

  const solids: Bounds[] = [];
  const placed: Bounds[] = [];
  for (const p of PIECES) {
    if (!scene.textures.exists(p.key)) continue;
    const obj = p.sheet ? scene.add.sprite(p.x, p.y, p.key, p.sheet.start ?? 0) : scene.add.image(p.x, p.y, p.key);
    obj.setOrigin(0.5, p.foot ?? 1).setScale(p.scale).setFlipX(p.flip ?? false).setDepth(p.depth ?? p.y);
    if (p.sheet && obj instanceof Phaser.GameObjects.Sprite && !still) {
      const anim = `${p.key}:loop`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(p.key, {}), frameRate: p.sheet.frameRate, repeat: -1 });
      }
      obj.play({ key: anim, startFrame: p.sheet.start ?? 0 });
    }
    if (p.bob && !still) {
      scene.tweens.add({ targets: obj, y: p.y + 3, angle: 1.5, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    if (p.solid) solids.push({ x: p.x, y: p.y, width: p.solid.width, height: p.solid.height });
    placed.push({ x: p.x, y: p.y, width: obj.displayWidth, height: obj.displayHeight * (p.foot ?? 1) });
  }
  return { solids, placed };
}

/**
 * Solar lights round the town square and down to the lakeside: little lamp posts with a panel on top,
 * drawn here in the pack's palette since the pack has none. By day they are
 * dark, charging; at night they come on, a warm pool on the ground and a glow
 * drawn over the night's blue so it reads as light rather than as paint.
 */
const SOLAR_LIGHTS: { x: number; y: number }[] = [
  { x: 1238, y: 1128 },
  { x: 1562, y: 1186 },
  { x: 1238, y: 1196 },
  { x: 1100, y: 1192 },
  { x: 1700, y: 1192 },
  { x: 1372, y: 1300 },
  { x: 1428, y: 1300 },
  { x: 1372, y: 1036 },
  { x: 1428, y: 1036 },
]

/** The lamp, a row to a string, in art pixels: panel, lamp, cap, post, foot. */
const LAMP_ART = [
  ".ppppp.",
  "pPPPPPp",
  ".ooooo.",
  ".ogggo.",
  ".ogggo.",
  "..ooo..",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "...o...",
  "..ooo..",
];
const LAMP_COLOURS: Record<string, number> = { p: 0x1d2b4f, P: 0x4a6fa5, o: 0x2b2f36, g: 0xd8d2b8 };
/** World pixels to an art pixel, about the pack's own. */
const LAMP_PX = 2;
/** Where the lamp's glass is, in art pixels from the top. */
const LAMP_GLASS_Y = 3.5;

/** The lamp's picture and a soft round glow, made once. */
function lampTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists("dress-solar-lamp")) {
    const g = scene.make.graphics({}, false);
    LAMP_ART.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const colour = LAMP_COLOURS[c];
        if (colour !== undefined) g.fillStyle(colour, 1).fillRect(x * LAMP_PX, y * LAMP_PX, LAMP_PX, LAMP_PX);
      }),
    );
    g.generateTexture("dress-solar-lamp", LAMP_ART[0]!.length * LAMP_PX, LAMP_ART.length * LAMP_PX);
    g.destroy();
  }
  if (!scene.textures.exists("dress-solar-glow")) {
    const size = 64;
    const canvas = scene.textures.createCanvas("dress-solar-glow", size, size);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,236,170,1)");
      grad.addColorStop(0.35, "rgba(255,214,120,0.45)");
      grad.addColorStop(1, "rgba(255,200,100,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
    }
  }
}

/** Draw the solar lights, off; the handle turns them on for the night. */
export function drawSolarLights(scene: Phaser.Scene, still: boolean): { setNight: (on: boolean) => void } {
  lampTextures(scene);
  const lit: Phaser.GameObjects.GameObject[] = [];
  const height = LAMP_ART.length * LAMP_PX;
  for (const [i, at] of SOLAR_LIGHTS.entries()) {
    scene.add.image(at.x, at.y, "dress-solar-lamp").setOrigin(0.5, 1).setDepth(at.y);
    const glassY = at.y - height + LAMP_GLASS_Y * LAMP_PX;
    // Over the night's blue (depth 9,000), under the names: light, not a colour under the dark.
    const pool = scene.add.image(at.x, at.y + 2, "dress-solar-glow").setDisplaySize(90, 40).setAlpha(0.35);
    const halo = scene.add.image(at.x, glassY, "dress-solar-glow").setDisplaySize(44, 44).setAlpha(0.8);
    const glass = scene.add.rectangle(at.x, glassY, 3 * LAMP_PX, 2 * LAMP_PX, 0xfff6c8);
    for (const o of [pool, halo, glass]) {
      o.setDepth(9_001).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      lit.push(o);
    }
    // A slow breath, out of step from lamp to lamp.
    if (!still) {
      scene.tweens.add({ targets: halo, alpha: 0.55, duration: 1600 + i * 170, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: i * 240 });
    }
  }
  return { setNight: (on) => lit.forEach((o) => (o as Phaser.GameObjects.Image).setVisible(on)) };
}
