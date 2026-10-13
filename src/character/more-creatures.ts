import { eyes, mirror, mouth, ngon, oval, pair, shape, stroke, type Anchors, type Ctx, type Pt } from "./draw.js";

/**
 * More creatures, in the same geometric face-on style as creatures.ts: bear, rabbit, frog, bat,
 * panda, tiger, octopus, mouse, crocodile, penguin, monkey, hedgehog, axolotl. Each is told apart
 * by its outline - round ears, long ears, eye domes, fins, gills, spines - before its colours.
 * No horns on any of them.
 */

const sym = (left: Pt[]): Pt[] => [...left, ...left.slice().reverse().map(mirror)];

export function bear(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  const ear = [9, 7, 11][v]!;
  pair(ctx, ngon(29, 28, ear, 8, Math.PI / 8), pal.main);
  if (!ctx.small) pair(ctx, ngon(29, 28, ear * 0.5, 8, Math.PI / 8), pal.second, false);
  shape(ctx, ngon(50, 54, 29, 10, Math.PI / 10), pal.main);
  shape(ctx, oval(50, 69, 13, 10, 10), pal.light, false);
  eyes(ctx, { y: 48, dx: 11, size: 3.6, kind: "round", skin: pal.main, iris: pal.dark });
  shape(ctx, [[44, 62], [56, 62], [53, 67], [47, 67]], pal.dark);
  if (!ctx.small) mouth(ctx, 50, 74, 8, pal.dark);
  return { top: 26, topW: 18, eyeY: 48, eyeDx: 11, chin: 83, chinW: 12 };
}

export function rabbit(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // Long ears; one flops over on the second variant.
  const left: Pt[] = [[36, 32], [28, 4], [40, 2], [46, 30]];
  const right: Pt[] = v === 1 ? [[54, 30], [64, 14], [82, 18], [62, 32]] : left.map(mirror);
  shape(ctx, left, pal.main); shape(ctx, right, pal.main);
  if (!ctx.small) {
    shape(ctx, [[37, 28], [32, 8], [39, 7], [43, 28]], pal.second, false);
    if (v !== 1) shape(ctx, [[37, 28], [32, 8], [39, 7], [43, 28]].map(([x, y]) => mirror([x, y] as Pt)), pal.second, false);
  }
  shape(ctx, oval(50, 58, 25, 27, 12), pal.main);
  shape(ctx, sym([[38, 62], [32, 72], [42, 80], [50, 80]]), pal.light, false);
  eyes(ctx, { y: 52, dx: 11, size: 4.2, kind: "round", skin: pal.main, iris: pal.accent });
  shape(ctx, [[47, 64], [53, 64], [50, 68]], pal.second);
  if (!ctx.small) shape(ctx, [[47, 72], [53, 72], [53, 78], [47, 78]], pal.light);
  return { top: 31, topW: 16, eyeY: 52, eyeDx: 11, chin: 85, chinW: 10 };
}

export function frog(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  const wide = [0, 4, -3][v]!;
  shape(ctx, sym([[50, 38], [32, 38], [16 - wide, 52], [18 - wide, 68], [32, 80], [50, 82]]), pal.main);
  // The eyes sit up on domes, the widest thing above the mouth.
  pair(ctx, ngon(33, 36, 12, 10), pal.main);
  eyes(ctx, { y: 36, dx: 17, size: 5, kind: "round", skin: pal.main, iris: pal.accent, brows: false });
  if (!ctx.small) {
    pair(ctx, ngon(28, 64, 4.5, 8), pal.second, false);
    shape(ctx, ngon(46, 56, 1.4, 6), pal.dark, false); shape(ctx, ngon(54, 56, 1.4, 6), pal.dark, false);
  }
  stroke(ctx, [[30, 68], [40, 72], [50, 73], [60, 72], [70, 68]], pal.dark, ctx.small ? 3 : 1.8);
  return { top: 24, topW: 12, eyeY: 36, eyeDx: 17, chin: 82, chinW: 16 };
}

export function bat(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  const tip = [8, 4, 12][v]!;
  pair(ctx, [[30, 42], [16, tip], [44, 30]], pal.main);
  if (!ctx.small) pair(ctx, [[30, 38], [21, tip + 10], [40, 31]], pal.second, false);
  shape(ctx, sym([[42, 28], [28, 40], [26, 60], [36, 74], [44, 82], [50, 84]]), pal.main);
  eyes(ctx, { y: 50, dx: 10, size: 4, kind: "round", skin: pal.main, iris: pal.accent });
  // A leaf-shaped nose, and two fangs.
  shape(ctx, [[50, 56], [54, 62], [50, 66], [46, 62]], pal.second);
  if (!ctx.small) mouth(ctx, 50, 72, 10, pal.dark);
  pair(ctx, [[45, 73], [47, 73], [46, 79]], pal.light);
  return { top: 28, topW: 10, eyeY: 50, eyeDx: 10, chin: 84, chinW: 6 };
}

export function panda(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  pair(ctx, ngon(28, 27, 9, 8, Math.PI / 8), pal.main);
  shape(ctx, ngon(50, 55, 29, 12), pal.light);
  // The patches round the eyes, tilted down and out.
  const tilt = [0.5, 0.35, 0.65][v]!;
  pair(ctx, oval(38, 50, 8, 10, 10, -Math.PI / 2 - tilt), pal.main, false);
  eyes(ctx, { y: 49, dx: 12, size: 3.4, kind: "round", skin: pal.main, iris: pal.accent, brows: false });
  shape(ctx, [[45, 62], [55, 62], [52, 67], [48, 67]], pal.main);
  if (!ctx.small) mouth(ctx, 50, 73, 8, pal.main);
  return { top: 27, topW: 18, eyeY: 49, eyeDx: 12, chin: 84, chinW: 14 };
}

export function tiger(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  pair(ctx, [[28, 32], [24, 16], [40, 24]], pal.main);
  // A wide head with a ruff at the cheeks.
  shape(ctx, sym([[38, 22], [24, 32], [18, 50], [12, 62], [26, 70], [36, 82], [50, 86]]), pal.main);
  shape(ctx, sym([[40, 62], [32, 74], [42, 82], [50, 84]]), pal.light, false);
  if (!ctx.small) {
    // Stripes: down the brow, across the cheeks.
    for (const x of v === 1 ? [46, 50, 54] : [44, 50, 56]) stroke(ctx, [[x, 24], [x + (x - 50) * 0.3, 32]], pal.second, 2.2);
    pair(ctx, [[18, 52], [30, 54], [20, 56]], pal.second, false);
    pair(ctx, [[17, 60], [30, 60], [19, 63]], pal.second, false);
  }
  eyes(ctx, { y: 46, dx: 12, size: 4.2, kind: "almond", skin: pal.main, iris: pal.accent });
  shape(ctx, [[45, 60], [55, 60], [50, 66]], pal.dark);
  if (!ctx.small) mouth(ctx, 50, 72, 10, pal.dark);
  return { top: 22, topW: 14, eyeY: 46, eyeDx: 12, chin: 86, chinW: 8 };
}

export function octopus(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // Tentacles first, curling out under the mantle.
  const n = [4, 5, 6][v]!;
  for (let i = 0; i < n; i++) {
    const x = 26 + (i * 48) / (n - 1);
    const out = (x - 50) * 0.35;
    shape(ctx, [[x - 4, 66], [x + 4, 66], [x + 3 + out, 84], [x + out * 1.4, 92], [x - 3 + out, 86]], pal.second);
  }
  shape(ctx, oval(50, 46, 26, 30, 14), pal.main);
  if (!ctx.small) for (const [x, y, r] of [[38, 26, 3], [60, 22, 2.4], [66, 36, 2]] as [number, number, number][]) shape(ctx, ngon(x, y, r, 6), pal.light, false);
  eyes(ctx, { y: 54, dx: 11, size: 5, kind: "round", skin: pal.main, iris: pal.accent });
  if (!ctx.small) mouth(ctx, 50, 68, 8, pal.dark);
  return { top: 16, topW: 18, eyeY: 54, eyeDx: 11, chin: 76, chinW: 18 };
}

export function mouse(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  const ear = [14, 12, 16][v]!;
  pair(ctx, ngon(27, 32, ear, 10), pal.main);
  if (!ctx.small) pair(ctx, ngon(27, 32, ear * 0.6, 10), pal.second, false);
  shape(ctx, sym([[42, 30], [30, 42], [28, 58], [38, 72], [46, 82], [50, 84]]), pal.main);
  eyes(ctx, { y: 52, dx: 9, size: 3.6, kind: "round", skin: pal.main, iris: pal.dark });
  shape(ctx, ngon(50, 80, 3.2, 6), pal.accent);
  if (!ctx.small) {
    for (const s of [-1, 1]) for (const dy of [-2, 2]) stroke(ctx, [[50 + s * 8, 76 + dy], [50 + s * 24, 72 + dy * 2.2]], pal.dark, 0.9);
  }
  return { top: 32, topW: 12, eyeY: 52, eyeDx: 9, chin: 84, chinW: 4 };
}

export function crocodile(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A long, wide jaw, the eyes up on top of the head.
  shape(ctx, sym([[44, 26], [30, 30], [24, 46], [26, 66], [34, 84], [42, 92], [50, 93]]), pal.main);
  pair(ctx, ngon(36, 30, 8, 8), pal.main);
  eyes(ctx, { y: 30, dx: 14, size: 4, kind: "slit", skin: pal.main, iris: pal.accent, brows: false });
  if (!ctx.small) {
    for (const [x, y] of [[44, 44], [56, 44], [40, 54], [60, 54], [50, 50]] as Pt[]) shape(ctx, ngon(x, y, 2.2, 6), pal.second, false);
    // Teeth along both sides of the jaw.
    for (const s of [-1, 1]) for (let y = 62; y <= 84; y += 6) shape(ctx, [[50 + s * (24 - (y - 62) * 0.35), y], [50 + s * (20 - (y - 62) * 0.35), y + 2], [50 + s * (24 - (y - 62) * 0.35), y + 4]], pal.light, false);
  }
  pair(ctx, ngon(46, 88, 1.6, 6), pal.dark, false);
  if (v === 2 && !ctx.small) stroke(ctx, [[34, 66], [40, 72]], pal.dark, 1.2);
  return { top: 24, topW: 12, eyeY: 30, eyeDx: 14, chin: 93, chinW: 6 };
}

export function penguin(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  shape(ctx, oval(50, 52, 27, 32, 14), pal.main);
  // The white face, shaped like a heart, then the beak.
  shape(ctx, sym([[50, 32], [42, 28], [30, 34], [28, 52], [36, 70], [50, 80]]), pal.light, false);
  eyes(ctx, { y: 48, dx: 10, size: 3.6, kind: "round", skin: pal.light, iris: pal.dark });
  const beak = [[42, 58], [58, 58], [50, v === 1 ? 72 : 68]] as Pt[];
  shape(ctx, beak, pal.second);
  if (!ctx.small && v === 2) shape(ctx, [[30, 22], [50, 16], [70, 22], [60, 26], [40, 26]], pal.accent);
  return { top: 20, topW: 18, eyeY: 48, eyeDx: 10, chin: 84, chinW: 14 };
}

export function monkey(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  pair(ctx, ngon(19, 52, [9, 8, 10][v]!, 8), pal.main);
  if (!ctx.small) pair(ctx, ngon(19, 52, 5, 8), pal.second, false);
  shape(ctx, ngon(50, 52, 29, 12), pal.main);
  // The bare face: two rounds for the eyes, a wide muzzle below.
  pair(ctx, ngon(41, 48, 10, 10), pal.light, false);
  shape(ctx, oval(50, 66, 16, 11, 12), pal.light, false);
  eyes(ctx, { y: 48, dx: 9, size: 3.6, kind: "round", skin: pal.light, iris: pal.dark });
  pair(ctx, ngon(47, 62, 1.5, 6), pal.dark, false);
  if (!ctx.small) mouth(ctx, 50, 70, 12, pal.dark);
  return { top: 23, topW: 20, eyeY: 48, eyeDx: 9, chin: 81, chinW: 14 };
}

export function hedgehog(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // Spines all round the top of the head.
  const spines: Pt[] = [];
  const count = [9, 11, 7][v]!;
  for (let i = 0; i <= count * 2; i++) {
    const a = Math.PI + (i / (count * 2)) * Math.PI;
    const r = i % 2 ? 40 : 28;
    spines.push([50 + Math.cos(a) * r, 58 + Math.sin(a) * r * 0.95]);
  }
  shape(ctx, [...spines, [78, 64], [22, 64]], pal.second);
  shape(ctx, sym([[50, 34], [34, 40], [26, 54], [32, 68], [44, 80], [50, 86]]), pal.main);
  eyes(ctx, { y: 54, dx: 9, size: 3.4, kind: "round", skin: pal.main, iris: pal.dark });
  shape(ctx, ngon(50, 82, 3.4, 6), pal.dark);
  if (!ctx.small) mouth(ctx, 50, 74, 7, pal.dark);
  return { top: 20, topW: 16, eyeY: 54, eyeDx: 9, chin: 86, chinW: 4 };
}

export function axolotl(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // Three feathery gills each side, then a wide, flat head.
  const lift = [0, 4, -3][v]!;
  for (const [i, y] of [32, 44, 56].entries()) {
    const reach = [22, 26, 22][i]!;
    pair(ctx, [[30, y + 4], [30 - reach, y - 6 - lift], [30 - reach + 4, y + 2 - lift], [28, y + 8]], pal.second);
  }
  shape(ctx, sym([[50, 30], [34, 32], [22, 46], [24, 64], [36, 76], [50, 78]]), pal.main);
  eyes(ctx, { y: 50, dx: 15, size: 3, kind: "round", skin: pal.main, iris: pal.dark, brows: false });
  if (!ctx.small) pair(ctx, ngon(33, 62, 3.6, 8), pal.light, false);
  stroke(ctx, [[38, 64], [44, 68], [50, 69], [56, 68], [62, 64]], pal.dark, ctx.small ? 3 : 1.6);
  return { top: 30, topW: 16, eyeY: 50, eyeDx: 15, chin: 78, chinW: 14 };
}
