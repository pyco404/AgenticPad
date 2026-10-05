import * as Phaser from "phaser";
import { SITES } from "./town";

/**
 * The arena's layers over its picture (the building, drawn under everyone):
 * its front wall, drawn over the agents fighting on the sand so they stand
 * inside it; its crowd, on its feet and cheering while a match is on; and its
 * torches, lit at night. The art is scripts/village-art.ts's.
 */

const ART = "/village/agenticpad";
/** The arena's picture in art pixels, drawn at two world pixels to one. */
const W = 330;
const H = 230;

export function loadArena(scene: Phaser.Scene): void {
  for (const name of ["arena-front", "arena-crowd", "arena-cheer"]) {
    if (!scene.textures.exists(`ac-${name}`)) scene.load.image(`ac-${name}`, `${ART}/${name}.png`);
  }
  scene.load.json("ac-arena-torches", `${ART}/arena-torches.json`);
}

export type ArenaHandle = { setCheering: (on: boolean) => void; setNight: (on: boolean) => void };

export function drawArena(scene: Phaser.Scene, still: boolean): ArenaHandle {
  const site = SITES.arena!;
  const left = site.x - (W * site.scale) / 2;
  const top = site.y - H * site.scale;
  const layer = (key: string, depth: number) =>
    scene.add.image(left, top, key).setOrigin(0, 0).setScale(site.scale).setDepth(depth);

  // The front wall stands at the arena's foot: in front of everyone on the sand, behind anyone passing outside.
  if (scene.textures.exists("ac-arena-front")) layer("ac-arena-front", site.y);
  const crowd = scene.textures.exists("ac-arena-crowd") ? layer("ac-arena-crowd", (site.depth ?? 0) + 1) : null;
  const cheer = scene.textures.exists("ac-arena-cheer") ? layer("ac-arena-cheer", (site.depth ?? 0) + 1).setVisible(false) : null;

  // On its feet in turns: the cheering crowd and the seated one, swapped while a match plays.
  let cheering = false;
  let up = false;
  if (!still && crowd && cheer) {
    scene.time.addEvent({
      delay: 380,
      loop: true,
      callback: () => {
        up = cheering && !up;
        cheer.setVisible(up);
        crowd.setVisible(!up);
      },
    });
  }

  // Torches: a flicker of light at each, over the night's blue like the solar lights.
  const torches = (scene.cache.json.get("ac-arena-torches") as { x: number; y: number }[] | undefined) ?? [];
  const lit: Phaser.GameObjects.Image[] = [];
  for (const [i, t] of torches.entries()) {
    const x = left + t.x * site.scale;
    const y = top + t.y * site.scale;
    const glow = scene.add.image(x, y, "dress-solar-glow").setDisplaySize(70, 70).setAlpha(0.75);
    glow.setDepth(9_001).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    lit.push(glow);
    if (!still) scene.tweens.add({ targets: glow, alpha: 0.5, duration: 260 + i * 47, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  return {
    setCheering: (on) => {
      cheering = on && !still;
    },
    setNight: (on) => lit.forEach((g) => g.setVisible(on)),
  };
}
