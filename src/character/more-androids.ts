import { eyes, mouth, ngon, oval, pair, shape, stroke, type Anchors, type Ctx, type Pt } from "./draw.js";

/**
 * More androids, in the style of androids.ts: a brain under a glass dome, one great eye, an old
 * television, a hovering drone, a vented mech, a clockwork face, a dish, a light bulb, a space
 * helmet. The mood still reads in the eyes, whatever they are made of.
 */

export function dome(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // The base, then the glass, then what floats in it.
  shape(ctx, [[24, 54], [76, 54], [72, 84], [28, 84]], pal.main);
  shape(ctx, oval(50, 40, 24, 22, 14), pal.light);
  if (!ctx.small) {
    const brain = [ngon(44, 40, 8, 8), ngon(56, 40, 8, 8), ngon(50, 34, 7, 8)][v]!;
    shape(ctx, brain, pal.second, false);
    stroke(ctx, [[34, 28], [38, 24]], "#ffffff", 1.6);
  }
  shape(ctx, [[30, 58], [70, 58], [70, 70], [30, 70]], pal.dark, false);
  eyes(ctx, { y: 64, dx: 11, size: 3.6, kind: "glow", skin: pal.dark, brows: false });
  if (!ctx.small) for (const x of [36, 50, 64]) shape(ctx, ngon(x, 78, 1.8, 6), pal.accent, false);
  return { top: 18, topW: 16, eyeY: 64, eyeDx: 11, chin: 84, chinW: 20 };
}

export function cyclops(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  const { mood, wary } = ctx.expr;
  shape(ctx, ngon(50, 52, 30, 8, Math.PI / 8), pal.main);
  if (!ctx.small) pair(ctx, [[22, 46], [16, 44], [16, 58], [22, 56]], pal.second);
  // One great eye, its lid and brow carrying the mood.
  const r = [11, 9, 12][v]!;
  shape(ctx, ngon(50, 46, r + 3, 12), pal.dark);
  shape(ctx, ngon(50, 46, r, 12), pal.light, false);
  const glance = mood === "sly" ? r * 0.35 : 0;
  shape(ctx, ngon(50 + glance, 46, wary ? r * 0.35 : r * 0.55, 10), pal.accent, false);
  shape(ctx, ngon(50 + glance, 46, r * 0.22, 6), pal.dark, false);
  if (mood === "calm" && !wary) shape(ctx, [[50 - r - 1, 46 - r - 2], [50 + r + 1, 46 - r - 2], [50 + r + 1, 44], [50 - r - 1, 44]], pal.main, false);
  if (mood === "fierce" && !ctx.small) pair(ctx, [[50 - r - 3, 46 - r - 6], [50, 46 - r + 1], [50, 46 - r - 2], [50 - r - 3, 46 - r - 9]], pal.dark, false);
  if (!ctx.small) mouth(ctx, 50, 70, 16, pal.dark);
  return { top: 22, topW: 16, eyeY: 46, eyeDx: 6, chin: 82, chinW: 16 };
}

export function crt(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A deep cabinet, a curved screen, knobs down the side.
  shape(ctx, [[20, 24], [80, 24], [80, 80], [20, 80]], pal.main);
  shape(ctx, [[26, 30], [64, 30], [66, 52], [64, 74], [26, 74], [24, 52]], pal.dark);
  if (!ctx.small) {
    for (const y of [36, 48]) shape(ctx, ngon(73, y, 3.4, 8), pal.second);
    for (let y = 60; y <= 72; y += 4) stroke(ctx, [[69, y], [77, y]], pal.dark, 1);
  }
  eyes(ctx, { y: 46, dx: 9, size: 3.8, kind: v === 1 ? "pixel" : "glow", skin: pal.dark, iris: pal.accent, brows: false });
  if (!ctx.small) mouth(ctx, 45, 62, 12, pal.accent);
  shape(ctx, [[30, 80], [36, 80], [34, 88], [30, 88]], pal.second); shape(ctx, [[64, 80], [70, 80], [70, 88], [66, 88]], pal.second);
  return { top: 24, topW: 24, eyeY: 46, eyeDx: 9, chin: 80, chinW: 26 };
}

export function drone(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // Arms out to two rotors, then the round body hanging under them.
  const arm = [26, 22, 30][v]!;
  stroke(ctx, [[50 - arm, 22], [50 + arm, 22]], pal.dark, 2.4);
  for (const s of [-1, 1]) {
    shape(ctx, [[50 + s * arm - 12, 18], [50 + s * arm + 12, 18], [50 + s * arm + 12, 21], [50 + s * arm - 12, 21]], pal.second);
    shape(ctx, ngon(50 + s * arm, 22, 2.6, 6), pal.dark, false);
  }
  stroke(ctx, [[50, 22], [50, 30]], pal.dark, 2.4);
  shape(ctx, ngon(50, 56, 26, 12), pal.main);
  shape(ctx, oval(50, 52, 18, 9, 12), pal.dark, false);
  eyes(ctx, { y: 52, dx: 8, size: 3.6, kind: "glow", skin: pal.dark, brows: false });
  if (!ctx.small) {
    shape(ctx, ngon(50, 70, 3, 6), pal.accent, false);
    pair(ctx, [[30, 76], [34, 82], [32, 84]], pal.dark, false);
  }
  return { top: 30, topW: 12, eyeY: 52, eyeDx: 8, chin: 82, chinW: 14 };
}

export function mech(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // An angular helmet, a fin down the middle, vents at the jaw.
  const fin = [10, 14, 6][v]!;
  shape(ctx, [[46, 30], [50, 30 - fin], [54, 30]], pal.second);
  shape(ctx, [[30, 26], [70, 26], [80, 44], [74, 74], [60, 86], [40, 86], [26, 74], [20, 44]], pal.main);
  shape(ctx, [[24, 42], [76, 42], [72, 52], [28, 52]], pal.dark);
  eyes(ctx, { y: 47, dx: 13, size: 4, kind: "glow", skin: pal.dark, brows: false });
  if (!ctx.small) {
    pair(ctx, [[30, 62], [42, 62], [42, 64], [30, 64]], pal.dark, false);
    pair(ctx, [[31, 67], [42, 67], [42, 69], [31, 69]], pal.dark, false);
    shape(ctx, [[44, 72], [56, 72], [54, 80], [46, 80]], pal.second);
  }
  return { top: 26, topW: 20, eyeY: 47, eyeDx: 13, chin: 86, chinW: 10 };
}

export function clockwork(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A gear behind the head, its teeth showing round the rim.
  const teeth: Pt[] = [];
  const n = [12, 10, 14][v]!;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 31 : 36;
    teeth.push([50 + Math.cos(a) * r, 52 + Math.sin(a) * r]);
  }
  shape(ctx, teeth, pal.second);
  shape(ctx, ngon(50, 52, 27, 16), pal.main);
  if (!ctx.small) {
    shape(ctx, ngon(66, 34, 6, 8), pal.second);
    shape(ctx, ngon(66, 34, 2, 6), pal.dark, false);
    for (const [x, y] of [[30, 52], [70, 52], [50, 30], [50, 75]] as Pt[]) shape(ctx, ngon(x, y, 1.5, 6), pal.dark, false);
  }
  eyes(ctx, { y: 48, dx: 10, size: 4, kind: "round", skin: pal.main, iris: pal.accent });
  if (!ctx.small) mouth(ctx, 50, 64, 12, pal.dark);
  return { top: 20, topW: 14, eyeY: 48, eyeDx: 10, chin: 82, chinW: 14 };
}

export function dish(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A dish on a short mast, tilted, over a squat head.
  const tilt = [-6, 0, 6][v]!;
  shape(ctx, [[30 + tilt, 22 - tilt * 0.3], [70 + tilt, 22 + tilt * 0.3], [62 + tilt, 30], [38 + tilt, 30]], pal.second);
  stroke(ctx, [[50 + tilt, 26], [50 + tilt, 14]], pal.dark, 1.6);
  shape(ctx, ngon(50 + tilt, 13, 2.6, 6), pal.accent);
  stroke(ctx, [[50, 30], [50, 38]], pal.dark, 3);
  shape(ctx, [[26, 38], [74, 38], [78, 64], [68, 82], [32, 82], [22, 64]], pal.main);
  eyes(ctx, { y: 54, dx: 12, size: 4.4, kind: "round", skin: pal.main, iris: pal.accent });
  if (!ctx.small) mouth(ctx, 50, 70, 14, pal.dark);
  return { top: 38, topW: 20, eyeY: 54, eyeDx: 12, chin: 82, chinW: 18 };
}

export function bulb(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // The screw base below, the glass above, the filament inside.
  shape(ctx, [[38, 72], [62, 72], [60, 88], [40, 88]], pal.second);
  if (!ctx.small) for (const y of [76, 80, 84]) stroke(ctx, [[39, y], [61, y - 2]], pal.dark, 1);
  shape(ctx, sym2([[50, 14], [34, 18], [24, 32], [24, 48], [32, 60], [38, 72], [50, 72]]), pal.light);
  if (!ctx.small) stroke(ctx, [[42, 70], [44, 58], [47, 62], [50, 56], [53, 62], [56, 58], [58, 70]], pal.accent, 1.4);
  eyes(ctx, { y: 40, dx: 10, size: [4, 3.4, 4.6][v]!, kind: "round", skin: pal.light, iris: pal.main });
  if (!ctx.small) mouth(ctx, 50, 52, 10, pal.dark);
  return { top: 14, topW: 14, eyeY: 40, eyeDx: 10, chin: 88, chinW: 10 };
}

export function astronaut(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A round helmet with a band of controls, the visor dark with a face behind it.
  if (!ctx.small) pair(ctx, [[18, 48], [12, 46], [12, 60], [18, 58]], pal.second);
  shape(ctx, ngon(50, 52, 32, 16), pal.light);
  shape(ctx, oval(50, 50, 22, 18, 14), pal.dark);
  eyes(ctx, { y: 50, dx: 9, size: 4, kind: "glow", skin: pal.dark, iris: pal.accent, brows: false });
  if (!ctx.small) {
    stroke(ctx, [[36, 40], [44, 36]], "#ffffff", 1.8);
    for (const [i, x] of [42, 50, 58].entries()) shape(ctx, ngon(x, 76, 2, 6), i === v ? pal.accent : pal.second, false);
  }
  return { top: 20, topW: 18, eyeY: 50, eyeDx: 9, chin: 84, chinW: 18 };
}

/** A symmetric outline from its left half, top centre to bottom centre. */
function sym2(left: Pt[]): Pt[] {
  return [...left, ...left.slice().reverse().map(([x, y]) => [100 - x, y] as Pt)];
}
