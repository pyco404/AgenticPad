// Adapted from Agent Quest (MIT, see ./LICENSE).
import type * as Phaser from "phaser";
import { crispText, SANS } from "./text";
import type { Site } from "./town";

/**
 * How much of each picture is clear sky above the roof, as a share of its
 * height, so the name sits on the roof rather than floating over the space.
 */
const CLEAR_ABOVE: Record<string, number> = {
  library: 0.21,
  alchemist: 0.13,
  forge: 0.12,
  tavern: 0.11,
  watchtower: 0.06,
};

export type BuildingLabel = { id: string; label: string; note: string };

/** A building: its picture, its name and a line under it, and a door agents gather in front of. */
export class Building {
  readonly door: { x: number; y: number };
  /** Where it stands, bottom-centre, and how big it is drawn: the ground under it is solid. */
  readonly footprint: { x: number; y: number; width: number; height: number };
  private note: Phaser.GameObjects.Text;
  /** The name and its line, together, so they can be scaled as one about the roof. */
  private label: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    def: BuildingLabel,
    site: Site,
    onClick: () => void,
    /** The face for the building's name: the HUD's pixel lettering, once the page has it. */
    nameFont: string,
    /** Reduced motion: a building that animates holds its first frame. */
    still: boolean,
  ) {
    // Bottom-centre, as the plan places it.
    const key = `building-${def.id}`;
    const image = scene.add.sprite(site.x, site.y, key, 0).setOrigin(0.5, 1).setScale(site.scale);
    if (site.sheet && !still) {
      const anim = `${key}:loop`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(key, {}), frameRate: site.sheet.frameRate, repeat: -1 });
      }
      image.play(anim);
    }
    image.setInteractive({ useHandCursor: true, pixelPerfect: def.id === "arena", alphaTolerance: 1 });
    image.on("pointerup", onClick);
    image.on("pointerover", () => image.setTint(0xdddddd));
    image.on("pointerout", () => image.clearTint());

    this.door = site.door ?? { x: site.x, y: site.y + 5 };
    this.footprint = { x: site.x, y: site.y, width: image.displayWidth, height: image.displayHeight };
    image.setDepth(site.depth ?? this.door.y);

    // Name, then its line, both clear above the roof, and above the trees, the night and the walkers.
    const clearAbove = site.art.includes("/modern-") ? 0.03 : (CLEAR_ABOVE[def.id] ?? 0);
    const top = site.labelY ?? site.y - image.displayHeight * (1 - clearAbove) - 2;
    const name = crispText(scene, 0, -16, def.label, {
      fontSize: "20px",
      fontStyle: "700",
      fontFamily: "Georgia, serif",
      color: "#f5ecd8",
      stroke: "#000000",
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 2, color: "#000", blur: 0, fill: true },
    }).setOrigin(0.5, 1);
    this.note = crispText(scene, 0, 0, def.note, {
      fontSize: "12px",
      fontFamily: SANS,
      color: "#ede6d6",
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    // Above agents' names too (hero.ts puts those at 10,000 and up): the map's own labels always read.
    const width = Math.ceil(name.width) + 26;
    const sign = scene.add.graphics();
    sign.fillStyle(0x171e18, 0.96).fillRoundedRect(-width / 2, -48, width, 35, 3);
    sign.lineStyle(2, 0xc49a49, 1).strokeRoundedRect(-width / 2, -48, width, 35, 3);
    sign.lineStyle(1, 0x6d603b, 1).strokeRect(-width / 2 + 4, -44, width - 8, 27);
    for (const x of [-width / 2 + 3, width / 2 - 5]) {
      sign.fillStyle(0xf0d18b, 1).fillRect(x, -45, 2, 2).fillRect(x, -19, 2, 2);
    }
    this.label = scene.add.container(site.x, top, [sign, name, this.note]).setDepth(30_000 + this.door.y / 10);
  }

  /** Where its name and line sit, in world pixels: no agent's name goes over them (labels.ts). */
  labelBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const b = this.label.getBounds();
    return { x0: b.x, y0: b.y, x1: b.right, y1: b.bottom };
  }

  setLabelScale(scale: number): void {
    this.label.setScale(scale);
  }

  setNote(text: string, colour: string): void {
    if (this.note.text !== text) this.note.setText(text);
    this.note.setColor(colour);
  }
}
