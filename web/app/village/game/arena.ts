import * as Phaser from "phaser";
import { COLOSSEUM as O, COLOSSEUM_FLOOR as F, ARENA_GATE_WIDTH, ARENA_SIDE_WIDTH } from "./arena-geometry";
import { groundDepth } from "./depth";
import { ROAD_COLOURS } from "./palette";

/** Bake an oval colosseum once in two-world-pixel steps, using the existing renderer and emblem. */
const SCALE = 2, W = 420, H = 280;
const LEFT = O.x - W, TOP = 975 - H * SCALE;
const STEP = Math.PI * 2 / 96;
/** A single material palette: identity colours carry the landmark; stone supports it. */
const C = {
  emerald: "#116340", green: "#23895a", teal: "#248e8b", dark: "#153c32", mint: "#72d99b",
  gold: "#d6a340", goldLight: "#f6d77d", goldDark: "#92642c",
  stone: "#9caa9e", stoneLight: "#c8cebb", stoneShade: "#718179", joint: "#4c6258",
  wood: ["#795035", "#9e6840", "#b7824d", "#c29159"], woodDark: "#4f3427",
  roof: "#a45232", roofLight: "#cc7542", roofShade: "#703d2e", roofTile: "#e09757",
  sand: "#e2b775", sandLight: "#edc88b", sandShade: "#c59556", sandEdge: "#a77642",
} as const;
type P = [number, number];
const outer = (a: number, elevated = true): P => [O.x + Math.cos(a) * O.rx, O.y + Math.sin(a) * O.ry - (elevated ? O.wallHeight : 0)];
const ring = (a: number, t: number): P => [F.x + Math.cos(a) * (F.rx + (O.rx - F.rx) * t), F.y + (O.y - F.y) * t + Math.sin(a) * (F.ry + (O.ry - F.ry) * t) - O.wallHeight * t];
const openSector = (a: number) => Math.sin(a) > 0 && Math.abs(Math.cos(a) * O.rx) < ARENA_GATE_WIDTH / 2
  || Math.cos(a) > 0 && Math.abs(Math.sin(a) * O.ry) < ARENA_SIDE_WIDTH / 2;

export function loadArena(scene: Phaser.Scene): void {
  scene.load.image("ac-arena-emblem", "/agenticpad-tb.png");
}

/** Building owns the interactive back/floor layer; the front occludes actors inside the bowl. */
export function buildArenaArt(scene: Phaser.Scene): void {
  if (scene.textures.exists("building-arena")) return;
  const make = (key: string) => scene.textures.createCanvas(key, W, H)!;
  const back = make("building-arena"), front = make("ac-oval-front");
  const crowds = [make("ac-oval-crowd"), make("ac-oval-cheer")];
  const b = back.getContext(), f = front.getContext();
  const xy = ([x, y]: P): P => [Math.round((x - LEFT) / SCALE), Math.round((y - TOP) / SCALE)];
  const polygon = (ctx: CanvasRenderingContext2D, points: P[], fill: string, stroke?: string, material?: "wood" | "roof" | "stone") => {
    ctx.beginPath(); points.forEach((p, i) => { const [x, y] = xy(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (material) {
      ctx.save(); ctx.clip();
      const coords = points.map(xy), xs = coords.map(([x]) => x), ys = coords.map(([, y]) => y);
      const step = material === "roof" ? 4 : 5;
      for (let y = Math.floor(Math.min(...ys) / step) * step; y <= Math.max(...ys); y += step) {
        for (let x = Math.floor(Math.min(...xs) / 6) * 6; x <= Math.max(...xs); x += 6) {
          const stagger = Math.abs(y / step) % 2 * 3;
          ctx.globalAlpha = material === "roof" ? .35 : .22;
          ctx.fillStyle = material === "wood" ? C.goldLight : material === "roof" ? C.roofTile : C.stoneLight;
          ctx.fillRect(x + stagger, y, material === "wood" ? 4 : 5, 1);
          ctx.globalAlpha = .25; ctx.fillStyle = material === "stone" ? C.joint : C.woodDark;
          ctx.fillRect(x + stagger + 5, y + 1, 1, material === "wood" ? 1 : step - 1);
        }
      }
      ctx.restore();
    }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, colour: string) => {
    ctx.fillStyle = colour;
    for (let sy = -ry; sy <= ry; sy += SCALE) {
      const half = rx * Math.sqrt(Math.max(0, 1 - (sy / ry) ** 2));
      ctx.fillRect(Math.round((x - half - LEFT) / SCALE), Math.round((y + sy - TOP) / SCALE), Math.round(half * 2 / SCALE), 1);
    }
  };
  ellipse(b, O.x + 8, O.y + 8, O.rx + 10, O.ry + 3, "#43543c");
  b.fillStyle = C.stone;
  const [fx, fy] = xy([O.x - 70, F.y + 100]); b.fillRect(fx, fy, 70, 38);
  const [ex, ey] = xy([F.x + 220, O.y - 48]); b.fillRect(ex, ey, 82, 48);
  ellipse(b, F.x, F.y, F.rx + 2, F.ry + 2, C.sandEdge);
  ellipse(b, F.x, F.y, F.rx - 4, F.ry - 4, C.sand);
  ellipse(b, F.x - 12, F.y - 4, F.rx - 30, F.ry - 18, "#e6bd7d");
  let seed = 391;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 1600; i++) {
    const x = (random() * 2 - 1) * (F.rx - 8), y = (random() * 2 - 1) * (F.ry - 8);
    if ((x / (F.rx - 8)) ** 2 + (y / (F.ry - 8)) ** 2 > 1) continue;
    const [px, py] = xy([F.x + x, F.y + y]); b.fillStyle = i % 3 ? C.sandLight : C.sandShade; b.fillRect(px, py, i % 7 ? 1 : 2, 1);
  }
  for (let i = 0; i < 96; i++) {
    const a = i * STEP, z = a + STEP, mid = a + STEP / 2;
    if (openSector(mid)) continue;
    const ctx = Math.sin(mid) > 0 ? f : b;
    const p = outer(a), q = outer(z), lowP = outer(a, false), lowQ = outer(z, false);
    polygon(ctx, [p, q, lowQ, lowP], Math.cos(mid) < 0 ? C.stone : C.stoneShade, C.joint, "stone");
    // A coloured cornice and gold cap bind the stone piers into one crafted building.
    polygon(ctx, [p, q, [q[0], q[1] + 12], [p[0], p[1] + 12]], i % 2 ? C.green : C.emerald, C.dark);
    polygon(ctx, [p, q, [q[0], q[1] + 3], [p[0], p[1] + 3]], C.goldLight);
    const [mx, my] = xy([(p[0] + q[0]) / 2, (lowP[1] + lowQ[1]) / 2]);
    ctx.fillStyle = C.joint; ctx.fillRect(mx - 4, my - 6, 8, 1); ctx.fillRect(mx, my - 6, 1, 6); ctx.fillRect(mx - 3, my + 1, 8, 1);
    if (Math.sin(mid) > 0 && i % 3 === 0) {
      const [x, y] = xy([(p[0] + q[0]) / 2, (lowP[1] + lowQ[1]) / 2]);
      ctx.fillStyle = C.dark; ctx.fillRect(x - 3, y - 13, 6, 11); ctx.fillRect(x - 2, y - 15, 4, 2);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(x - 4, y - 13, 1, 12); ctx.fillRect(x + 3, y - 13, 1, 12); ctx.fillRect(x - 3, y - 15, 6, 1);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 2, y - 16, 4, 1);
    }
    if (i % 8 === 0) {
      const [x, y] = xy(lowP);
      ctx.fillStyle = C.joint; ctx.fillRect(x - 3, y - 24, 6, 24);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(x - 2, y - 23, 3, 22);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 4, y - 25, 8, 3); ctx.fillRect(x - 4, y - 2, 8, 2);
    }
    for (let tier = 0; tier < 4; tier++) {
      const inner = tier / 4, out = (tier + 1) / 4;
      polygon(ctx, [ring(a, inner), ring(z, inner), ring(z, out), ring(a, out)], C.wood[tier]!, C.woodDark, "wood");
      // Green/teal seats, timber step risers and gold rails stay distinct at town zoom.
      polygon(ctx, [ring(a, out), ring(z, out), [ring(z, out)[0], ring(z, out)[1] + 3], [ring(a, out)[0], ring(a, out)[1] + 3]], tier % 2 ? C.teal : C.emerald);
      const [x, y] = xy(ring(mid, (tier + 0.62) / 4));
      ctx.fillStyle = tier % 2 ? C.teal : C.green; ctx.fillRect(x - 4, y - 2, 8, 3);
      ctx.fillStyle = tier === 3 ? C.goldLight : C.gold; ctx.fillRect(x - 4, y - 2, 8, 1);
      // Decorative spectators never enter the actual resident or reward counts.
      if ((i + tier) % 3 !== 0 && !(Math.sin(mid) < 0 && tier === 3)) for (let pose = 0; pose < 2; pose++) {
        const c = crowds[pose]!.getContext(), lift = pose && (i + tier) % 2 ? 2 : 0;
        c.fillStyle = [C.green, C.teal, C.gold, "#b46d48"][(i + tier) % 4]!;
        c.fillRect(x - 1, y - 3 - lift, 3, 3); c.fillStyle = "#d7bc8d"; c.fillRect(x, y - 5 - lift, 2, 2);
        if (lift) { c.fillRect(x - 2, y - 5, 1, 3); c.fillRect(x + 3, y - 5, 1, 3); }
      }
    }
    if (i % 8 === 4) {
      const [x, y] = xy(p); ctx.fillStyle = C.goldDark; ctx.fillRect(x - 7, y - 8, 15, 29);
      ctx.fillStyle = i % 16 ? C.emerald : C.teal; ctx.fillRect(x - 6, y - 7, 13, 26);
      ctx.fillStyle = C.goldLight; ctx.fillRect(x - 6, y - 7, 2, 24); ctx.fillRect(x + 5, y - 7, 2, 24); ctx.fillRect(x - 8, y - 9, 17, 2);
      ctx.fillStyle = C.mint; ctx.fillRect(x - 3, y, 2, 2); ctx.fillRect(x + 2, y, 2, 2);
      ctx.fillRect(x - 4, y - 3, 2, 7); ctx.fillRect(x + 3, y - 3, 2, 7);
      ctx.fillStyle = C.gold; ctx.fillRect(x - 5, y + 18, 4, 2); ctx.fillRect(x + 2, y + 18, 4, 2);
    }
  }
  // Covered rear galleries give the bowl the same tiled-roof silhouette as the town halls.
  const roofPoint = (a: number, t: number, lift: number): P => { const p = ring(a, t); return [p[0], p[1] - lift]; };
  for (let i = 50; i < 94; i++) {
    const a = i * STEP, z = a + STEP;
    polygon(b, [roofPoint(a, .67, 25), roofPoint(z, .67, 25), roofPoint(z, .88, 70), roofPoint(a, .88, 70)], i % 3 ? C.roof : C.roofLight, C.roofShade, "roof");
    polygon(b, [roofPoint(a, .88, 70), roofPoint(z, .88, 70), roofPoint(z, 1.04, 28), roofPoint(a, 1.04, 28)], C.roofShade, C.woodDark, "roof");
    for (const [t, lift] of [[.73, 38], [.8, 53], [.88, 70]] as const) {
      polygon(b, [roofPoint(a, t, lift), roofPoint(z, t, lift), roofPoint(z, t, lift - 2), roofPoint(a, t, lift - 2)], t === .88 ? C.goldLight : C.roofTile);
    }
    polygon(b, [roofPoint(a, .67, 25), roofPoint(z, .67, 25), roofPoint(z, .67, 20), roofPoint(a, .67, 20)], C.emerald, C.gold);
    if (i % 4 === 2) {
      const [x, y] = xy(ring(a, .67));
      b.fillStyle = C.woodDark; b.fillRect(x - 2, y - 12, 4, 14);
      b.fillStyle = C.gold; b.fillRect(x - 3, y - 12, 6, 2);
    }
  }
  /** Masonry stair towers and tiled gate turrets, rooted in the existing solid wall. */
  const tower = (ctx: CanvasRenderingContext2D, foot: P, height: number, width: number) => {
    const [x, y] = xy(foot), h = height / SCALE, w = width / SCALE;
    ctx.fillStyle = C.joint; ctx.fillRect(x - w / 2 - 1, y - h, w + 2, h);
    ctx.fillStyle = C.stone; ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = C.stoneLight; ctx.fillRect(x - w / 2, y - h + 1, 3, h - 1);
    ctx.fillStyle = C.stoneShade; ctx.fillRect(x + w / 2 - 4, y - h, 4, h);
    for (let row = 4; row < h; row += 6) {
      ctx.fillStyle = C.joint; ctx.fillRect(x - w / 2 + 3, y - h + row, w - 7, 1);
      ctx.fillRect(x - w / 2 + 4 + row % 3, y - h + row - 5, 1, 5);
    }
    ctx.fillStyle = C.emerald; ctx.fillRect(x - w / 2 - 2, y - h + 8, w + 4, 4);
    ctx.fillStyle = C.gold; ctx.fillRect(x - w / 2 - 2, y - h + 8, w + 4, 1);
    ctx.fillStyle = C.dark; ctx.fillRect(x - 3, y - h + 19, 6, 11); ctx.fillRect(x - 2, y - h + 17, 4, 2);
    ctx.fillStyle = C.goldLight; ctx.fillRect(x - 2, y - h + 19, 1, 9);
    // Stepped hip roof, ridge finial and timber eave; no smooth vector dome.
    const roofY = foot[1] - height;
    polygon(ctx, [[foot[0] - width / 2 - 6, roofY], [foot[0], roofY - 32], [foot[0] + width / 2 + 6, roofY], [foot[0] + width / 2, roofY + 6], [foot[0] - width / 2, roofY + 6]], C.roofShade, C.woodDark);
    polygon(ctx, [[foot[0] - width / 2 - 6, roofY], [foot[0], roofY - 32], [foot[0] + width / 3, roofY]], C.roofLight, C.roof);
    ctx.fillStyle = C.roofTile;
    for (let row = 0; row < 4; row++) ctx.fillRect(x - w / 2 + row * 2 - 2, y - h - row * 3, w - row * 4 + 4, 1);
    ctx.fillStyle = C.goldLight; ctx.fillRect(x - 1, y - h - 20, 2, 5);
    ctx.fillStyle = C.teal; ctx.fillRect(x + 1, y - h - 20, 8, 4);
  };
  for (const a of [Math.PI * 1.17, Math.PI * 1.83]) tower(b, outer(a, false), 100, 42);
  const gateY = O.y + O.ry;
  for (const side of [-1, 1]) {
    const [x, y] = xy([O.x + side * (ARENA_GATE_WIDTH / 2 + 8), gateY]);
    tower(f, [O.x + side * (ARENA_GATE_WIDTH / 2 + 12), gateY], 100, 28);
    f.fillStyle = C.emerald; f.fillRect(x - 5, y - 32, 10, 19);
    f.fillStyle = C.goldLight; f.fillRect(x - 5, y - 32, 1, 19); f.fillRect(x + 4, y - 32, 1, 19);
    f.fillStyle = C.mint; f.fillRect(x - 2, y - 26, 2, 2); f.fillRect(x + 1, y - 26, 2, 2);
  }
  const [gx, gy] = xy([O.x, gateY]);
  f.fillStyle = C.woodDark; f.fillRect(gx - 49, gy - 42, 98, 6);
  f.fillStyle = C.emerald; f.fillRect(gx - 50, gy - 49, 100, 9);
  f.fillStyle = C.gold; f.fillRect(gx - 50, gy - 50, 100, 2); f.fillRect(gx - 49, gy - 41, 98, 1);
  f.fillStyle = C.teal; f.fillRect(gx - 46, gy - 46, 92, 3);
  f.fillStyle = C.goldLight; f.fillRect(gx - 5, gy - 54, 10, 12);
  f.fillStyle = C.dark; f.fillRect(gx - 3, gy - 52, 6, 8);
  f.fillStyle = C.mint; f.fillRect(gx - 2, gy - 50, 1, 2); f.fillRect(gx + 1, gy - 50, 1, 2);
  for (const texture of [back, front, ...crowds]) texture.refresh();
}

export type ArenaHandle = { setCheering: (on: boolean) => void; setNight: (on: boolean) => void };
export function drawArena(scene: Phaser.Scene, still: boolean): ArenaHandle {
  const layer = (key: string, depth: number) => scene.add.image(LEFT, TOP, key).setOrigin(0).setScale(SCALE).setDepth(depth);
  layer("ac-oval-front", O.y + O.ry);
  const crowd = layer("ac-oval-crowd", O.y + O.ry + 1), cheer = layer("ac-oval-cheer", O.y + O.ry + 1).setVisible(false);
  scene.add.image(F.x, F.y, "ac-arena-emblem").setDisplaySize(144, 100).setAlpha(0.38).setDepth(groundDepth(-340));
  const plaza = scene.add.graphics().setDepth(groundDepth(-395));
  for (const [x, y, w, h] of [[1400, 1030, 300, 100], [1800, 775, 74, 90]] as const) {
    plaza.fillStyle(ROAD_COLOURS.paved.edge).fillEllipse(x, y, w, h);
    plaza.fillStyle(ROAD_COLOURS.paved.surface).fillEllipse(x, y, w - 10, h - 10);
    // Sparse inset cobbles keep this a village forecourt, not a rectangular sports plaza.
    for (let dy = -h / 2 + 12; dy < h / 2 - 8; dy += 12) for (let dx = -w / 2 + 12; dx < w / 2 - 8; dx += 16) {
      if ((dx / (w / 2 - 9)) ** 2 + (dy / (h / 2 - 9)) ** 2 > 1) continue;
      plaza.fillStyle(ROAD_COLOURS.paved.hi, .55).fillRect(x + dx, y + dy, 8, 4);
    }
  }
  // Emerald-and-gold stone inlays flank the open gathering/entrance corridor.
  for (const side of [-1, 1]) {
    const x = F.x + side * 115;
    plaza.fillStyle(0x116340, .8).fillRect(x - 10, 1027, 20, 8);
    plaza.fillStyle(0xd6a340).fillRect(x - 6, 1029, 12, 4);
  }
  let cheering = false, up = false;
  if (!still) scene.time.addEvent({ delay: 380, loop: true, callback: () => { up = cheering && !up; crowd.setVisible(!up); cheer.setVisible(up); } });
  const lit: Phaser.GameObjects.Image[] = [];
  for (const [i, x] of [1280, 1520, 1070, 1730].entries()) {
    const y = i < 2 ? 994 : 640, post = scene.add.graphics().setDepth(y);
    post.fillStyle(0xf4bd54, .12).fillEllipse(x, y, 56, 24);
    post.fillStyle(0x153c32).fillRect(x - 4, y - 30, 8, 30);
    post.fillStyle(0xd6a340).fillRect(x - 6, y - 33, 12, 5).fillRect(x - 5, y - 5, 10, 3);
    post.fillStyle(0xe47b27).fillRect(x - 4, y - 43, 8, 10);
    post.fillStyle(0xffc95e).fillRect(x - 2, y - 46, 4, 12);
    post.fillStyle(0xffedab).fillRect(x - 1, y - 40, 2, 6);
    if (scene.textures.exists("dress-solar-glow")) {
      const glow = scene.add.image(x, y - 39, "dress-solar-glow").setDisplaySize(92, 84).setAlpha(0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(9001).setVisible(false);
      lit.push(glow);
      if (!still) scene.tweens.add({ targets: glow, alpha: 0.58, duration: 310 + i * 53, yoyo: true, repeat: -1 });
    }
  }
  return { setCheering: (on) => { cheering = on && !still; }, setNight: (on) => lit.forEach((g) => g.setVisible(on)) };
}
