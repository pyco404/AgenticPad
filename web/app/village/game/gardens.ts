import type * as Phaser from "phaser";
import { nearRoad, ROADS, SITES, type Rect } from "./town";
import { CROSSROADS } from "./world";
import { SOLAR_LIGHTS } from "./dressing";
import { byRiver } from './river';

/** Hand tended gardens around the playable village; never inputs to a match. */
export const GARDEN_PONDS: Rect[] = [
  { x0: 890, y0: 1410, x1: 1040, y1: 1520 },
  { x0: 1780, y0: 1470, x1: 1950, y1: 1590 },
  { x0: 1500, y0: -80, x1: 1670, y1: 35 },
];
const inside = (p: { x: number; y: number }, b: Rect, margin = 0) =>
  p.x > b.x0 - margin && p.x < b.x1 + margin && p.y > b.y0 - margin && p.y < b.y1 + margin;
export const byGardenPond = (p: { x: number; y: number }) => GARDEN_PONDS.some((b) => inside(p, b, 42));

function random(seed: number): () => number {
  let n = seed;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

/** Small pixel textures, reused throughout the gardens instead of hundreds of graphics objects. */
function textures(scene: Phaser.Scene): void {
  for (const [i, petals] of ["#fff5da", "#f290b3", "#efc65a", "#bbc5ed"].entries()) {
    const key = `garden-flowers-${i}`;
    if (scene.textures.exists(key)) continue;
    const canvas = scene.textures.createCanvas(key, 32, 24)!;
    const c = canvas.getContext();
    const rand = random(80 + i);
    for (let k = 0; k < 6; k++) {
      const x = 3 + Math.floor(rand() * 25), y = 4 + Math.floor(rand() * 13);
      c.fillStyle = "#556c26"; c.fillRect(x, y + 3, 2, 5);
      c.fillStyle = "#78932b"; c.fillRect(x - 3, y + 5, 4, 2);
      c.fillStyle = "#3f6328"; c.fillRect(x + 1, y + 6, 3, 2);
      c.fillStyle = "#8c6750"; c.fillRect(x - 2, y - 1, 6, 6);
      c.fillStyle = petals;
      c.fillRect(x - 2, y, 6, 2); c.fillRect(x, y - 2, 2, 6);
      c.fillStyle = "#edbd52"; c.fillRect(x, y, 2, 2);
    }
    canvas.refresh();
  }
  if (!scene.textures.exists("garden-lantern")) {
    const canvas = scene.textures.createCanvas("garden-lantern", 16, 44)!;
    const c = canvas.getContext();
    const rect = (colour: string, x: number, y: number, w: number, h: number) => { c.fillStyle = colour; c.fillRect(x, y, w, h); };
    rect("#252e32", 3, 40, 10, 4); rect("#5c675f", 5, 39, 6, 2);
    rect("#253537", 6, 16, 4, 25); rect("#8b8b67", 7, 17, 1, 22);
    rect("#473e31", 2, 7, 12, 12); rect("#e8b45b", 4, 8, 8, 9);
    rect("#ffe8a5", 5, 9, 3, 7); rect("#fff5d0", 6, 9, 2, 5);
    rect("#343b38", 7, 8, 2, 10); rect("#8b703f", 2, 7, 12, 2);
    rect("#253537", 2, 5, 12, 2); rect("#5a6351", 4, 3, 8, 2);
    rect("#d5a64a", 6, 0, 4, 4); rect("#f1d17c", 7, 0, 2, 2);
    canvas.refresh();
  }
  if (!scene.textures.exists("garden-pond")) {
    const canvas = scene.textures.createCanvas("garden-pond", 96, 72)!;
    const c = canvas.getContext();
    const oval = (x: number, y: number, rx: number, ry: number, colour: string) => {
      c.fillStyle = colour; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    };
    oval(48, 39, 43, 28, "#627a2a"); oval(48, 37, 40, 25, "#685e43");
    oval(48, 36, 36, 23, "#327b83"); oval(48, 37, 32, 20, "#3e9eaa");
    const rand = random(117);
    for (let k = 0; k < 33; k++) {
      const x = 25 + Math.floor(rand() * 46), y = 23 + Math.floor(rand() * 28);
      c.fillStyle = k % 3 ? "#70c4c8" : "#287b8d"; c.fillRect(x, y, 3 + rand() * 5, 1);
    }
    for (let k = 0; k < 17; k++) {
      const a = k * Math.PI * 2 / 17;
      const x = 48 + Math.cos(a) * 38, y = 36 + Math.sin(a) * 25;
      oval(x, y + 2, 4 + k % 3, 4, "#615f51");
      oval(x, y, 4 + k % 3, 4, "#969588"); oval(x - 1, y - 2, 2, 1.5, "#c0bc9f");
    }
    for (const [x, y] of [[25, 39], [63, 46], [53, 24]]) {
      oval(x!, y!, 4, 2, "#779243"); c.fillStyle = "#f2b6cd"; c.fillRect(x!, y! - 2, 2, 2);
    }
    canvas.refresh();
  }
}

export function drawGardens(scene: Phaser.Scene, taken: Rect[]): void {
  textures(scene);
  const rand = random(20261005);
  // Scatter flowers in the verges and woodland openings, never across a road,
  // a building, the match floor, or a pond.
  for (let i = 0; i < 2400; i++) {
    const p = { x: 230 + rand() * 2310, y: -120 + rand() * 1990 };
    if (nearRoad(p, 15) || byRiver(p) || byGardenPond(p) || taken.some((b) => inside(p, b, 2))) continue;
    scene.add.image(Math.round(p.x), Math.round(p.y), `garden-flowers-${i % 4}`).setScale(1.15).setDepth(-390);
  }
  for (const b of GARDEN_PONDS) {
    scene.add.image((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, "garden-pond")
      .setDisplaySize(b.x1 - b.x0, b.y1 - b.y0).setDepth(-790);
  }
  // Low timber rails and benches divide the gardens into tended little
  // clearings without closing any of the walking routes.
  for (const [x, y, width] of [[660, 285, 120], [1850, 285, 145], [1050, 1380, 150], [1570, 1400, 160], [440, 1050, 85], [2270, 1060, 90]]) {
    if (nearRoad({ x: x! + width! / 2, y: y! }, 25) || byRiver({ x: x! + width! / 2, y: y! })) continue;
    const fence = scene.add.graphics().setDepth(y!);
    fence.fillStyle(0x473b2b).fillRect(x!, y! - 17, width!, 5).fillRect(x!, y! - 8, width!, 4);
    fence.fillStyle(0xc08b46).fillRect(x!, y! - 17, width!, 2).fillRect(x!, y! - 8, width!, 1);
    for (let dx = 0; dx <= width!; dx += 30) {
      fence.fillStyle(0x493525).fillRect(x! + dx - 2, y! - 23, 6, 26);
      fence.fillStyle(0xba8847).fillRect(x! + dx - 1, y! - 22, 3, 24);
      fence.fillStyle(0xe0b765).fillRect(x! + dx - 2, y! - 24, 6, 3);
    }
  }
  for (const [x, y] of [[1160, 235], [1550, 215], [1230, 1310], [1570, 1320], [770, 1400], [2040, 1420]]) {
    if (!nearRoad({ x: x!, y: y! }, 15) && !byRiver({ x: x!, y: y! }) && !taken.some((b) => inside({ x: x!, y: y! }, b)) && scene.textures.exists("ac-bench")) {
      scene.add.image(x!, y!, "ac-bench").setOrigin(0.5, 1).setScale(2).setDepth(y!);
    }
  }
  // Keep banners along the streets, but only a few widely separated lanterns.
  // Include the plaza's solar lights so the two styles never crowd each other.
  const used = new Set<string>();
  const lights = [...SOLAR_LIGHTS];
  for (const road of ROADS) {
    if (road.style === "trail" || road.style === "dirt") continue;
    for (let i = 1; i < road.points.length; i++) {
      const [ax, ay] = road.points[i - 1]!, [bx, by] = road.points[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let d = 65; d < len - 30; d += 145) {
        for (const side of [-1, 1]) {
          const x = ax + (bx - ax) * d / len + nx * side * (road.width / 2 + 13);
          const y = ay + (by - ay) * d / len + ny * side * (road.width / 2 + 13);
          if (x < 200 || x > 2600 || y < -180 || y > 1840 || byGardenPond({ x, y }) || byRiver({ x, y })) continue;
          if (Object.values(SITES).some((s) => Math.abs(x - s.x) < 110 && y < s.y && y > s.y - 230)) continue;
          const key = `${Math.round(x / 35)},${Math.round(y / 35)}`;
          if (used.has(key)) continue;
          used.add(key);
          if (Math.floor(d / 145) % 2 === 0 && side === 1 && scene.textures.exists("ac-banner")) {
            scene.add.image(x + nx * 31, y + ny * 31, "ac-banner").setOrigin(0.5, 1).setScale(1.3).setDepth(y + ny * 31);
          }
          if (lights.length >= 10 || lights.some((p) => Math.hypot(x - p.x, y - p.y) < 500)) continue;
          lights.push({ x, y });
          scene.add.image(x, y, "garden-lantern").setOrigin(0.5, 1).setScale(1.35).setDepth(y);
        }
      }
    }
  }
  // Flower wreaths and crests make each ring junction a landmark.
  for (const p of CROSSROADS) {
    const bed = scene.add.graphics().setDepth(-398);
    bed.fillStyle(0x6f7056).fillCircle(p.x, p.y, 29);
    bed.fillStyle(0xd1c6a4).fillCircle(p.x, p.y, 27);
    bed.fillStyle(0x6d8a35).fillCircle(p.x, p.y, 23);
    for (let k = 0; k < 9; k++) {
      const a = k * Math.PI * 2 / 9;
      scene.add.image(p.x + Math.cos(a) * 19, p.y + Math.sin(a) * 19, `garden-flowers-${k % 3}`).setScale(0.5).setDepth(-397);
    }
    if (scene.textures.exists("ac-banner")) scene.add.image(p.x, p.y + 8, "ac-banner").setOrigin(0.5, 1).setScale(1.2).setDepth(p.y + 8);
  }
  // Decorative stonework around the fountain, clear of the north/south route.
  const plaza = scene.add.graphics().setDepth(-398);
  for (let r = 48; r < 144; r += 16) {
    plaza.lineStyle(1.5, 0x918879, 0.75).strokeEllipse(1400, 1160, r * 2, r * 0.72);
  }
}
