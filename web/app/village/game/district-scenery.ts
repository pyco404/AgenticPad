import { DISTRICT_PIECES } from "./district-pieces";
import type * as Phaser from "phaser";
import { DISTRICTS } from "./districts";
import { groundDepth } from "./depth";
import { standee } from "./billboard";
import { byRiver } from "./river";
import { nearRoad, RESERVED, SITES } from "./town";
import { byGardenPond } from "./gardens";
import type { Bounds } from "./dressing";

/** Seeded, low-resolution ground patches fade with pixel dithering, rather than artificial district borders. */
export function drawDistrictTerrain(scene: Phaser.Scene): void {
  for (const [index, d] of DISTRICTS.entries()) {
    if ((d.id === "launch" && !SITES.launchpad) || (d.id === "market" && !SITES.bazaar)) continue;
    const key = `district-floor-${d.id}`;
    if (!scene.textures.exists(key)) {
      const canvas = scene.textures.createCanvas(key, 192, 144)!;
      const ctx = canvas.getContext();
      let seed = 600 + index;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let y = 0; y < 144; y += 2) for (let x = 0; x < 192; x += 2) {
        const edge = ((x - 96) / 96) ** 2 + ((y - 72) / 72) ** 2;
        if (edge > 1 || random() > Math.min(1, (1 - edge) * 3)) continue;
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = d.colour;
        ctx.fillRect(x, y, 2, 2);
        if (random() < 0.07) {
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = d.terrain === "rock" || d.terrain === "stone" ? "#d1c9ad" : "#263c2d";
          ctx.fillRect(x, y, 2, 1);
        }
      }
      canvas.refresh();
    }
    scene.add.image(d.x, d.y, key).setDisplaySize(d.rx * 2, d.ry * 2).setDepth(groundDepth(-850));
  }
}

/** Reuse the existing pixel art for small neighbourhood clusters. Houses remain obstacles. */
export function drawDistrictProps(scene: Phaser.Scene): { solids: Bounds[]; placed: Bounds[] } {

  const solids: Bounds[] = [], placed: Bounds[] = [];
  for (const p of DISTRICT_PIECES) {
    if (!scene.textures.exists(p.key) || byRiver(p) || byGardenPond(p) || nearRoad(p, 50) || RESERVED.some((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1)) continue;
    if ((p.x < 200 && !SITES.bazaar) || (p.x > 2600 && !SITES.launchpad)) continue;
    const obj = scene.add.image(p.x, p.y, p.key).setOrigin(0.5, 1).setScale(p.scale).setDepth(p.y);
    const box = { x: p.x, y: p.y, width: obj.displayWidth, height: obj.displayHeight };
    placed.push(box);
    if (p.solid) solids.push(box);
    standee(obj, p.solid);
  }
  return { solids, placed };
}
