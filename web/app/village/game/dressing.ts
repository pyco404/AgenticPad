import * as Phaser from "phaser";

/**
 * The village's set dressing: what makes the map read as a place people live
 * rather than eight landmarks in a forest - a fountain on a green, cottages,
 * a farm with sheep, a ship at the dock, banners at the doors, a campfire.
 * Placed here rather than in the map, so an import of Agent Quest's map
 * (scripts/village-import.ts) never loses it.
 *
 * The houses, sheep and pumpkins are the Tiny Swords pack's own art (CC0,
 * public/fixtures/LICENSE.txt). The fountain, ship, banners, fences and field
 * are not in the pack: they are drawn for AgentClash in the pack's palette and
 * at its pixel size.
 *
 * Nothing here is clickable, and none of it is a building: it only decorates.
 * What is solid - a cottage, the fountain - is solid to walkers too, so an
 * agent goes round it rather than through it.
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

/**
 * Paving the map does not have, drawn like its own roads (map.ts): a round
 * square for the fountain, and the short paths that join it to the roads.
 */
const PAVING = {
  fill: 0x7a6548,
  edge: 0x5c4e3a,
  squares: [{ x: 1472, y: 1140, rx: 66, ry: 34 }],
  paths: [
    { width: 34, points: [[1472, 1110], [1472, 1036]] },
    { width: 34, points: [[1536, 1140], [1592, 1140]] },
  ] as { width: number; points: [number, number][] }[],
};

/**
 * Patches of forest cleared to make room, in world pixels: no map decoration
 * whose foot is inside one is drawn. Each is kept off the roads beside it.
 */
export const CLEARINGS: { x0: number; y0: number; x1: number; y1: number; treesOnly?: boolean }[] = [
  { x0: 1405, y0: 1055, x1: 1545, y1: 1190 }, // the green, south of the halls
  { x0: 2010, y0: 1040, x1: 2245, y1: 1370 }, // the farm, east of the dock road
  { x0: 1785, y0: 1100, x1: 1935, y1: 1380 }, // cottages, west of the dock road
  { x0: 830, y0: 890, x1: 962, y1: 1120 }, // cottages, west of the Hall of Fame
  // The green below the High Keep, where the Game Hall's name and its waiting agents are: its trees
  // hid both. Its bushes and stones stay.
  { x0: 1150, y0: 760, x1: 1490, y1: 945, treesOnly: true },
  // Between the Hiring Hall and the Game Hall, and where the Game Hall's queue stands.
  { x0: 1195, y0: 925, x1: 1245, y1: 990, treesOnly: true },
  { x0: 1270, y0: 1040, x1: 1320, y1: 1090, treesOnly: true },
];

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
const banner = (colour: "blue" | "red" | "green" | "purple" | "gold", x: number, y: number): Piece => ({
  key: `dress-banner-${colour}`,
  image: `/fixtures/Banner_${colour}.png`,
  x,
  y,
  scale: 0.45,
});
const fence = (x: number, y: number): Piece => ({ key: "dress-fence", image: "/fixtures/Fence.png", x, y, scale: 0.6 });
const plot = (x: number, y: number): Piece => ({ key: "dress-plot", image: "/fixtures/Plot.png", x, y, scale: 0.6 });
const sheep = (x: number, y: number, start: number, flip = false): Piece => ({
  key: "dress-sheep",
  image: "/fixtures/Sheep.png",
  x,
  y,
  scale: 0.5,
  foot: 86 / 128,
  flip,
  sheet: { frameWidth: 128, frameHeight: 128, frameRate: 8, start },
});

export const PIECES: Piece[] = [
  // The Treasury is a chapel in the pack, so sacks of gold stand at its door.
  { key: "prop-gold", image: "/fixtures/Gold.png", x: 1596, y: 852, scale: 0.42 },
  { key: "prop-gold", image: "/fixtures/Gold.png", x: 1609, y: 858, scale: 0.34 },
  { key: "prop-gold", image: "/fixtures/Gold.png", x: 1583, y: 860, scale: 0.36 },

  // The green: a fountain south of the halls, where the roads meet.
  { key: "dress-fountain", image: "/fixtures/Fountain.png", x: 1472, y: 1150, scale: 0.6, solid: { width: 52, height: 26 } },

  // Banners at the doors, in each building's colour.
  banner("gold", 1046, 862),
  banner("blue", 1092, 708),
  banner("gold", 1680, 847),

  // Cottages, so the village has people in it and not only landmarks.
  cottage("Blue", 1880, 1200),
  cottage("Yellow", 1880, 1330, true),
  cottage("Purple", 892, 990),
  cottage("Red", 892, 1110, true),
  // A campfire between the east cottages.
  { key: "effects-fire-fire", image: "", x: 1826, y: 1268, scale: 0.34, foot: 0.75, mapped: true, sheet: { frameWidth: 128, frameHeight: 128, frameRate: 12 } },

  // The farm: fenced fields, a scarecrow, pumpkins, and sheep grazing below.
  fence(2046, 1072),
  fence(2104, 1072),
  fence(2162, 1072),
  fence(2220, 1072),
  plot(2075, 1128),
  plot(2165, 1128),
  plot(2075, 1190),
  plot(2165, 1190),
  { key: "deco-18", image: "", x: 2122, y: 1250, scale: 0.42, mapped: true },
  { key: "dress-pumpkin", image: "/fixtures/Pumpkin.png", x: 2058, y: 1256, scale: 0.55 },
  { key: "rock-4", image: "", x: 2086, y: 1266, scale: 0.5, mapped: true },
  { key: "dress-pumpkin", image: "/fixtures/Pumpkin.png", x: 2196, y: 1252, scale: 0.45, flip: true },
  fence(2046, 1290),
  fence(2104, 1290),
  fence(2162, 1290),
  fence(2220, 1290),
  sheep(2060, 1332, 0),
  sheep(2140, 1350, 3, true),
  sheep(2206, 1328, 5),

  // A ship moored off the dock.
  { key: "dress-ship", image: "/fixtures/Ship.png", x: 1838, y: 1602, scale: 0.62, bob: true, depth: 2_000 },
];

/** Whether a map decoration stands in one of the clearings, and so is not drawn. */
export const cleared = (p: { k: string; x: number; y: number }) =>
  CLEARINGS.some(
    (c) => p.x >= c.x0 && p.x <= c.x1 && p.y >= c.y0 && p.y <= c.y1 && (!c.treesOnly || p.k.includes("tree")),
  );

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

/** Draw the dressing, each piece at the depth of its foot like the map's own, and return what is solid. */
export function drawDressing(scene: Phaser.Scene, still: boolean): { x: number; y: number; width: number; height: number }[] {
  // The paving first, just over the map's roads, so it joins them without a seam.
  const g = scene.add.graphics().setDepth(-399);
  for (const path of PAVING.paths) {
    for (const [width, colour, alpha] of [
      [path.width + 6, PAVING.edge, 0.3],
      [path.width, PAVING.fill, 0.95],
    ] as const) {
      g.lineStyle(width, colour, alpha).beginPath();
      path.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.strokePath();
    }
  }
  for (const sq of PAVING.squares) {
    g.fillStyle(PAVING.edge, 0.35).fillEllipse(sq.x, sq.y, sq.rx * 2 + 8, sq.ry * 2 + 8);
    g.fillStyle(PAVING.fill, 0.95).fillEllipse(sq.x, sq.y, sq.rx * 2, sq.ry * 2);
    g.fillStyle(PAVING.fill + 0x0a0a0a, 1).fillEllipse(sq.x, sq.y, sq.rx * 2 - 18, sq.ry * 2 - 12);
    g.lineStyle(1.5, PAVING.edge, 0.6).strokeEllipse(sq.x, sq.y, sq.rx * 2, sq.ry * 2);
  }

  const solids: { x: number; y: number; width: number; height: number }[] = [];
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
  }
  return solids;
}

/**
 * Solar lights along the farm's fields: little lamp posts with a panel on top,
 * drawn here in the pack's palette since the pack has none. By day they are
 * dark, charging; at night they come on, a warm pool on the ground and a glow
 * drawn over the night's blue so it reads as light rather than as paint.
 */
const SOLAR_LIGHTS: { x: number; y: number }[] = [
  { x: 2034, y: 1112 },
  { x: 2120, y: 1146 },
  { x: 2208, y: 1112 },
  { x: 2034, y: 1204 },
  { x: 2208, y: 1204 },
  { x: 2120, y: 1278 },
];

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
