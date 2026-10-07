import { groundDepth } from "./depth";
import type * as Phaser from "phaser";
import { MOUNTAINS, OCEAN, OCEAN_BOX, ROUGH_SEA, ROUGH_SEA_BOX, roughWavePosition, seaAnimalPosition } from "./landscape";
import { riverTerrain, RIVER_SHORES } from "./river";

/** Code-drawn pixel art uses a handful of reusable textures, with no downloads. */
function textures(scene: Phaser.Scene): void {
  const animals: Record<string, string[]> = {
    fish: ["...........aa.....", "..........abba....", ".aa...bbbbbbbbb...", ".aba.bccccccccbbb.", "..abccccccccccceb", ".aba.bccccccccbbb.", ".aa...bbbbbbbbb...", "..........abba....", "...........aa....."],
    turtle: ["........aa.........", "...bb..acca..bb....", "..bccbbbbbbbbccb...", "...bbbcddddcbbb....", "...bbcdccccdcbbaaa.", "aaabbcdccccdcbbcea.", "...bbcdccccdcbb.aaa", "...bbbcddddcbbb....", "..bccbbbbbbbbccb...", "...bb........bb...."],
    ray: [".........a.........", "........aba........", ".......abbba.......", ".....abbbbbba......", "...abbbccbbbba.....", ".abbbbccccbbbbaaa..", "abbbbbceccbbbbbbaaa", ".abbbbccccbbbbaaa..", "...abbbccbbbba.....", ".....abbbbbba......", ".......abbba.......", "........aba........", ".........a........."],
  };
  const palettes: Record<string, Record<string, string>> = {
    fish: { a: "#94642b", b: "#e9a84b", c: "#f8d879", e: "#173b48" },
    turtle: { a: "#305b48", b: "#43744c", c: "#85a85d", d: "#355d3a", e: "#142f32" },
    ray: { a: "#23465d", b: "#386c81", c: "#72a6b0", e: "#142c3f" },
  };
  for (const [name, rows] of Object.entries(animals)) {
    const key = `sea-${name}`;
    if (scene.textures.exists(key)) continue;
    const canvas = scene.textures.createCanvas(key, Math.max(...rows.map((r) => r.length)), rows.length)!;
    const c = canvas.getContext();
    rows.forEach((row, y) => [...row].forEach((pixel, x) => {
      const colour = palettes[name]![pixel];
      if (colour) { c.fillStyle = colour; c.fillRect(x, y, 1, 1); }
    }));
    canvas.refresh();
  }
  if (!scene.textures.exists("sea-wave")) {
    const canvas = scene.textures.createCanvas("sea-wave", 32, 8)!;
    const c = canvas.getContext(); c.fillStyle = "#91d7d4";
    c.fillRect(1, 4, 8, 1); c.fillRect(9, 3, 8, 1); c.fillRect(17, 4, 8, 1); c.fillRect(25, 5, 6, 1);
    canvas.refresh();
  }
  if (!scene.textures.exists("wild-mountain")) {
    const canvas = scene.textures.createCanvas("wild-mountain", 160, 160)!;
    const c = canvas.getContext();
    const polygon = (colour: string, points: number[][]) => {
      c.fillStyle = colour; c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)); c.closePath(); c.fill();
    };
    // Layered foothills, a shaded rock face, broken ridges and snow at the summit.
    polygon("#495b4b", [[0, 157], [20, 126], [49, 119], [79, 123], [115, 127], [145, 142], [160, 157]]);
    polygon("#39434d", [[8, 151], [38, 85], [56, 65], [74, 10], [84, 7], [101, 59], [121, 83], [151, 151]]);
    polygon("#6d797c", [[8, 151], [38, 85], [56, 65], [74, 10], [84, 7], [73, 68], [58, 105], [64, 151]]);
    polygon("#52646c", [[84, 7], [101, 59], [121, 83], [151, 151], [100, 151], [90, 99], [97, 75]]);
    polygon("#919c95", [[38, 85], [56, 65], [74, 10], [66, 73], [50, 101], [28, 125]]);
    polygon("#d8e2d5", [[56, 65], [74, 10], [84, 7], [98, 50], [89, 44], [82, 57], [75, 43], [68, 62], [64, 53]]);
    polygon("#a8c6c8", [[84, 7], [98, 50], [89, 44], [82, 57], [80, 36]]);
    polygon("#2c3c46", [[79, 64], [84, 97], [77, 117], [84, 149], [68, 148], [73, 110]]);
    for (let i = 0; i < 60; i++) {
      const y = 83 + (i * 17 % 61), x = 42 + (i * 29 % 68);
      c.fillStyle = i % 2 ? "#74817f" : "#46535b"; c.fillRect(x, y, 2 + i % 4, 1);
    }
    canvas.refresh();
  }
}

export function drawScenery(scene: Phaser.Scene, still: boolean): void {
  textures(scene);
  const terrain = riverTerrain();
  const shore = new Set(terrain.filter(([, , texture]) => texture !== "terrain-water").map(([c, r]) => `${c},${r}`));
  const deep = scene.add.graphics().setDepth(groundDepth(-780));
  const maskShape = scene.add.graphics().setVisible(false);
  maskShape.fillStyle(0xffffff);
  for (const [c, r, texture] of terrain) {
    if (texture !== "terrain-water" || shore.has(`${c},${r}`) || c * 64 < ROUGH_SEA_BOX.x0 || c * 64 > ROUGH_SEA_BOX.x1 || r * 64 < ROUGH_SEA_BOX.y0 || r * 64 > ROUGH_SEA_BOX.y1) continue;
    const radius = ((c * 64 + 32 - ROUGH_SEA.x) / ROUGH_SEA.rx) ** 2 + ((r * 64 + 32 - ROUGH_SEA.y) / ROUGH_SEA.ry) ** 2;
    deep.fillStyle(0x246984, Math.max(0, .78 * (1 - radius * .7))).fillRect(c * 64, r * 64, 64, 64);
    maskShape.fillRect(c * 64, r * 64, 64, 64);
  }
  const seaMask = maskShape.createGeometryMask();
  scene.events.once("shutdown", () => seaMask.destroy());
  const currents = Array.from({ length: 96 }, (_, i) => {
    const at = roughWavePosition(i, 0);
    return scene.add.image(at.x, at.y, "sea-wave").setScale(2 + i % 3).setTint(i % 3 ? 0xffffff : 0x68b8ce).setAlpha(0.7).setDepth(groundDepth(-720)).setMask(seaMask);
  });
  const surfEdges = RIVER_SHORES.filter((p) => p.x >= ROUGH_SEA_BOX.x0 && p.x <= ROUGH_SEA_BOX.x1 && p.y >= ROUGH_SEA_BOX.y0 && p.y <= ROUGH_SEA_BOX.y1).filter((_, i) => i % 3 === 0);
  const surf = surfEdges.map((edge, i) => {
    // Short foam strokes follow actual banks, leaving the lake/river mouth open.
    return scene.add.image(edge.x - edge.dx * 12, edge.y - edge.dy * 12, "sea-wave").setScale(1.3 + i % 3 * .2).setRotation(edge.dx ? Math.PI / 2 : 0).setAlpha(0.35).setDepth(groundDepth(-710)).setMask(seaMask);
  });
  for (const m of MOUNTAINS) scene.add.image(m.x, m.y, "wild-mountain").setOrigin(0.5, 1).setDisplaySize(m.width, m.height).setDepth(m.y);
  const animals = Array.from({ length: 9 }, (_, i) => {
    const at = seaAnimalPosition(i, 0);
    return scene.add.image(at.x, at.y, `sea-${["fish", "turtle", "ray"][i % 3]}`).setScale(i % 3 === 2 ? 3 : 2.5).setRotation(at.heading).setDepth(groundDepth(-700));
  });
  const waves = Array.from({ length: 28 }, (_, i) => {
    const a = i * 2.4, radius = 0.2 + (i % 5) * 0.14;
    return scene.add.image(OCEAN.x + Math.cos(a) * OCEAN.rx * radius, OCEAN.y + Math.sin(a) * OCEAN.ry * radius, "sea-wave").setScale(2).setAlpha(0.45).setDepth(groundDepth(-690));
  });
  if (still) return;
  let seconds = 0;
  const update = (_time: number, delta: number) => {
    const view = scene.cameras.main.worldView;
    const oceanVisible = !(view.right < OCEAN_BOX.x0 || view.left > OCEAN_BOX.x1 || view.bottom < OCEAN_BOX.y0 || view.top > OCEAN_BOX.y1);
    const roughVisible = !(view.right < ROUGH_SEA_BOX.x0 || view.left > ROUGH_SEA_BOX.x1 || view.bottom < ROUGH_SEA_BOX.y0 || view.top > ROUGH_SEA_BOX.y1);
    if (!oceanVisible && !roughVisible) return;
    seconds += Math.min(delta, 100) / 1000;
    if (oceanVisible) animals.forEach((animal, i) => {
      const at = seaAnimalPosition(i, seconds);
      animal.setPosition(at.x, at.y).setRotation(at.heading);
    });
    if (oceanVisible) waves.forEach((wave, i) => wave.setAlpha(0.25 + (Math.sin(seconds * 0.8 + i) + 1) * 0.2));
    if (roughVisible) {
      currents.forEach((wave, i) => {
        const at = roughWavePosition(i, seconds);
        wave.setPosition(at.x, at.y).setAlpha(0.35 + (Math.sin(seconds * 2 + i) + 1) * 0.3);
      });
      surf.forEach((wave, i) => {
        const edge = surfEdges[i]!, tide = 12 + Math.sin(seconds * 1.6 + i * .3) * 3;
        wave.setPosition(edge.x - edge.dx * tide, edge.y - edge.dy * tide).setAlpha(.2 + (Math.sin(seconds * 1.6 + i * .3) + 1) * .15);
      });
    }
  };
  scene.events.on("update", update);
  scene.events.once("shutdown", () => scene.events.off("update", update));
}
