// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import type { Look } from "../residents";
import type { Point } from "./roads";
import { crispText, MONO } from "./text";
import { shortName, type NameLabel, type Placement } from "./labels";
import { sound } from "@/lib/sound";
import { WEAPONS, weaponTexture, type WeaponName } from "./weapons";

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

/** How big an agent's head is, in world pixels: with its body and legs, about a knight's height. */
const HEAD = 30;
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
/** Its body: how tall, how wide facing us and side on, and how far the head sits down over it. */
const TORSO = 10;
const TORSO_W = 12;
const TORSO_SIDE = 9;
const NECK = 5;
/** Its arms: how long, how thick, and how far a step swings one. */
const ARM = 9;
const ARM_W = 3;
const SWING = 3;
/**
 * How a weapon is held, in radians from upright: leaning a little out at rest,
 * swinging with the arm on the march, and brought down in a lunge. A lunge of
 * this many pixels is the full blow.
 */
const HOLD = 0.3;
const MARCH = 0.25;
const BLOW = 1.3;
const BLOW_AT = 12;

/** Knocked down by a lost match: how long the fall takes, how long it lies there, and how long getting up takes. */
const FALL_MS = 300;
const DOWN_MS = 2600;
const RISE_MS = 500;

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
  /** The name in full, "Pitchfork-1113": shown on hover or when selected. Otherwise the short one, "Pitchfork". */
  private fullName: string;
  /** Where the name would sit, before the layout (labels.ts) nudges it or hides it to keep names apart. */
  private nameSpot = { x: 0, y: 0 };
  private nameNudge = 0;
  private nameAllowed = true;
  /** The agent's character: its portrait, as pixel art, standing where a knight would. */
  private portrait: Phaser.GameObjects.Image | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  /** Its body, arms and legs under the head, redrawn as it steps. */
  private limbs: Phaser.GameObjects.Graphics | null = null;
  /** What it carries (weapons.ts), and where its weapon hand is, in the body's own frame, and at what angle. */
  private weapon: Phaser.GameObjects.Image | null = null;
  private hand = { x: 0, y: 0, angle: 0 };
  /** What the body is dressed in: the head's own commonest colour, outlined in its dark. */
  private colours: { main: number; dark: number } | null = null;
  /** Where the character's feet are, below the sprite's middle: the knight sheet pads each figure well inside its frame. */
  private footOffset: number;
  /** How far over it has fallen, 0 standing to 1 flat, and which way: 1 over to the right, -1 to the left. */
  fall = 0;
  private fallSide: 1 | -1 = -1;
  private fallTween: Phaser.Tweens.TweenChain | null = null;
  /** A walk it was sent on while it lay there, taken once it is up. */
  private afterFall: (() => void) | null = null;
  /** When this walk began, for the rhythm of its steps. */
  private stepFrom = 0;
  /** Its three views - facing us, from the side (facing right), from behind - and which one shows. */
  private views: { front: string; side: string; back: string } | null = null;
  private view: "front" | "back" | "left" | "right" = "front";
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
    this.fullName = name;
    this.label = crispText(scene, at.x, at.y + this.labelOffset, shortName(name), {
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

  /** The agent becomes its character, once its portrait is made into textures: one for each way it can face. */
  setFace(views: { front: string; side: string; back: string }, colours: { main: number; dark: number }): void {
    if (this.portrait) return;
    this.views = views;
    this.colours = colours;
    this.sprite.setVisible(false);
    this.portrait = this.scene.add.image(this.x, this.y, views.front).setOrigin(0.5, 1).setDisplaySize(HEAD, HEAD);
    this.clickable(this.portrait);
    this.turn(this.view);
    this.shadow = this.scene.add.ellipse(this.x, this.y, HEAD * 0.8, HEAD * 0.22, 0x000000, 0.28);
    this.limbs = this.scene.add.graphics();
    if (this.swimming) this.cropForWater(true);
    this.place();
  }

  /** Its weapon, held in its hand from now on. Shown only with a body to hold it: never on the stand-in knight. */
  setWeapon(name: WeaponName): void {
    if (this.weapon) return;
    const w = WEAPONS[name];
    this.weapon = this.scene.add.image(this.x, this.y, weaponTexture(name)).setOrigin(0.5, w.grip / w.h).setVisible(false);
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
    this.limbs?.setVisible(!on);
    this.weapon?.setVisible(!on);
  }

  /**
   * The body under the head, standing on the ground at (x, ground): both legs,
   * side by side when standing and taking turns to lift as it walks, each with
   * a dark boot; the torso over them, lifted with each step; and the arms,
   * swinging against the legs, reaching out in a lunge.
   */
  private drawBody(x: number, ground: number, phase: number, hop: number): void {
    const g = this.limbs;
    const c = this.colours;
    if (!g || !c) return;
    g.clear();
    const sideOn = this.view === "left" || this.view === "right";
    const toward = this.view === "left" ? -1 : 1;
    const top = Math.round(ground - LEG);
    for (const [side, lift] of [[-1, Math.max(0, Math.sin(phase))], [1, Math.max(0, -Math.sin(phase))]] as const) {
      const left = Math.round(x + side * (LEG_GAP / 2 + LEG_W / 2) - LEG_W / 2);
      const up = Math.round(lift * LIFT);
      // A lifted leg is shorter, its boot off the ground and a little forward.
      const forward = sideOn ? toward * Math.round(lift * 2) : 0;
      g.fillStyle(LEG_COLOUR, 1).fillRect(left, top, LEG_W, LEG - up - 2);
      // Side on, a boot points the way it walks; from the front or behind, it sits square under the leg.
      g.fillStyle(BOOT_COLOUR, 1).fillRect(left + forward - (sideOn && toward < 0 ? 1 : 0), top + LEG - up - 3, sideOn ? LEG_W + 1 : LEG_W, 3);
    }
    // The torso, outlined, over the tops of the legs.
    const w = sideOn ? TORSO_SIDE : TORSO_W;
    const chest = this.chest(ground, hop);
    const left = Math.round(x - w / 2);
    g.fillStyle(c.dark, 1).fillRect(left - 1, chest, w + 2, TORSO + 1);
    g.fillStyle(c.main, 1).fillRect(left, chest + 1, w, TORSO - 1);
    const swing = Math.sin(phase);
    const shoulder = chest + 2;
    // The weapon: upright and leaning out at rest, swinging with the arm on the march, brought down in a lunge.
    const blow = Math.min(1, Math.abs(this.lungeX) / BLOW_AT);
    if (sideOn) {
      // Side on, the near arm: swinging fore and aft from the shoulder, thrown forward in a lunge.
      const reach = this.lungeX !== 0 ? toward * (ARM - 2) : toward * swing * SWING;
      const length = this.lungeX !== 0 ? ARM - 3 : ARM;
      this.arm(x - toward, shoulder, reach, length);
      this.hand = { x: Math.round(x - toward + reach), y: shoulder + length, angle: toward * (HOLD + swing * MARCH + blow * BLOW) };
    } else {
      // Facing us or away, both arms at the sides: each shortens as it swings forward, against its leg.
      for (const side of [-1, 1] as const) this.arm(x + side * (w / 2 + ARM_W / 2), shoulder, 0, ARM - Math.round(Math.max(0, side * swing) * 2));
      // Carried in the hand on our right, leaning out.
      const length = ARM - Math.round(Math.max(0, swing) * 2);
      this.hand = { x: Math.round(x + w / 2 + ARM_W / 2), y: shoulder + length, angle: HOLD + swing * MARCH * 0.5 };
    }
  }

  /** Where the top of the torso is: over the legs, lifted a little on each step. */
  private chest(ground: number, hop: number): number {
    return Math.round(ground - LEG + 2 - hop) - TORSO;
  }

  /** One arm, from the shoulder at (x, y) down to a dark hand, `reach` pixels across and `length` down. */
  private arm(x: number, y: number, reach: number, length: number): void {
    const g = this.limbs;
    const c = this.colours;
    if (!g || !c) return;
    const hx = Math.round(x + reach);
    const hy = y + length;
    g.lineStyle(ARM_W + 2, c.dark, 1).lineBetween(x, y, hx, hy);
    g.lineStyle(ARM_W, c.main, 1).lineBetween(x, y, hx, hy);
    g.fillStyle(c.dark, 1).fillRect(hx - 2, hy - 1, 4, 4);
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
    this.fullName = name;
    this.refreshLabel();
  }

  /** Hovered, selected or the owner's own: its name shows even where it would overlap another. */
  private get nameForced(): boolean {
    return this.mine || this.hovered || this.selected;
  }

  /** The name as it would sit, for the layout to place; null when it would not show at all. */
  nameLabel(id: string): NameLabel | null {
    if (!this.wantsName()) return null;
    return { id, x: this.nameSpot.x, y: this.nameSpot.y, width: this.label.displayWidth, height: this.label.displayHeight, forced: this.nameForced };
  }

  /** Where the layout put the name: nudged up or down, or hidden for another's. */
  placeName(p: Placement): void {
    if (p.dy === this.nameNudge && p.shown === this.nameAllowed) return;
    this.nameNudge = p.dy;
    this.nameAllowed = p.shown;
    this.refreshLabel();
    this.label.setPosition(this.nameSpot.x, this.nameSpot.y + this.nameNudge);
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

  /** Whether its name would show at all, before names are kept apart. */
  private wantsName(): boolean {
    // Standing at its hall, a house agent's name waits for the pointer: a dozen names there at once would bury the hall.
    return this.opts.named || this.mine || this.hovered || this.selected || this.walking || this.roaming;
  }

  private refreshLabel(): void {
    const text = this.hovered || this.selected ? this.fullName : shortName(this.fullName);
    if (this.label.text !== text) this.label.setText(text);
    this.label.setVisible(this.wantsName() && (this.nameAllowed || this.nameForced));
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
      // Standing on its body: the head sits down over the top of the torso, lifted with it on each step.
      // Knocked down, the whole figure turns over about its feet, head and body together.
      const neck = this.chest(0, hop) + NECK;
      const tilt = this.fall * this.fallSide * (Math.PI / 2);
      const foot = this.swimming
        ? { x, y: y + this.waterline() + HEAD * (1 - ABOVE_WATER) }
        : { x: x - neck * Math.sin(tilt), y: ground + neck * Math.cos(tilt) };
      this.portrait.setPosition(foot.x, foot.y).setRotation(Math.sin(phase) * SWAY + tilt);
      this.shadow?.setPosition(x + this.fallSide * this.fall * HEAD * 0.6, ground).setScale(1 - hop / (HOP * 5) + this.fall * 0.9, 1);
      if (!this.swimming) {
        this.drawBody(0, 0, phase, hop);
        this.limbs?.setPosition(Math.round(x), Math.round(ground)).setRotation(tilt);
        // The weapon in the hand, turning with the body when it is knocked over.
        if (this.weapon) {
          const cos = Math.cos(tilt);
          const sin = Math.sin(tilt);
          const hx = Math.round(x) + this.hand.x * cos - this.hand.y * sin;
          const hy = Math.round(ground) + this.hand.x * sin + this.hand.y * cos;
          this.weapon.setPosition(hx, hy).setRotation(this.hand.angle + tilt).setFlipX(this.view === "left").setVisible(true);
        }
      }
      // Lying down, the head is on its side: half its height above the ground rather than all of it.
      nameAt = (this.swimming ? y + this.waterline() - HEAD * ABOVE_WATER : foot.y - HEAD * (1 - 0.5 * this.fall)) - 2;
    }
    this.nameSpot = { x, y: nameAt };
    this.label.setPosition(x, nameAt + this.nameNudge);
    // Over the name, bobbing, so an owner can find their agent in a crowd.
    const nameTop = this.label.visible ? this.label.displayHeight + 2 : 2;
    this.marker?.setPosition(x, nameAt + this.nameNudge - nameTop + this.markerBob).setDepth(10_001 + this.y);
    this.halo?.setPosition(this.x, this.y);
    // The frame's foot, as decorations and buildings sort, so all three interleave.
    const feet = this.y + this.sprite.displayHeight * 0.5;
    this.sprite.setDepth(feet + 0.5);
    this.halo?.setDepth(feet + 0.4);
    this.ripple?.setPosition(this.x, this.y + this.waterline()).setDepth(feet + 0.6);
    this.shadow?.setDepth(feet + 0.3);
    this.limbs?.setDepth(feet + 0.45);
    // In front of the body, except seen from behind, when the body is in front of it.
    this.weapon?.setDepth(feet + (this.view === "back" ? 0.44 : 0.47));
    this.portrait?.setDepth(feet + 0.5);
    // Names above everything in the village, so a building never hides one.
    this.label.setDepth(10_000 + feet);
  }

  /** Standing still, not on the way anywhere and not on the ground: free to fight. */
  get idle(): boolean {
    return this.walk === null && this.fallTween === null;
  }

  /**
   * Knocked flat by a lost match: over backwards, away from the way it faced,
   * a few seconds on the ground, and up again. Anywhere it is sent meanwhile
   * waits until it is on its feet.
   */
  knockDown(): void {
    if (this.opts.still || !this.portrait || this.swimming || this.fallTween) return;
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    this.setWalking(false);
    this.fallSide = this.view === "left" ? 1 : -1;
    this.scene.time.delayedCall(FALL_MS, () => this.dust());
    this.fallTween = this.scene.tweens.chain({
      targets: this,
      tweens: [
        { fall: 1, duration: FALL_MS, ease: "Quad.easeIn", onUpdate: () => this.place() },
        { fall: 1, duration: DOWN_MS },
        { fall: 0, duration: RISE_MS, ease: "Back.easeOut", onUpdate: () => this.place() },
      ],
      onComplete: () => this.getUp(),
    });
  }

  /** On its feet again, and off wherever it was sent while it lay there. */
  private getUp(): void {
    this.fallTween = null;
    this.fall = 0;
    this.place();
    const next = this.afterFall;
    this.afterFall = null;
    next?.();
  }

  /** A puff of dust either side of where it landed. */
  private dust(): void {
    if (!this.portrait) return;
    const at = { x: this.x + this.fallSide * HEAD * 0.7, y: this.y + this.footOffset };
    for (const dx of [-1, 1]) {
      const puff = this.scene.add.ellipse(at.x + dx * 8, at.y, 10, 5, 0xd8cbb0, 0.8).setDepth(this.y + this.footOffset + 1000);
      this.scene.tweens.add({ targets: puff, x: puff.x + dx * 12, scaleX: 2, scaleY: 1.6, alpha: 0, duration: 500, ease: "Quad.easeOut", onComplete: () => puff.destroy() });
    }
  }

  /**
   * Throw itself `dx` pixels at its opponent with a strike, and spring back:
   * one bump of a fight. `then` runs at the moment of contact.
   */
  lunge(dx: number, then?: () => void): void {
    if (this.opts.still || this.walk !== null || this.lungeTween !== null || this.fallTween !== null) return;
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
    if (this.opts.still || this.walk !== null || this.lungeTween !== null || this.fallTween !== null) return;
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

  /** Side on, toward one side: walking that way, or squared up to an opponent there. */
  face(side: "left" | "right"): void {
    this.sprite.setFlipX(side === "left");
    this.turn(side);
  }

  /** Which way the character shows: its face, its back, or its side, turned the way it goes. */
  private turn(view: "front" | "back" | "left" | "right"): void {
    this.view = view;
    const p = this.portrait;
    const v = this.views;
    if (!p || !v) return;
    const key = view === "front" ? v.front : view === "back" ? v.back : v.side;
    if (p.texture.key !== key) {
      p.setTexture(key);
      // A new texture resets the crop and the size: keep what the water and the scale had set.
      p.setDisplaySize(HEAD, HEAD);
      if (this.swimming) this.cropForWater(true);
    }
    p.setFlipX(view === "left");
  }

  /** Be at (x, y) now, without walking there. */
  standAt(to: Point, facing?: "left" | "right"): void {
    this.fallTween?.stop();
    this.fallTween = null;
    this.afterFall = null;
    this.fall = 0;
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
    else this.turn("front");
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
    if (this.fallTween) {
      this.afterFall = () => this.walkTo(to, facing, how);
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
        if (facing) this.face(facing);
        else this.turn("front");
        this.place();
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
      // Its back when going up the screen, its face when coming down, its side across.
      const dy = next.y - this.y;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        this.sprite.setFlipX(dx < 0);
        this.turn(dy < 0 ? "back" : "front");
      } else if (Math.abs(dx) > 5) this.face(dx < 0 ? "left" : "right");
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
      targets: [this.sprite, this.label, ...(this.portrait ? [this.portrait] : []), ...(this.shadow ? [this.shadow] : []), ...(this.limbs ? [this.limbs] : []), ...(this.weapon ? [this.weapon] : []), ...(this.ripple ? [this.ripple] : [])],
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
    this.fallTween?.stop();
    this.haloTween?.stop();
    this.bobTween?.stop();
    this.halo?.destroy();
    this.ripple?.destroy();
    this.sprite.destroy();
    this.label.destroy();
    this.portrait?.destroy();
    this.shadow?.destroy();
    this.limbs?.destroy();
    this.weapon?.destroy();
  }
}
