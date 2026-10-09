import * as Phaser from "phaser";
import type { TableRound } from "../residents";
import type { Phase } from "@/lib/playhead";
import { crispText, MONO } from "./text";

/**
 * A match of Bluff & Fold as the arena shows it: a small card table between
 * the two sides, the hands dealt face down, each choice said over the one who
 * made it, the chips going into the pot, and at a showdown both cards turned
 * over to show the edges before the pot goes to the round's winner.
 *
 * It only ever shows what the live feed shows, when the feed shows it: the
 * scene hands it the playhead (lib/playhead), the one clock every view of a
 * playing match keeps to. Nothing here decides anything.
 */

type Seat = "A" | "B";
type Side = { x: number; y: number };

const COLOUR = { text: "#ede6d6", accent: "#e8b84b", live: "#6f9e5c", loss: "#d4745a", muted: "#a79f90" };
const WOOD = 0x8a5a33;
const WOOD_DARK = 0x4f3219;
const CARD_BACK = 0x2d4a8a;
const CARD_FACE = 0xf4ecd8;
const CHIP = 0xe8b84b;

/** Where the table stands under the pair: this far below their middle, which is about hip height. */
const TABLE_DROP = 12;
const TABLE_W = 52;
const TABLE_H = 12;
const CARD_W = 10;
const CARD_H = 14;
/** How far out from the middle each side's card sits. */
const CARD_X = 14;
/** How long a chip or card takes to slide. */
const SLIDE_MS = 260;

const WORDS: Record<"fold" | "call" | "raise", { text: string; colour: string }> = {
  raise: { text: "Raise", colour: COLOUR.accent },
  call: { text: "Call", colour: COLOUR.text },
  fold: { text: "Fold", colour: COLOUR.loss },
};

export class CardTable {
  private readonly top: Phaser.GameObjects.Graphics;
  private cards: Partial<Record<Seat, Phaser.GameObjects.Rectangle>> = {};
  private edges: Phaser.GameObjects.Text[] = [];
  private pot: Phaser.GameObjects.Arc[] = [];
  private said: Phaser.GameObjects.Text[] = [];
  /** Which side each word was said over; null for both, over the table. */
  private saidBy = new Map<Phaser.GameObjects.Text, Seat | null>();
  /** On the map: placed and not put away. */
  private onMap = false;
  /** The round and phase last drawn, and how many of that round's choices are already said. */
  private at = "";
  private spoken = 0;
  private sides: Record<Seat, Side> = { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } };
  private mid = { x: 0, y: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    /** Reduced motion: everything appears where it ends up, with no slides. */
    private readonly still: boolean,
  ) {
    this.top = scene.add.graphics();
  }

  /** Where the two sides stand now, seat A usually on the left. Moves the table with them. */
  place(a: Side, b: Side, labelScale: number): void {
    this.sides = { A: a, B: b };
    this.onMap = true;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + TABLE_DROP };
    const moved = mid.x !== this.mid.x || mid.y !== this.mid.y;
    this.mid = mid;
    const depth = mid.y + 60;
    if (moved) {
      this.top.clear();
      // Two legs and a top, drawn at the pack's pixel size.
      this.top.fillStyle(WOOD_DARK, 1).fillRect(mid.x - TABLE_W / 2 + 3, mid.y, 3, 14).fillRect(mid.x + TABLE_W / 2 - 6, mid.y, 3, 14);
      this.top.fillStyle(WOOD_DARK, 1).fillRect(mid.x - TABLE_W / 2 - 1, mid.y - TABLE_H / 2 - 1, TABLE_W + 2, TABLE_H + 2);
      this.top.fillStyle(WOOD, 1).fillRect(mid.x - TABLE_W / 2, mid.y - TABLE_H / 2, TABLE_W, TABLE_H);
      this.top.fillStyle(0x3f6b3a, 1).fillRect(mid.x - TABLE_W / 2 + 3, mid.y - TABLE_H / 2 + 2, TABLE_W - 6, TABLE_H - 4);
    }
    this.top.setDepth(depth);
    for (const c of Object.values(this.cards)) c?.setDepth(depth + 1);
    for (const p of this.pot) p.setDepth(depth + 2);
    for (const t of [...this.said, ...this.edges]) t.setScale(labelScale);
  }

  /**
   * Draws `round` at `phase`, `within` of the way through that phase. Called on
   * every tick; it only acts when something new is due, so each deal, choice
   * and showdown happens once.
   */
  show(round: number, phase: Phase, within: number, data: TableRound | null): void {
    const key = `${round}:${phase}`;
    if (phase === "final") {
      if (this.at !== key) this.clear();
      this.at = key;
      return;
    }
    if (!data) return;
    if (this.at !== key) {
      const was = this.at;
      this.at = key;
      // A new round starts from a bare table - also when its deal was never seen, which happens
      // when a page's timers are slowed (a background tab) and a whole phase goes by between ticks.
      const fresh = !was.startsWith(`${round}:`);
      if (phase === "hands") {
        this.clear();
        this.deal();
      } else if (phase === "action") {
        if (fresh) {
          this.clear();
          this.deal();
        }
      } else {
        if (fresh) {
          this.clear();
          this.deal();
        }
        // Anything not yet said is said now, then the round ends.
        this.speak(data, data.sequence.length);
        this.settle(data);
      }
    }
    if (phase === "action") this.speak(data, Math.min(data.sequence.length, Math.floor(within * (data.sequence.length + 1))));
  }

  /** Off the map for now - a ring drawn only as a marker. Shown again, it deals the round afresh. */
  hide(): void {
    this.onMap = false;
    this.clear();
    this.top.clear();
    this.at = "";
    this.mid = { x: Number.NaN, y: Number.NaN };
  }

  destroy(): void {
    this.clear();
    this.top.destroy();
  }

  // --- The parts of a round -------------------------------------------------

  /** A card face down to each side, and an ante chip from each into the pot. */
  private deal(): void {
    for (const c of Object.values(this.cards)) c?.destroy();
    for (const seat of ["A", "B"] as const) {
      const toward = Math.sign(this.sides[seat].x - this.mid.x) || (seat === "A" ? -1 : 1);
      const card = this.scene.add
        .rectangle(this.mid.x, this.mid.y - 1, CARD_W, CARD_H, CARD_BACK)
        .setStrokeStyle(1.5, 0xffffff, 0.9)
        .setDepth(this.mid.y + 61);
      this.slide(card, this.mid.x + toward * CARD_X, this.mid.y - 1);
      this.cards[seat] = card;
      this.chip(seat);
    }
  }

  /** Says the first `upTo` choices, each over the one who made it, with its chips. */
  private speak(data: TableRound, upTo: number): void {
    while (this.spoken < upTo) {
      const step = data.sequence[this.spoken++]!;
      this.say(step.seat, WORDS[step.action].text, WORDS[step.action].colour);
      if (step.action === "fold") {
        // A fold drops the hand: its card slides back and fades.
        const card = this.cards[step.seat];
        if (card) this.fade(card, 0.35);
      } else {
        // A raise puts in the bet; a call matches whatever is in front of it.
        this.chip(step.seat);
        if (step.action === "raise") this.chip(step.seat);
      }
    }
  }

  /** The end of a round: a showdown turns both cards over, and the pot goes to whoever took it. */
  private settle(data: TableRound): void {
    if (data.outcome === "flipped") {
      for (const seat of ["A", "B"] as const) {
        const card = this.cards[seat];
        if (!card) continue;
        card.setFillStyle(CARD_FACE).setStrokeStyle(1, 0x2b1d10, 1).setAlpha(1);
        const pct = `${Math.round(data.edges[seat] * 100)}%`;
        const won = data.winner === seat;
        const label = crispText(this.scene, card.x, card.y - CARD_H, pct, {
          fontSize: "12px",
          fontFamily: MONO,
          fontStyle: "bold",
          color: won ? COLOUR.live : COLOUR.muted,
          stroke: "#000000",
          strokeThickness: 3,
        })
          .setOrigin(0.5, 1)
          .setDepth(18_500);
        this.edges.push(label);
      }
    }
    const to = data.winner;
    for (const p of this.pot) {
      if (to) this.slide(p, this.sides[to].x, this.sides[to].y + TABLE_DROP, () => p.setVisible(false));
      else this.fade(p, 0);
    }
    if (data.outcome === "both-folded") this.say(null, "Both fold", COLOUR.muted);
  }

  // --- Pieces -------------------------------------------------------------

  /** One chip from a side's place into the pot, stacked a little so a pot looks like one. */
  private chip(seat: Seat): void {
    const n = this.pot.length;
    const x = this.mid.x + ((n % 3) - 1) * 5;
    const y = this.mid.y - 1 - Math.floor(n / 3) * 2.5;
    const chip = this.scene.add
      .circle(this.sides[seat].x, this.sides[seat].y + TABLE_DROP, 3, CHIP)
      .setStrokeStyle(1, 0x7a5a1c)
      .setDepth(this.mid.y + 62);
    this.slide(chip, x, y);
    this.pot.push(chip);
  }

  /** A word over a side's head, or over the table for both, that rises and fades. */
  private say(seat: Seat | null, text: string, colour: string): void {
    const at = seat ? this.sides[seat] : this.mid;
    const y = (seat ? at.y : at.y - TABLE_DROP) - 40;
    const word = crispText(this.scene, at.x, y, text, {
      fontSize: "13px",
      fontFamily: MONO,
      fontStyle: "bold",
      color: colour,
      stroke: "#000000",
      strokeThickness: 3,
    })
      .setOrigin(0.5, 1)
      .setDepth(18_600);
    this.said.push(word);
    this.saidBy.set(word, seat);
    if (this.still) return;
    this.scene.tweens.add({ targets: word, y: y - 8, alpha: 0, delay: 500, duration: 700, ease: "Quad.easeIn", onComplete: () => word.destroy() });
  }

  private slide(target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, x: number, y: number, then?: () => void): void {
    if (this.still) {
      target.setPosition(x, y);
      then?.();
      return;
    }
    this.scene.tweens.add({ targets: target, x, y, duration: SLIDE_MS, ease: "Quad.easeOut", ...(then ? { onComplete: then } : {}) });
  }

  private fade(target: Phaser.GameObjects.Shape, to: number): void {
    if (this.still) {
      target.setAlpha(to);
      return;
    }
    this.scene.tweens.add({ targets: target, alpha: to, duration: SLIDE_MS });
  }

  /** Everything off the table but the table. */
  private clear(): void {
    for (const c of Object.values(this.cards)) c?.destroy();
    this.cards = {};
    for (const o of [...this.pot, ...this.said, ...this.edges]) {
      this.scene.tweens.killTweensOf(o);
      o.destroy();
    }
    this.pot = [];
    this.said = [];
    this.saidBy.clear();
    this.edges = [];
    this.spoken = 0;
  }

  /** Physical table/cards stay on fixed world axes; speech and scores remain readable UI. */
  paintTo(ctx: CanvasRenderingContext2D, a: Side, b: Side, k: number, projectWorld: (p: Side, z: number) => Side): void {
    if (!this.onMap || Number.isNaN(this.mid.x)) return;
    const side = { A: a, B: b }, ground = { x: this.mid.x, y: this.mid.y - TABLE_DROP };
    const base = projectWorld(ground, 0);
    const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
    const point = (x: number, y: number, z: number) => projectWorld({ x: ground.x + x, y: ground.y + y }, z);
    const polygon = (points: Side[], colour: number, border?: number) => {
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = hex(colour); ctx.fill();
      if (border !== undefined) { ctx.strokeStyle = hex(border); ctx.lineWidth = Math.max(.5, k); ctx.stroke(); }
    };
    const rectangle = (x: number, y: number, w: number, h: number, z: number, colour: number, border?: number) =>
      polygon([point(x, y, z), point(x + w, y, z), point(x + w, y + h, z), point(x, y + h, z)], colour, border);
    const at = (o: Side) => point(o.x - this.mid.x, o.y - this.mid.y, 19);
    ctx.save(); ctx.globalAlpha = .28;
    polygon(Array.from({ length: 16 }, (_, i) => point(Math.cos(i * Math.PI / 8) * TABLE_W * .55, Math.sin(i * Math.PI / 8) * 12, 0)), 0x000000);
    ctx.globalAlpha = 1;
    const legs = [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: x * (TABLE_W / 2 - 5), y: y * 7 }))).sort((a, b) => point(a.x, a.y, 0).y - point(b.x, b.y, 0).y);
    for (const leg of legs) {
      polygon([point(leg.x, leg.y, 0), point(leg.x + 3, leg.y, 0), point(leg.x + 3, leg.y, 18), point(leg.x, leg.y, 18)], WOOD_DARK);
      polygon([point(leg.x, leg.y, 0), point(leg.x, leg.y + 3, 0), point(leg.x, leg.y + 3, 18), point(leg.x, leg.y, 18)], WOOD);
    }
    rectangle(-TABLE_W / 2 - 1, -10, TABLE_W + 2, 20, 18, WOOD_DARK);
    rectangle(-TABLE_W / 2, -9, TABLE_W, 18, 18.2, WOOD);
    rectangle(-TABLE_W / 2 + 3, -7, TABLE_W - 6, 14, 18.4, 0x3f6b3a);
    for (const card of Object.values(this.cards)) {
      if (!card?.active || !card.visible) continue;
      ctx.globalAlpha = card.alpha;
      rectangle(card.x - this.mid.x - CARD_W / 2, card.y - this.mid.y - CARD_H / 2, CARD_W, CARD_H, 19, card.fillColor, card.strokeColor);
    }
    for (const chip of this.pot) {
      if (!chip.active || !chip.visible) continue;
      ctx.globalAlpha = chip.alpha;
      polygon(Array.from({ length: 12 }, (_, i) => point(chip.x - this.mid.x + Math.cos(i * Math.PI / 6) * 3, chip.y - this.mid.y + Math.sin(i * Math.PI / 6) * 3, 19.5)), CHIP, 0x7a5a1c);
    }
    ctx.globalAlpha = 1;
    // Words: the edges over the cards, and what each side says over its head, rising as Top's do.
    const word = (t: Phaser.GameObjects.Text, x: number, y: number, size: number) => {
      if (!t.active || !t.visible || t.alpha <= 0) return;
      ctx.globalAlpha = t.alpha;
      ctx.font = `bold ${Math.round(size)}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(t.text, x, y);
      ctx.fillStyle = String(t.style.color); ctx.fillText(t.text, x, y);
    };
    for (const t of this.edges) { const p = at(t); word(t, p.x, p.y, 12); }
    for (const t of this.said) {
      const seat = this.saidBy.get(t) ?? null;
      const anchor = seat ? this.sides[seat] : { x: this.mid.x, y: this.mid.y - TABLE_DROP };
      const foot = seat ? side[seat] : base;
      // Top's word sits 40 above the side's point, and that point about 18 above its feet.
      word(t, foot.x, foot.y + (t.y - anchor.y - 18) * Math.max(k, 0.6), 13);
    }
    ctx.restore();
  }
}
