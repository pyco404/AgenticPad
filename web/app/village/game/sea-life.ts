import { OCEAN_BOX, SEA_ANIMALS, seaAnimalPosition, type SeaKind } from "../../../lib/world/landscape";

/**
 * The lake's fish, turtles and rays: their pixel art, shared by Top's textures (scenery.ts) and the
 * world camera, and their live drawing flat on the water. No Phaser here, so the camera can load it.
 */
export const SEA_ART: Record<SeaKind, { rows: string[]; palette: Record<string, string>; scale: number }> = {
  // Facing +x: the head is on the right.
  fish: { scale: 2.5, rows: ["...........aa.....", "..........abba....", ".aa...bbbbbbbbb...", ".aba.bccccccccbbb.", "..abccccccccccceb", ".aba.bccccccccbbb.", ".aa...bbbbbbbbb...", "..........abba....", "...........aa....."],
    palette: { a: "#94642b", b: "#e9a84b", c: "#f8d879", e: "#173b48" } },
  turtle: { scale: 2.5, rows: ["........aa.........", "...bb..acca..bb....", "..bccbbbbbbbbccb...", "...bbbcddddcbbb....", "...bbcdccccdcbbaaa.", "aaabbcdccccdcbbcea.", "...bbcdccccdcbb.aaa", "...bbbcddddcbbb....", "..bccbbbbbbbbccb...", "...bb........bb...."],
    palette: { a: "#305b48", b: "#43744c", c: "#85a85d", d: "#355d3a", e: "#142f32" } },
  // Facing -x: the ray's tail trails off to the right.
  ray: { scale: 3, rows: [".........a.........", "........aba........", ".......abbba.......", ".....abbbbbba......", "...abbbccbbbba.....", ".abbbbccccbbbbaaa..", "abbbbbceccbbbbbbaaa", ".abbbbccccbbbbaaa..", "...abbbccbbbba.....", ".....abbbbbba......", ".......abbba.......", "........aba........", ".........a........."],
    palette: { a: "#23465d", b: "#386c81", c: "#72a6b0", e: "#142c3f" } },
};

/** Paints one animal's pixels onto a canvas of its own size. */
export function paintSeaArt(c: CanvasRenderingContext2D, kind: SeaKind): void {
  const { rows, palette } = SEA_ART[kind];
  rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    const colour = palette[pixel];
    if (colour) { c.fillStyle = colour; c.fillRect(x, y, 1, 1); }
  }));
}

const sprites = new Map<SeaKind, HTMLCanvasElement>();
function sprite(kind: SeaKind): HTMLCanvasElement {
  let s = sprites.get(kind);
  if (!s) {
    const rows = SEA_ART[kind].rows;
    s = document.createElement("canvas"); s.width = Math.max(...rows.map((r) => r.length)); s.height = rows.length;
    paintSeaArt(s.getContext("2d")!, kind); sprites.set(kind, s);
  }
  return s;
}

/**
 * Every animal this frame, flat on the water under the upright scenery. A fish swishes its tail
 * (quicker as it darts) and leaves a little wake near the surface; a turtle paddles and rises and
 * dives; a ray beats its wings. Deeper means fainter, so the water shows through.
 */
export function drawSeaLife(ctx: CanvasRenderingContext2D, toScreen: (p: { x: number; y: number }, z?: number) => { x: number; y: number }, seconds: number, width: number, height: number): void {
  const corners = [{ x: OCEAN_BOX.x0, y: OCEAN_BOX.y0 }, { x: OCEAN_BOX.x1, y: OCEAN_BOX.y0 }, { x: OCEAN_BOX.x1, y: OCEAN_BOX.y1 }, { x: OCEAN_BOX.x0, y: OCEAN_BOX.y1 }].map((p) => toScreen(p));
  if (corners.every((p) => p.x < 0) || corners.every((p) => p.x > width) || corners.every((p) => p.y < 0) || corners.every((p) => p.y > height)) return;
  const o = toScreen({ x: 0, y: 0 }), ex = toScreen({ x: 1, y: 0 }), ey = toScreen({ x: 0, y: 1 });
  ctx.save();
  ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < SEA_ANIMALS; i++) {
    const at = seaAnimalPosition(i, seconds), art = SEA_ART[at.kind], image = sprite(at.kind);
    const w = image.width, h = image.height, beat = Math.sin(at.stroke), alpha = 1 - at.submerged * 0.6;
    ctx.save();
    ctx.translate(at.x, at.y); ctx.rotate(at.heading);
    if (at.kind === "fish" && at.submerged < 0.35) {
      // A V of foam behind it, flickering.
      ctx.fillStyle = "#d6f0f4";
      for (let j = 1; j <= 3; j++) {
        ctx.globalAlpha = (0.35 - at.submerged) * 1.6 * (0.6 + 0.4 * Math.sin(seconds * 6 + j + i)) * (1 - j * 0.2);
        const x = -w / 2 * art.scale - j * 7;
        ctx.fillRect(x, -j * 2.5 - 1, 4, 1.5); ctx.fillRect(x, j * 2.5 - 0.5, 4, 1.5);
      }
    }
    ctx.globalAlpha = alpha;
    ctx.scale(art.scale, art.scale);
    if (at.kind === "fish") {
      // The body sways a little; the tail (first six columns) swings about its root.
      ctx.rotate(0.08 * Math.sin(at.stroke + 1));
      const joint = 6;
      ctx.drawImage(image, joint, 0, w - joint, h, -w / 2 + joint, -h / 2, w - joint, h);
      ctx.save(); ctx.translate(-w / 2 + joint, 0); ctx.rotate(0.38 * beat);
      ctx.drawImage(image, 0, 0, joint + 0.5, h, -joint, -h / 2, joint + 0.5, h);
      ctx.restore();
    } else if (at.kind === "turtle") {
      // Flippers pull and recover: the shell's outline breathes across its width.
      ctx.rotate(0.05 * Math.sin(at.stroke * 0.5));
      ctx.scale(1 - 0.04 * beat, 1 + 0.1 * beat);
      ctx.drawImage(image, -w / 2, -h / 2);
    } else {
      // Head first along its heading; wings fold and open across it.
      ctx.rotate(Math.PI + 0.06 * Math.sin(at.stroke * 0.5));
      ctx.scale(1, 0.72 + 0.28 * (0.5 + 0.5 * beat));
      ctx.drawImage(image, -w / 2, -h / 2);
    }
    ctx.restore();
  }
  ctx.restore();
}
