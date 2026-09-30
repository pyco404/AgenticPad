// Adapted from Agent Quest (MIT, see ./LICENSE).
import type * as Phaser from "phaser";
import { crispText, SANS } from "./text";

/** How big each building is drawn, against its own image. */
const SCALE: Record<string, number> = {
  castle: 0.45,
  library: 0.4,
  forge: 0.4,
  tavern: 0.4,
  chapel: 0.35,
  watchtower: 0.35,
  arena: 0.35,
  alchemist: 0.35,
};

/**
 * How much of each picture is clear sky above the roof, as a share of its
 * height, so the name sits on the roof rather than floating over the space.
 */
const CLEAR_ABOVE: Record<string, number> = {
  library: 0.21,
  alchemist: 0.13,
  arena: 0.12,
  tavern: 0.11,
  watchtower: 0.06,
};
/**
 * Names set down onto their own roof, in world pixels. The Treasury stands
 * between the Rulebook House and the Arena: the Rulebook House's name, over
 * its roof, would sit on the Treasury's doorstep and read as the Treasury's,
 * and the Treasury's own would sit among the Arena's scores.
 */
const ON_ROOF: Record<string, number> = { alchemist: 34, chapel: 40 };

export type BuildingLabel = {
  id: string;
  label: string;
  note: string;
  /** For a place the map does not have: where it stands, its picture, and how big it is drawn. */
  at?: { x: number; y: number };
  image?: string;
  scale?: number;
};

/** A building: its image, its name and a line under it, and a door agents gather in front of. */
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
    at: { x: number; y: number },
    onClick: () => void,
    /** The face for the building's name: the HUD's pixel lettering, once the page has it. */
    nameFont: string,
  ) {
    // Bottom-centre, as the map places it.
    const image = scene.add.image(at.x, at.y, `building-${def.id}`).setOrigin(0.5, 1).setScale(def.scale ?? SCALE[def.id] ?? 0.4);
    image.setInteractive({ useHandCursor: true });
    image.on("pointerup", onClick);
    image.on("pointerover", () => image.setTint(0xdddddd));
    image.on("pointerout", () => image.clearTint());

    this.door = { x: at.x, y: at.y + 5 };
    this.footprint = { x: at.x, y: at.y, width: image.displayWidth, height: image.displayHeight };
    image.setDepth(this.door.y);

    // Name, then its line, both clear above the roof, and above the trees, the night and the walkers.
    const top = at.y - image.displayHeight * (1 - (CLEAR_ABOVE[def.id] ?? 0)) - 2 + (ON_ROOF[def.id] ?? 0);
    const name = crispText(scene, 0, -16, def.label, {
      fontSize: "20px",
      fontStyle: "700",
      fontFamily: nameFont,
      color: "#f5ecd8",
      stroke: "#000000",
      strokeThickness: 4,
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
    this.label = scene.add.container(at.x, top, [name, this.note]).setDepth(30_000 + this.door.y / 10);
  }

  setLabelScale(scale: number): void {
    this.label.setScale(scale);
  }

  setNote(text: string, colour: string): void {
    if (this.note.text !== text) this.note.setText(text);
    this.note.setColor(colour);
  }
}
