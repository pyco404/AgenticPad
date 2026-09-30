// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import type { Look } from "../residents";
import type { Point } from "./roads";
import { crispText, MONO } from "./text";
import { sound } from "@/lib/sound";

/** The points to walk from one place to another, starting where the walker stands. */
export type Router = (from: Point, to: Point) => Point[];

/** Walking speed in world pixels a second: an unhurried pace, so the village is easy to follow. */
const SPEED = 95;
/** Ground covered by one run cycle, so the legs keep pace with the walk. */
const STRIDE = 60;
const HALO = "hero-halo";
/** Where the water comes to on a swimmer, in the sheet's own 192-pixel frame: chest-high, so head and shoulders show. */
const WATERLINE = 108;
const FRAME = 192;

/**
 * Frames in each unit's sheet: one row per animation, 192 px frames. The
 * archer has no walk cycle in the pack, so it runs on its second idle row
 * rather than on a row that fires arrows.
 */
const FRAMES: Record<Look["unit"], { idle: number[]; run: number[]; strike: number[] }> = {
  // The first attack row: a sword swing, a tool swung like one, a close-range shot.
  warrior: { idle: [0, 1, 2, 3, 4, 5], run: [6, 7, 8, 9, 10, 11], strike: [12, 13, 14, 15, 16, 17] },
  archer: { idle: [0, 1, 2, 3, 4, 5], run: [8, 9, 10, 11, 12, 13], strike: [16, 17, 18, 19, 20, 21] },
  pawn: { idle: [0, 1, 2, 3, 4, 5], run: [6, 7, 8, 9, 10, 11], strike: [12, 13, 14, 15, 16, 17] },
};

export const heroTexture = (look: Look) => `hero-${look.unit}-${look.colour}`;

function ensureAnims(scene: Phaser.Scene, look: Look): { idle: string; run: string; strike: string } {
  const texture = heroTexture(look);
  const frames = FRAMES[look.unit];
  const idle = `${texture}:idle`;
  const run = `${texture}:run`;
  const strike = `${texture}:strike`;
  if (!scene.anims.exists(strike)) {
    scene.anims.create({ key: strike, frames: scene.anims.generateFrameNumbers(texture, { frames: frames.strike }), frameRate: 16, repeat: 0 });
  }
  if (!scene.anims.exists(idle)) {
    scene.anims.create({ key: idle, frames: scene.anims.generateFrameNumbers(texture, { frames: frames.idle }), frameRate: 8, repeat: -1 });
  }
  if (!scene.anims.exists(run)) {
    scene.anims.create({
      key: run,
      frames: scene.anims.generateFrameNumbers(texture, { frames: frames.run }),
      frameRate: frames.run.length * (SPEED / STRIDE),
      repeat: -1,
    });
  }
  return { idle, run, strike };
}

/** A soft white disc, drawn once and shared, pulsing behind whoever is selected. */
function ensureHalo(scene: Phaser.Scene): void {
  if (scene.textures.exists(HALO)) return;
  const size = 128;
  const tex = scene.textures.createCanvas(HALO, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  g.addColorStop(0.35, "rgba(255, 255, 255, 0.45)");
  g.addColorStop(0.7, "rgba(255, 255, 255, 0.12)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export type HeroOptions = {
  /** Always shows its name. House agents show theirs only on hover or when selected, so the halls stay legible. */
  named: boolean;
  nameColour: string;
  /** Reduced motion: arrive rather than walk. */
  still: boolean;
  onClick: () => void;
  /** Whether a point is open water: standing in it, the hero swims. */
  inWater?: (p: Point) => boolean;
};

/** How big an agent's character stands, in world pixels: about a knight's height. */
const BODY = 34;
/** How high a step lifts it, and how far it rocks, as it walks. */
const HOP = 3;
const SWAY = 0.07;
/** How much of the character stays above the water while it swims. */
const ABOVE_WATER = 0.62;
/** Its legs, in world pixels: how long, how thick, how far apart, and how high a stride lifts a foot. */
const LEG = 9;
const LEG_W = 5;
const LEG_GAP = 4;
const LIFT = 4;
const LEG_COLOUR = 0x3a3142;
const BOOT_COLOUR = 0x1b1620;

/**
 * One agent in the village: its own character - the portrait it has on its
 * pages, as pixel art - walking, fighting and swimming, with its name over it.
 * The knight sheet still runs underneath, unseen: it holds the hit area and
 * stands in only for an agent that has no portrait.
 */
export class Hero {
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private anims: { idle: string; run: string; strike: string };
  /** How far a lunge has thrown the hero off its spot, in pixels. */
  lungeX = 0;
  private lungeTween: Phaser.Tweens.Tween | null = null;
  private halo: Phaser.GameObjects.Image | null = null;
  private haloTween: Phaser.Tweens.Tween | null = null;
  private walk: Phaser.Tweens.Tween | null = null;
  private hovered = false;
  private selected = false;
  /** On the way somewhere, or out on a stroll: then its name shows, as it does for players' agents always. */
  private walking = false;
  private roaming = false;
  /** The signed-in owner's own agent: a gold marker over it, and its name always shown in gold. */
  private mine = false;
  private marker: Phaser.GameObjects.Text | null = null;
  private markerTween: Phaser.Tweens.Tween | null = null;
  /** How far the marker has bobbed, in pixels. */
  markerBob = 0;
  private labelOffset: number;
  /** The agent's character: its portrait, as pixel art, standing where a knight would. */
  private portrait: Phaser.GameObjects.Image | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  /** Two legs under the character, redrawn as it steps. */
  private legs: Phaser.GameObjects.Graphics | null = null;
  /** Where the character's feet are, below the sprite's middle: the knight sheet pads each figure well inside its frame. */
  private footOffset: number;
  /** When this walk began, for the rhythm of its steps. */
  private stepFrom = 0;
  /** In the water: cut off at the chest, bobbing, with a ripple round it. */
  private swimming = false;
  private ripple: Phaser.GameObjects.Ellipse | null = null;
  private bobTween: Phaser.Tweens.Tween | null = null;
  /** How far the bob has lifted or dropped the swimmer, in pixels. */
  bob = 0;
  x: number;
  y: number;

  constructor(
    private scene: Phaser.Scene,
    private router: Router,
    look: Look,
    name: string,
    at: Point,
    private scale: number,
    private opts: HeroOptions,
  ) {
    this.x = at.x;
    this.y = at.y;
    this.anims = ensureAnims(scene, look);
    this.sprite = scene.add.sprite(at.x, at.y, heroTexture(look)).setScale(scale).play(this.anims.idle);
    // Unseen until it turns out there is no portrait for this agent.
    this.sprite.setVisible(false);
    this.clickable(this.sprite);

    // The sheets pad each figure generously, so the name sits well inside the frame.
    this.labelOffset = -this.sprite.displayHeight * 0.3;
    this.footOffset = this.sprite.displayHeight * 0.17;
    this.label = crispText(scene, at.x, at.y + this.labelOffset, name, {
      fontSize: "12px",
      fontFamily: MONO,
      color: opts.nameColour,
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.refreshLabel();
    this.place();
  }

  /** Keeps the name a readable size on screen as the camera zooms out; 1 at the village's own scale. */
  setLabelScale(scale: number): void {
    this.label.setScale(scale);
    this.marker?.setScale(scale);
    this.place();
  }

  /** Whichever the agent is drawn as answers the pointer: its name on hover, its page on a click. */
  private clickable(target: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    target.setInteractive({ useHandCursor: true, pixelPerfect: false });
    target.on("pointerup", () => this.opts.onClick());
    target.on("pointerover", () => {
      this.hovered = true;
      this.refreshLabel();
    });
    target.on("pointerout", () => {
      this.hovered = false;
      this.refreshLabel();
    });
  }

  /** The agent becomes its character, once its portrait is made into a texture. */
  setFace(texture: string): void {
    if (this.portrait) return;
    this.sprite.setVisible(false);
    this.portrait = this.scene.add.image(this.x, this.y, texture).setOrigin(0.5, 1).setDisplaySize(BODY, BODY);
    this.portrait.setFlipX(this.sprite.flipX);
    this.clickable(this.portrait);
    this.shadow = this.scene.add.ellipse(this.x, this.y, BODY * 0.8, BODY * 0.22, 0x000000, 0.28);
    this.legs = this.scene.add.graphics();
    if (this.swimming) this.cropForWater(true);
    this.place();
  }

  /** No portrait to be had: the knight it has always been, then. */
  useSprite(): void {
    if (!this.portrait) this.sprite.setVisible(true);
  }

  private cropForWater(on: boolean): void {
    const p = this.portrait;
    if (!p) return;
    if (on) p.setCrop(0, 0, p.frame.width, p.frame.height * ABOVE_WATER);
    else p.setCrop();
    this.shadow?.setVisible(!on);
    this.legs?.setVisible(!on);
  }

  /**
   * Both legs from the body down to the ground at (x, ground): side by side
   * when standing, taking turns to lift as it walks, each with a dark boot.
   */
  private drawLegs(x: number, ground: number, phase: number): void {
    const g = this.legs;
    if (!g) return;
    g.clear();
    const top = Math.round(ground - LEG);
    for (const [side, lift] of [[-1, Math.max(0, Math.sin(phase))], [1, Math.max(0, -Math.sin(phase))]] as const) {
      const left = Math.round(x + side * (LEG_GAP / 2 + LEG_W / 2) - LEG_W / 2);
      const up = Math.round(lift * LIFT);
      // A lifted leg is shorter, its boot off the ground and a little forward.
      const forward = this.portrait?.flipX ? -Math.round(lift * 2) : Math.round(lift * 2);
      g.fillStyle(LEG_COLOUR, 1).fillRect(left, top, LEG_W, LEG - up - 2);
      g.fillStyle(BOOT_COLOUR, 1).fillRect(left + forward - (this.portrait?.flipX ? 1 : 0), top + LEG - up - 3, LEG_W + 1, 3);
    }
  }

  /** Marks this as the signed-in owner's agent, or clears the mark. */
  setMine(on: boolean): void {
    if (on === this.mine) return;
    this.mine = on;
    this.markerTween?.stop();
    this.markerTween = null;
    this.marker?.destroy();
    this.marker = null;
    this.markerBob = 0;
    if (on) {
      this.marker = crispText(this.scene, this.x, this.y, "▼", {
        fontSize: "16px",
        fontFamily: MONO,
        color: "#e8b84b",
        stroke: "#000000",
        strokeThickness: 4,
      }).setOrigin(0.5, 1);
      if (!this.opts.still) {
        this.markerTween = this.scene.tweens.add({
          targets: this,
          markerBob: { from: 0, to: -5 },
          duration: 550,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: () => this.place(),
        });
      }
    }
    this.label.setColor(on ? "#e8b84b" : this.opts.nameColour);
    this.refreshLabel();
    this.place();
  }

  setName(name: string): void {
    if (this.label.text !== name) this.label.setText(name);
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.haloTween?.stop();
    this.haloTween = null;
    this.halo?.destroy();
    this.halo = null;
    if (selected) {
      ensureHalo(this.scene);
      const d = this.sprite.displayHeight * 0.7;
      this.halo = this.scene.add.image(this.x, this.y, HALO).setDisplaySize(d, d).setAlpha(0.35);
      const base = this.halo.scaleX;
      this.haloTween = this.scene.tweens.add({
        targets: this.halo,
        alpha: 0.75,
        scaleX: base * 1.25,
        scaleY: base * 1.25,
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    this.refreshLabel();
    this.place();
  }

  /** Out on a stroll - to the shore, the dock, the water - including the pauses along the way, so the name holds steady. */
  setRoaming(on: boolean): void {
    if (on === this.roaming) return;
    this.roaming = on;
    this.refreshLabel();
  }

  private setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.refreshLabel();
  }

  private refreshLabel(): void {
    // Standing at its hall, a house agent's name waits for the pointer: a dozen names there at once would bury the hall.
    this.label.setVisible(this.opts.named || this.mine || this.hovered || this.selected || this.walking || this.roaming);
    this.label.setStroke(this.selected ? "#5c4a22" : "#000000", this.selected ? 5 : 3);
  }

  /** How far below the sprite's middle the water comes, in world pixels. */
  private waterline(): number {
    return (WATERLINE - FRAME / 2) * this.scale;
  }

  /**
   * Into the water or out of it. In, the frame is cut at the chest so the legs
   * are under the surface, a ripple rings the swimmer, and it bobs; either
   * way, a splash where it crossed the waterline.
   */
  private setSwimming(on: boolean): void {
    if (on === this.swimming) return;
    this.swimming = on;
    this.splash();
    if (on) {
      this.sprite.setCrop(0, 0, FRAME, WATERLINE);
      this.cropForWater(true);
      this.ripple = this.scene.add
        .ellipse(this.x, this.y + this.waterline(), 44 * this.scale * 1.6, 12 * this.scale * 1.6, 0xd8f4f2, 0.28)
        .setStrokeStyle(1.5, 0xffffff, 0.7);
      if (!this.opts.still) {
        this.bobTween = this.scene.tweens.add({
          targets: this,
          bob: { from: -1.5, to: 1.5 },
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: () => this.place(),
        });
      }
    } else {
      this.sprite.setCrop();
      this.cropForWater(false);
      this.bobTween?.stop();
      this.bobTween = null;
      this.bob = 0;
      this.ripple?.destroy();
      this.ripple = null;
    }
  }

  /** A ring spreading and fading on the water. */
  private splash(): void {
    // Heard only when it can be seen: a splash somewhere off screen would be a sound from nowhere.
    if (this.scene.cameras.main.worldView.contains(this.x, this.y)) sound.splash();
    if (this.opts.still) return;
    const ring = this.scene.add
      .ellipse(this.x, this.y + this.waterline(), 30 * this.scale * 1.6, 9 * this.scale * 1.6)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(this.sprite.depth + 0.2);
    this.scene.tweens.add({ targets: ring, scaleX: 2.6, scaleY: 2.6, alpha: 0, duration: 650, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
  }

  /** Move the sprite and everything that follows it to (x, y), and sort by the feet. */
  private place(): void {
    const wet = this.opts.inWater?.(this) ?? false;
    if (wet !== this.swimming) this.setSwimming(wet);
    const y = this.y + this.bob;
    const x = this.x + this.lungeX;
    this.sprite.setPosition(x, y);
    // The character on its feet: stepping and rocking as it walks, standing square when it stops;
    // in the water, sunk to the chest at the waterline.
    let nameAt = y + this.labelOffset;
    if (this.portrait) {
      const phase = this.walking && !this.swimming && !this.opts.still ? ((this.scene.time.now - this.stepFrom) / 1000) * (SPEED / STRIDE) * Math.PI * 2 : 0;
      const hop = Math.abs(Math.sin(phase)) * HOP;
      const ground = y + this.footOffset;
      // Standing on its legs: the body's foot is the legs' top, lifted a little on each step.
      const foot = this.swimming ? y + this.waterline() + BODY * (1 - ABOVE_WATER) : ground - LEG + 2 - hop;
      this.portrait.setPosition(x, foot).setRotation(Math.sin(phase) * SWAY);
      this.shadow?.setPosition(x, ground).setScale(1 - hop / (HOP * 5));
      if (!this.swimming) this.drawLegs(x, ground, phase);
      nameAt = (this.swimming ? y + this.waterline() - BODY * ABOVE_WATER : foot - BODY) - 2;
    }
    this.label.setPosition(x, nameAt);
    // Over the name, bobbing, so an owner can find their agent in a crowd.
    const nameTop = this.label.visible ? this.label.displayHeight + 2 : 2;
    this.marker?.setPosition(x, nameAt - nameTop + this.markerBob).setDepth(10_001 + this.y);
    this.halo?.setPosition(this.x, this.y);
    // The frame's foot, as decorations and buildings sort, so all three interleave.
    const feet = this.y + this.sprite.displayHeight * 0.5;
    this.sprite.setDepth(feet + 0.5);
    this.halo?.setDepth(feet + 0.4);
    this.ripple?.setPosition(this.x, this.y + this.waterline()).setDepth(feet + 0.6);
    this.shadow?.setDepth(feet + 0.3);
    this.legs?.setDepth(feet + 0.45);
    this.portrait?.setDepth(feet + 0.5);
    // Names above everything in the village, so a building never hides one.
    this.label.setDepth(10_000 + feet);
  }

  /** Standing still, not on the way anywhere: free to fight. */
  get idle(): boolean {
    return this.walk === null;
  }

  /**
   * Throw itself `dx` pixels at its opponent with a strike, and spring back:
   * one bump of a fight. `then` runs at the moment of contact.
   */
  lunge(dx: number, then?: () => void): void {
    if (this.opts.still || this.walk !== null || this.lungeTween !== null) return;
    this.face(dx < 0 ? "left" : "right");
    this.sprite.play(this.anims.strike, true);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.walk === null) this.sprite.play(this.anims.idle, true);
    });
    this.lungeTween = this.scene.tweens.add({
      targets: this,
      lungeX: dx,
      duration: 150,
      ease: "Quad.easeIn",
      yoyo: true,
      hold: 60,
      onUpdate: () => this.place(),
      onYoyo: () => then?.(),
      onComplete: () => {
        this.lungeTween = null;
        this.lungeX = 0;
        this.place();
      },
    });
  }

  private stopLunge(): void {
    this.lungeTween?.stop();
    this.lungeTween = null;
    this.lungeX = 0;
  }

  /** Knocked back a step by a blow, and steadied again. */
  recoil(dx: number): void {
    if (this.opts.still || this.walk !== null || this.lungeTween !== null) return;
    this.lungeTween = this.scene.tweens.add({
      targets: this,
      lungeX: dx,
      duration: 90,
      ease: "Quad.easeOut",
      yoyo: true,
      onUpdate: () => this.place(),
      onComplete: () => {
        this.lungeTween = null;
        this.lungeX = 0;
        this.place();
      },
    });
  }

  face(side: "left" | "right"): void {
    this.sprite.setFlipX(side === "left");
    this.portrait?.setFlipX(side === "left");
  }

  /** Be at (x, y) now, without walking there. */
  standAt(to: Point, facing?: "left" | "right"): void {
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    this.setWalking(false);
    this.sprite.anims.timeScale = 1;
    this.x = to.x;
    this.y = to.y;
    this.place();
    this.sprite.play(this.anims.idle, true);
    if (facing) this.face(facing);
  }

  /**
   * Walk to (x, y) by the router's way - or in a straight line, for a swim -
   * then face `facing` if given and call `then`. `pace` is a share of full
   * speed: an errand is 1, a stroll less. A new walk replaces one under way,
   * and its `then` is dropped with it.
   */
  walkTo(to: Point, facing?: "left" | "right", how: { pace?: number; straight?: boolean; within?: number; then?: () => void } = {}): void {
    if (this.opts.still) {
      this.standAt(to, facing);
      how.then?.();
      return;
    }
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    const from = { x: this.x, y: this.y };
    const full = how.straight ? [from, to] : this.router(from, to);
    // `within` a time: hurry, however far it is - an agent called to a match that lasts seconds.
    let length = 0;
    for (let k = 1; k < full.length; k++) length += Math.hypot(full[k]!.x - full[k - 1]!.x, full[k]!.y - full[k - 1]!.y);
    const speed = Math.max(SPEED * (how.pace ?? 1), how.within ? (length / how.within) * 1000 : 0);
    const route = full.slice(1);
    const leg = () => {
      const next = route.shift();
      if (!next) {
        this.sprite.play(this.anims.idle, true);
        this.sprite.anims.timeScale = 1;
        this.setWalking(false);
        this.place();
        if (facing) this.face(facing);
        how.then?.();
        return;
      }
      const dx = next.x - this.x;
      const distance = Math.hypot(dx, next.y - this.y);
      if (distance < 5) {
        this.x = next.x;
        this.y = next.y;
        this.place();
        leg();
        return;
      }
      if (Math.abs(dx) > 5) this.face(dx < 0 ? "left" : "right");
      if (!this.walking) this.stepFrom = this.scene.time.now;
      this.setWalking(true);
      this.sprite.play(this.anims.run, true);
      // The legs keep pace with the ground, however fast it is covered.
      this.sprite.anims.timeScale = speed / SPEED;
      this.walk = this.scene.tweens.add({
        targets: this,
        x: next.x,
        y: next.y,
        duration: (distance / speed) * 1000,
        ease: "Linear",
        onUpdate: () => this.place(),
        onComplete: () => {
          this.walk = null;
          leg();
        },
      });
    };
    leg();
  }

  /** A few words rising off the hero and fading: a result, once it has played out. */
  float(text: string, colour: string): void {
    const t = crispText(this.scene, this.x, this.label.y - 4, text, {
      fontSize: "14px",
      fontFamily: MONO,
      fontStyle: "bold",
      color: colour,
      stroke: "#000000",
      strokeThickness: 3,
    })
      .setOrigin(0.5, 1)
      .setDepth(20_000);
    this.scene.tweens.add({
      targets: t,
      y: t.y - (this.opts.still ? 0 : 28),
      alpha: 0,
      delay: 900,
      duration: 1400,
      ease: "Sine.easeIn",
      onComplete: () => t.destroy(),
    });
  }

  /** Fade out and go, for an agent that has left the field. */
  leave(): void {
    this.walk?.stop();
    this.setSelected(false);
    this.scene.tweens.add({
      targets: [this.sprite, this.label, ...(this.portrait ? [this.portrait] : []), ...(this.shadow ? [this.shadow] : []), ...(this.legs ? [this.legs] : []), ...(this.ripple ? [this.ripple] : [])],
      alpha: 0,
      duration: this.opts.still ? 0 : 600,
      onComplete: () => this.destroy(),
    });
  }

  destroy(): void {
    this.markerTween?.stop();
    this.marker?.destroy();
    this.walk?.stop();
    this.lungeTween?.stop();
    this.haloTween?.stop();
    this.bobTween?.stop();
    this.halo?.destroy();
    this.ripple?.destroy();
    this.sprite.destroy();
    this.label.destroy();
    this.portrait?.destroy();
    this.shadow?.destroy();
    this.legs?.destroy();
  }
}
