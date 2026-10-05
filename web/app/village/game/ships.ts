import * as Phaser from "phaser";
import type { Ground } from "./ground";
import type { Point } from "./roads";

/**
 * Ships sailing on the lake, beside the one moored off the dock (dressing.ts).
 * Each picks a spot of open water, sails there along a straight line that stays
 * on water with room either side, rides it a few seconds, and picks another.
 *
 * Only decoration: nothing here is a building, nothing is clickable, and
 * nothing reads a match. With reduced motion they are anchored where they start.
 */

/** The water tiles, as Ground cuts the map. */
const TILE = 64;
/** The ship picture: the pack's own (public/fixtures). */
const SHIP = { key: "dress-ship", src: "/fixtures/Ship.png", scale: 0.62 };

/** Queues the ship picture; with the old lake's moored ship gone, nothing else loads it. */
export function loadShips(scene: Phaser.Scene): void {
  if (!scene.textures.exists(SHIP.key)) scene.load.image(SHIP.key, SHIP.src);
}
/** World pixels a second: a lazy drift, slower than anyone walks. */
const SPEED = 22;
/** How long a ship rides at a spot before it sets off again. */
const HOLD_MS: [number, number] = [2_500, 7_000];
/** How far a ship keeps from the shore along its whole course, beside the line it sails. */
const BEAM = 34;
/** How far a ship keeps from a rock in the lake, from the moored ship and from the other one's next stop. */
const ROCK_ROOM = 90;
const MOORED_ROOM = 150;
const SHIP_ROOM = 160;
/** A course shorter than this is not worth setting out on. */
const MIN_LEG = 140;
/** The lake's water is drawn over anything low in it, so ships sit at the moored ship's depth (dressing.ts). */
const DEPTH = 2_000;

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

type Ship = { image: Phaser.GameObjects.Image; next: Point | null };

export function sailShips(
  scene: Phaser.Scene,
  ground: Ground,
  options: { count: number; still: boolean; moored: Point | null; rocks: Point[]; dock: Point | null },
): void {
  if (!scene.textures.exists(SHIP.key)) return;
  const wet = (p: Point) => ground.inWater(p);

  // Open water: a tile whose eight neighbours are water too, away from the rocks, the dock and the moored ship.
  const spots = ground.water.filter((p) => {
    for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) if (!wet({ x: p.x + dx, y: p.y + dy })) return false;
    if (options.rocks.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < ROCK_ROOM)) return false;
    if (options.moored && Math.hypot(options.moored.x - p.x, options.moored.y - p.y) < MOORED_ROOM) return false;
    if (options.dock && Math.hypot(options.dock.x - p.x, options.dock.y - p.y) < MOORED_ROOM) return false;
    return true;
  });
  if (spots.length < 2) return;

  /** Whether a straight course a-b stays on water with BEAM to spare on each side, and clear of the moored ship. */
  const sailable = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < MIN_LEG) return false;
    const [nx, ny] = [-(b.y - a.y) / length, (b.x - a.x) / length];
    for (let d = 0; d <= length; d += TILE / 4) {
      const p = { x: a.x + ((b.x - a.x) * d) / length, y: a.y + ((b.y - a.y) * d) / length };
      if (!wet(p) || !wet({ x: p.x + nx * BEAM, y: p.y + ny * BEAM }) || !wet({ x: p.x - nx * BEAM, y: p.y - ny * BEAM })) return false;
      if (options.moored && Math.hypot(options.moored.x - p.x, options.moored.y - p.y) < MOORED_ROOM * 0.7) return false;
      if (options.rocks.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < ROCK_ROOM * 0.7)) return false;
    }
    return true;
  };

  const ships: Ship[] = [];
  const pick = (from: Point, self: Ship | null): Point | null => {
    for (let tries = 0; tries < 40; tries++) {
      const to = spots[Math.floor(Math.random() * spots.length)]!;
      // Never both making for the same patch of water.
      if (ships.some((s) => s !== self && Math.hypot((s.next ?? s.image).x - to.x, (s.next ?? s.image).y - to.y) < SHIP_ROOM)) continue;
      if (sailable(from, to)) return to;
    }
    return null;
  };

  const sail = (ship: Ship) => {
    const from = { x: ship.image.x, y: ship.image.y };
    const to = pick(from, ship);
    ship.next = to;
    if (!to) {
      // Boxed in for now: ride where it is and try again later.
      scene.time.delayedCall(between(HOLD_MS), () => sail(ship));
      return;
    }
    // The picture faces right; it turns to face the way it is going.
    ship.image.setFlipX(to.x < from.x);
    scene.tweens.add({
      targets: ship.image,
      x: to.x,
      y: to.y,
      duration: (Math.hypot(to.x - from.x, to.y - from.y) / SPEED) * 1000,
      ease: "Sine.easeInOut",
      onComplete: () => scene.time.delayedCall(between(HOLD_MS), () => sail(ship)),
    });
  };

  for (let i = 0; i < options.count; i++) {
    // Starting spots apart from each other, so the two do not set out from one place.
    const start = spots.filter((p) => ships.every((s) => Math.hypot(s.image.x - p.x, s.image.y - p.y) > SHIP_ROOM * 2));
    const at = (start.length ? start : spots)[Math.floor(Math.random() * (start.length || spots.length))]!;
    const image = scene.add.image(at.x, at.y, SHIP.key).setOrigin(0.5, 1).setScale(SHIP.scale).setDepth(DEPTH).setFlipX(Math.random() < 0.5);
    const ship: Ship = { image, next: null };
    ships.push(ship);
    if (options.still) continue;
    // A gentle roll the whole time, under way or riding at a spot.
    scene.tweens.add({ targets: image, angle: 1.8, duration: 1_900 + i * 300, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: i * 500 });
    scene.time.delayedCall(between([500, 3_000]), () => sail(ship));
  }
}
