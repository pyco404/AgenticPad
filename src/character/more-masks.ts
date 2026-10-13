import { eyes, mirror, mouth, ngon, oval, pair, shape, stroke, type Anchors, type Ctx, type Pt } from "./draw.js";

/**
 * More masked players, in the style of masks.ts: a skull, a jester, a knight's helm, a samurai's
 * face guard, a wrestler's mask, a carved tiki, a ninja's wrap, a gas mask, a diver's helmet.
 * No horns, and no crest that reads as horns.
 */

const sym = (left: Pt[]): Pt[] => [...left, ...left.slice().reverse().map(mirror)];

export function skull(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  shape(ctx, sym([[50, 18], [34, 20], [24, 34], [24, 54], [32, 64], [34, 76], [44, 82], [50, 82]]), pal.light);
  // Deep sockets, a nose cut out, a row of teeth.
  pair(ctx, ngon(38, 46, 9, 8), pal.dark, false);
  eyes(ctx, { y: 46, dx: 12, size: 3.4, kind: "glow", skin: pal.dark, iris: pal.accent, brows: false });
  shape(ctx, [[50, 54], [54, 62], [46, 62]], pal.dark, false);
  if (!ctx.small) {
    for (let x = 38; x <= 58; x += 5) stroke(ctx, [[x, 68], [x, 76]], pal.dark, 1.2);
    stroke(ctx, [[36, 72], [64, 72]], pal.dark, 1.2);
    if (v === 1) stroke(ctx, [[58, 22], [54, 30], [60, 34]], pal.dark, 1.2);
    if (v === 2) shape(ctx, [[30, 30], [42, 24], [36, 34]], pal.main, false);
  }
  return { top: 18, topW: 18, eyeY: 46, eyeDx: 12, chin: 82, chinW: 8 };
}

export function jester(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A cap of three soft points, each with a bell, over a painted face.
  const tips: Pt[] = v === 1 ? [[14, 30], [50, 4], [86, 30]] : [[12, 22], [50, 8], [88, 22]];
  shape(ctx, [[28, 36], tips[0]!, [40, 26], tips[1]!, [60, 26], tips[2]!, [72, 36]], pal.main);
  if (!ctx.small) shape(ctx, [[50, 8], [60, 26], [50, 34], [40, 26]], pal.second, false);
  for (const t of tips) shape(ctx, ngon(t[0], t[1] + 3, 3.4, 8), pal.accent);
  shape(ctx, sym([[50, 34], [32, 36], [28, 54], [36, 72], [50, 80]]), pal.light);
  if (!ctx.small) pair(ctx, [[34, 54], [38, 48], [42, 54], [38, 60]], pal.second, false);
  eyes(ctx, { y: 48, dx: 10, size: 3.8, kind: "almond", skin: pal.light, iris: pal.accent });
  if (!ctx.small) mouth(ctx, 50, 68, 12, pal.dark);
  return { top: 34, topW: 18, eyeY: 48, eyeDx: 10, chin: 80, chinW: 10 };
}

export function knight(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A great helm: a flat crown, a slit to see through, breaths below.
  shape(ctx, [[28, 20], [72, 20], [76, 30], [76, 76], [64, 86], [36, 86], [24, 76], [24, 30]], pal.main);
  if (!ctx.small) shape(ctx, [[48, 20], [52, 20], [52, 86], [48, 86]], pal.second, false);
  shape(ctx, [[26, 42], [74, 42], [74, 50], [26, 50]], pal.dark);
  eyes(ctx, { y: 46, dx: 12, size: 3.2, kind: "glow", skin: pal.dark, iris: pal.accent, brows: false });
  if (!ctx.small) {
    for (const s of [-1, 1]) for (let i = 0; i < [3, 4, 2][v]!; i++) shape(ctx, [[50 + s * (8 + i * 4), 60], [50 + s * (10 + i * 4), 60], [50 + s * (10 + i * 4), 70], [50 + s * (8 + i * 4), 70]], pal.dark, false);
    for (const [x, y] of [[30, 26], [70, 26], [30, 80], [70, 80]] as Pt[]) shape(ctx, ngon(x, y, 1.4, 6), pal.light, false);
  }
  return { top: 20, topW: 20, eyeY: 46, eyeDx: 12, chin: 86, chinW: 14 };
}

export function samurai(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A low helmet with flared neck guards and a round crest, then the face guard below the eyes.
  pair(ctx, [[26, 36], [10, 58], [16, 64], [30, 50]], pal.second);
  shape(ctx, [[22, 36], [30, 22], [70, 22], [78, 36]], pal.main);
  shape(ctx, ngon(50, 18, [5, 6, 4][v]!, 10), pal.accent);
  shape(ctx, sym([[50, 36], [32, 36], [28, 52], [34, 58], [50, 60]]), pal.light);
  eyes(ctx, { y: 46, dx: 10, size: 3.8, kind: "almond", skin: pal.light, iris: pal.dark });
  // The menpo: a grim half-face, with a moustache cut into it.
  shape(ctx, sym([[50, 56], [32, 56], [30, 66], [38, 80], [50, 84]]), pal.dark);
  if (!ctx.small) {
    pair(ctx, [[42, 64], [32, 66], [40, 62], [48, 61]], pal.second, false);
    for (const y of [72, 76]) stroke(ctx, [[42, y], [58, y]], pal.second, 1);
  }
  return { top: 22, topW: 18, eyeY: 46, eyeDx: 10, chin: 84, chinW: 10 };
}

export function luchador(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  shape(ctx, sym([[50, 16], [34, 20], [24, 36], [24, 58], [32, 74], [44, 84], [50, 86]]), pal.main);
  // Flames or wings round the eyes in a second colour, and a trim round the mouth.
  const flare: Pt[] = v === 2 ? [[26, 42], [36, 36], [46, 40], [46, 54], [34, 56]] : [[22, 34], [36, 38], [46, 42], [44, 54], [30, 56], [26, 48]];
  pair(ctx, flare, pal.second);
  eyes(ctx, { y: 47, dx: 12, size: 3.8, kind: "almond", skin: pal.second, iris: pal.accent });
  if (!ctx.small) shape(ctx, [[50, 20], [56, 30], [50, 40], [44, 30]], pal.accent, false);
  shape(ctx, oval(50, 70, 11, 7, 10), pal.second);
  if (!ctx.small) mouth(ctx, 50, 70, 10, pal.dark);
  return { top: 16, topW: 14, eyeY: 47, eyeDx: 12, chin: 86, chinW: 8 };
}

export function tiki(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A tall carved plank with a crown of leaves.
  const leaves = [3, 4, 5][v]!;
  for (let i = 0; i < leaves; i++) {
    const x = 34 + (i * 32) / (leaves - 1);
    shape(ctx, [[x - 4, 20], [x + (x - 50) * 0.3, 4], [x + 4, 20]], pal.second);
  }
  shape(ctx, [[30, 18], [70, 18], [72, 86], [28, 86]], pal.main);
  if (!ctx.small) for (const y of [34, 62]) stroke(ctx, [[30, y], [70, y]], pal.dark, 1.2);
  // Wide eyes ringed in a carved band, a big flat nose, a grimacing mouth.
  pair(ctx, ngon(38, 46, 9, 10), pal.light);
  eyes(ctx, { y: 46, dx: 12, size: 4.2, kind: "round", skin: pal.light, iris: pal.dark, brows: false });
  shape(ctx, [[44, 52], [56, 52], [60, 62], [40, 62]], pal.second);
  shape(ctx, [[34, 68], [66, 68], [62, 80], [38, 80]], pal.dark);
  if (!ctx.small) for (let x = 38; x <= 60; x += 5.5) shape(ctx, [[x, 69], [x + 3, 69], [x + 1.5, 73]], pal.light, false);
  return { top: 18, topW: 20, eyeY: 46, eyeDx: 12, chin: 86, chinW: 20 };
}

export function ninja(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A wrapped head, the tails of the knot behind, a band of skin for the eyes.
  if (!ctx.small) shape(ctx, [[70, 30], [88, [24, 34, 40][v]!], [84, 40], [70, 38]], pal.main);
  shape(ctx, sym([[50, 16], [34, 20], [24, 36], [24, 60], [32, 76], [44, 86], [50, 88]]), pal.main);
  shape(ctx, [[26, 40], [74, 40], [72, 54], [28, 54]], pal.light);
  eyes(ctx, { y: 47, dx: 11, size: 3.8, kind: "almond", skin: pal.light, iris: pal.dark });
  if (!ctx.small) {
    stroke(ctx, [[24, 34], [76, 34]], pal.second, 2.2);
    for (const y of [64, 72]) stroke(ctx, [[34, y], [66, y]], pal.dark, 0.9);
  }
  return { top: 16, topW: 16, eyeY: 47, eyeDx: 11, chin: 88, chinW: 8 };
}

export function gasmask(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A hood, two round lenses, and the filter at the snout.
  shape(ctx, sym([[50, 18], [32, 22], [22, 40], [24, 62], [34, 78], [50, 82]]), pal.main);
  pair(ctx, ngon(38, 46, 10, 12), pal.second);
  pair(ctx, ngon(38, 46, 7, 12), pal.dark, false);
  eyes(ctx, { y: 46, dx: 12, size: 3.6, kind: "glow", skin: pal.dark, iris: pal.accent, brows: false });
  const r = [9, 8, 10][v]!;
  shape(ctx, [[44, 60], [56, 60], [58, 68], [42, 68]], pal.second);
  shape(ctx, ngon(50, 74, r, 10), pal.second);
  if (!ctx.small) {
    shape(ctx, ngon(50, 74, r * 0.6, 10), pal.dark, false);
    for (let a = 0; a < 6; a++) stroke(ctx, [[50, 74], [50 + Math.cos(a) * r * 0.55, 74 + Math.sin(a) * r * 0.55]], pal.second, 0.8);
  }
  return { top: 18, topW: 16, eyeY: 46, eyeDx: 12, chin: 84, chinW: 10 };
}

export function diver(ctx: Ctx, v: number): Anchors {
  const { pal } = ctx;
  // A brass helmet: round, bolted, with a porthole for the face and small ports at the sides.
  shape(ctx, ngon(50, 50, 33, 16), pal.main);
  if (!ctx.small) pair(ctx, ngon(22, 50, 6, 10), pal.second);
  shape(ctx, ngon(50, 50, 21, 14), pal.second);
  // Clear glass, the face showing through it: an astronaut's visor is the dark one.
  shape(ctx, ngon(50, 50, 17, 14), pal.light);
  eyes(ctx, { y: 48, dx: 8, size: 3.6, kind: "round", skin: pal.light, iris: pal.dark });
  if (!ctx.small) mouth(ctx, 50, 58, 8, pal.dark);
  if (!ctx.small) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      shape(ctx, ngon(50 + Math.cos(a) * 19, 50 + Math.sin(a) * 19, 1.4, 6), pal.light, false);
    }
    stroke(ctx, [[42, 42], [46, 38]], "#ffffff", 1.4);
    if (v !== 1) shape(ctx, [[44, 82], [56, 82], [56, 88], [44, 88]], pal.second);
  }
  return { top: 17, topW: 18, eyeY: 48, eyeDx: 8, chin: 84, chinW: 20 };
}
