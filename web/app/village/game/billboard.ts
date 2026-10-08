import type * as Phaser from "phaser";
import { FLOOR_RATIO } from "./presentation";
import { groundDepth } from "./depth";

type Picture = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/** A shared, stepped pixel shadow; nearest-neighbour filtering comes from the game config. */
export function groundShadow(scene: Phaser.Scene, x: number, y: number, width: number, height: number): Phaser.GameObjects.Image {
  const key = "world-pixel-shadow";
  if (!scene.textures.exists(key)) {
    const canvas = scene.textures.createCanvas(key, 32, 16)!;
    const ctx = canvas.getContext();
    ctx.fillStyle = "#17251e";
    for (let row = 1; row < 15; row++) {
      const span = Math.floor(15 * Math.sqrt(1 - ((row - 8) / 8) ** 2));
      ctx.fillRect(16 - span, row, span * 2, 1);
    }
    canvas.refresh();
  }
  return scene.add.image(x + width * 0.16, y + height * 0.12, key)
    .setDisplaySize(width, height).setAlpha(0.24).setDepth(groundDepth(-360));
}

/** Keep the art upright over the compressed ground, anchored to its original foot. */
export function standee<T extends Picture>(obj: T, shadow = true): T {
  const width = obj.displayWidth, height = obj.displayHeight;
  const foot = obj.y + height * (1 - obj.originY);
  if (shadow) {
    const shade = groundShadow(obj.scene, obj.x, foot, width * 0.85, Math.min(70, height * 0.26));
    obj.setData("groundShadow", shade);
    obj.once("destroy", () => shade.destroy());
  }
  obj.y = foot + (obj.y - foot) / FLOOR_RATIO;
  obj.scaleY /= FLOOR_RATIO;
  obj.setData("standee", true);
  return obj;
}

export function standingVisible(obj: Picture, visible: boolean): void {
  obj.setVisible(visible);
  (obj.getData("groundShadow") as Phaser.GameObjects.Image | undefined)?.setVisible(visible);
}
