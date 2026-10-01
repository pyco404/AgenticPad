import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Draws the village's AgentClash art: the arena, the leaderboard, the Game
 * Hall's screens, the Strategy Lab's boards, banners and flags bearing the
 * crest, and the small things of the agent grounds. Everything lands in
 * web/public/village/agentclash; nothing here runs at request time.
 *
 *   npx tsx scripts/village-art.ts
 *
 * The crest is web/public/agentclash-tb.png, scaled down and never redrawn.
 * The rest is drawn here in the Tiny Swords pack's palette (the teal stone,
 * the wood, the thatch) and the crest's own greens, outlined like the pack,
 * at one art pixel to two world pixels - the scene draws these at scale 2.
 * Three of the pack's buildings are recoloured rather than redrawn: the
 * castle and the tower fly the crest's colours, and the old arena hut's
 * "ARENA" sign becomes a match screen for the Game Hall.
 *
 * No dependencies: a small PNG reader and writer on node:zlib.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "web/public");
const out = join(pub, "village/agentclash");

// --- PNG ---------------------------------------------------------------------

type RGBA = [number, number, number, number];

function readPng(path: string): Raster {
  const buf = readFileSync(path);
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`${path}: only 8-bit PNGs`);
      colourType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alpha = data;
    else if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`${path}: colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const img = new Raster(width, height);
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = pw * channels;
    let prev = new Uint8Array(stride);
    for (let r = 0; r < ph; r++) {
      const filter = raw[pos++]!;
      const line = new Uint8Array(raw.subarray(pos, pos + stride));
      pos += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? line[i - channels]! : 0;
        const b = prev[i]!;
        const c = i >= channels ? prev[i - channels]! : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        line[i] = (line[i]! + add) & 255;
      }
      for (let k = 0; k < pw; k++) {
        const s = k * channels;
        let px: RGBA;
        if (colourType === 6) px = [line[s]!, line[s + 1]!, line[s + 2]!, line[s + 3]!];
        else if (colourType === 2) px = [line[s]!, line[s + 1]!, line[s + 2]!, 255];
        else if (colourType === 4) px = [line[s]!, line[s]!, line[s]!, line[s + 1]!];
        else if (colourType === 0) px = [line[s]!, line[s]!, line[s]!, 255];
        else {
          const i = line[s]!;
          px = [palette![i * 3]!, palette![i * 3 + 1]!, palette![i * 3 + 2]!, alpha && i < alpha.length ? alpha[i]! : 255];
        }
        img.set(x0 + k * dx, y0 + r * dy, px);
      }
      prev = line;
    }
  }
  return img;
}

function writePng(path: string, img: Raster): void {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    rows[y * (img.w * 4 + 1)] = 0;
    Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(rows, y * (img.w * 4 + 1) + 1);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(path, Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

// --- Drawing -----------------------------------------------------------------

const hex = (s: string, a = 255): RGBA => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];

class Raster {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }
  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }
  set(x: number, y: number, c: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data.set(c, i);
  }
  /** Over what is there: a translucent colour tints rather than replaces. */
  put(x: number, y: number, c: RGBA): void {
    if (c[3] >= 255) return this.set(x, y, c);
    if (c[3] <= 0) return;
    const [r, g, b, a] = this.get(Math.round(x), Math.round(y));
    const sa = c[3] / 255;
    const oa = sa + (a / 255) * (1 - sa);
    if (oa <= 0) return;
    const mix = (s: number, d: number) => Math.round((s * sa + (d * (a / 255) * (1 - sa))) / oa);
    this.set(x, y, [mix(c[0], r), mix(c[1], g), mix(c[2], b), Math.round(oa * 255)]);
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (inEllipse(x, y, cx, cy, rx, ry)) this.put(x, y, c);
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.put(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c);
    return this;
  }
  blit(src: Raster, dx: number, dy: number, alpha = 1): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.put(dx + x, dy + y, [c[0], c[1], c[2], Math.round(c[3] * alpha)]);
      }
    }
    return this;
  }
  /** A one-pixel line round everything drawn, as the pack outlines its art. */
  outline(c: RGBA = P.ink): this {
    const solid = (x: number, y: number) => this.get(x, y)[3] >= 128;
    const edge: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, c);
    return this;
  }
  clone(): Raster {
    const r = new Raster(this.w, this.h);
    r.data.set(this.data);
    return r;
  }
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

/** A deterministic random stream, so the art is the same on every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-averaged, so the crest's shapes survive being made small; then its edge made hard again, as pixel art's is. */
function scaled(src: Raster, w: number): Raster {
  const h = Math.max(1, Math.round((src.h * w) / src.w));
  const img = new Raster(w, h);
  const sx = src.w / w;
  const sy = src.h / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = Math.floor(y * sy); j < Math.ceil((y + 1) * sy); j++) {
        for (let i = Math.floor(x * sx); i < Math.ceil((x + 1) * sx); i++) {
          const c = src.get(i, j);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = Math.ceil((y + 1) * sy - Math.floor(y * sy)) * Math.ceil((x + 1) * sx - Math.floor(x * sx));
      if (a / n < 100) continue;
      img.set(x, y, [Math.round(r / a), Math.round(g / a), Math.round(b / a), 255]);
    }
  }
  return img;
}

// --- Palette -----------------------------------------------------------------

/** The pack's own colours (sampled from its buildings) and the crest's. */
const P = {
  ink: hex("#151228"),
  // The crest.
  navy: hex("#001727"),
  deep: hex("#00374d"),
  dteal: hex("#015f68"),
  teal: hex("#189b68"),
  green: hex("#5dcd50"),
  lime: hex("#9ae352"),
  glow: hex("#d9f958"),
  // The pack's teal stone.
  stoneHi: hex("#8cdeb8"),
  stone: hex("#55a1ab"),
  stoneLo: hex("#45718a"),
  stoneDk: hex("#355163"),
  stoneDeep: hex("#2d324b"),
  // Wood and thatch.
  thatch: hex("#efdb97"),
  woodHi: hex("#d7ad6e"),
  wood: hex("#b68357"),
  woodMid: hex("#9b7051"),
  woodLo: hex("#6b4a3e"),
  woodDk: hex("#493a58"),
  // The arena's floor.
  sandHi: hex("#f0dca4"),
  sand: hex("#e4c88f"),
  sandLo: hex("#d2b07a"),
  sandDk: hex("#b8955f"),
  // Prizes.
  goldHi: hex("#fbe7a1"),
  gold: hex("#e8b84b"),
  goldLo: hex("#b07a2a"),
  silver: hex("#c9d3dc"),
  bronze: hex("#c9844b"),
  red: hex("#d4745a"),
  redHi: hex("#ff5a4a"),
  redDk: hex("#7a2b2b"),
  screen: hex("#0e1f2e"),
  paper: hex("#efe2c0"),
  white: hex("#f5ecd8"),
};

/** What the crowd and the little agents wear: the site's colours and a few more. */
const WEAR = ["#5dcd50", "#189b68", "#e8b84b", "#d4745a", "#8f7bd8", "#4a6fa5", "#efdb97", "#9ae352", "#c95b8c", "#f5ecd8"].map((c) => hex(c));
const SKIN = ["#f1c9a5", "#d9a47c", "#a8714f", "#7a4e38"].map((c) => hex(c));

const CREST = readPng(join(pub, "agentclash-tb.png"));
const crest = (w: number) => scaled(CREST, w);

// --- Pieces ------------------------------------------------------------------

/** A banner hanging from a crossbar on a pole, the crest on its cloth. */
function banner(cloth: RGBA, shade: RGBA, trim: RGBA, cw = 14, ch = 26): Raster {
  const w = cw + 6;
  const h = ch + 22;
  const img = new Raster(w, h);
  const mid = Math.floor(w / 2);
  img.rect(mid - 1, 3, 2, h - 3, P.woodMid).rect(mid - 1, 3, 1, h - 3, P.woodHi);
  img.rect(mid - 2, 0, 4, 3, P.gold).rect(mid - 1, 0, 2, 1, P.goldHi);
  img.rect(1, 5, w - 2, 2, P.woodLo);
  const x0 = 3;
  const y0 = 7;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      // A swallowtail: a notch cut up into the bottom.
      const notch = ch - 1 - y < 5 - Math.abs(x - (cw - 1) / 2) * 0.9;
      if (notch) continue;
      img.set(x0 + x, y0 + y, x === 0 || x === cw - 1 ? shade : cloth);
    }
  }
  // A gold edge along the bottom and down the sides.
  for (let x = 0; x < cw; x++) {
    for (let y = ch - 1; y >= 0; y--) {
      if (img.get(x0 + x, y0 + y)[3] > 0) {
        img.set(x0 + x, y0 + y, trim);
        break;
      }
    }
  }
  img.rect(x0, y0, cw, 1, trim);
  const c = crest(cw - 2);
  img.blit(c, x0 + 1, y0 + 3);
  return img.outline();
}

/** A flag on a tall pole, in two frames of a slow wave. */
function flagSheet(): Raster {
  const fw = 28;
  const fh = 58;
  const sheet = new Raster(fw * 2, fh);
  const c = crest(13);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    img.rect(3, 4, 2, fh - 4, P.woodMid).rect(3, 4, 1, fh - 4, P.woodHi);
    img.rect(2, 1, 4, 3, P.gold);
    const cloth = new Raster(fw, fh);
    for (let x = 0; x < 21; x++) {
      const dy = Math.round(Math.sin((x / 21) * Math.PI * 1.3 + f * Math.PI) * 1.4 * (x / 21));
      for (let y = 0; y < 14; y++) cloth.set(5 + x, 5 + y + dy, y < 7 ? P.teal : P.dteal);
      cloth.set(5 + x, 5 + dy, P.lime);
    }
    cloth.blit(c, 9, 7 + Math.round(Math.sin(0.4 * Math.PI * 1.3 + f * Math.PI) * 0.6));
    img.blit(cloth, 0, 0);
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/**
 * The leaderboard: the crest, a podium of three, the ranks below them with a
 * bar for each, a live light and an arrow for climbing. Two frames: the light
 * blinks and the arrow glows.
 */
function leaderboardSheet(): Raster {
  const fw = 84;
  const fh = 74;
  const sheet = new Raster(fw * 2, fh);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    // Posts, then a roof of the pack's teal shingles.
    for (const x of [8, 72]) img.rect(x, 14, 4, fh - 15, P.woodMid).rect(x, 14, 1, fh - 15, P.woodHi);
    for (let y = 2; y < 13; y++) {
      const inset = Math.max(0, 12 - y) * 0.6;
      img.rect(Math.round(3 + inset), y, Math.round(fw - 6 - inset * 2), 1, y % 3 === 0 ? P.stoneDk : y < 6 ? P.stone : P.stoneLo);
    }
    img.rect(3, 12, fw - 6, 1, P.stoneDeep);
    // The board: a gold frame, the dark face.
    img.rect(5, 14, fw - 10, 46, P.goldLo).rect(6, 15, fw - 12, 44, P.gold).rect(8, 17, fw - 16, 40, P.screen);
    img.blit(crest(24), Math.round(fw / 2 - 12), 18);
    // The live light, top left; the arrow, top right.
    img.rect(11, 20, 4, 4, f === 0 ? P.redHi : P.redDk);
    if (f === 0) img.rect(12, 20, 1, 1, P.white);
    const arrow = f === 0 ? P.lime : P.glow;
    for (let k = 0; k < 4; k++) img.rect(69 - k, 20 + k, 1 + k * 2, 1, arrow);
    img.rect(68, 24, 3, 4, arrow);
    // The podium.
    const steps: [number, number, RGBA, number][] = [
      [11, 9, P.silver, 9],
      [20, 13, P.gold, 13],
      [33, 6, P.bronze, 9],
    ];
    for (const [x, hgt, colour, w] of steps) {
      const top = 55 - hgt;
      img.rect(x, top, w, hgt, colour).rect(x, top, w, 1, P.white);
      img.rect(x + Math.floor(w / 2) - 1, top - 4, 3, 3, SKIN[(x / 11) % SKIN.length | 0]!);
      img.rect(x + Math.floor(w / 2) - 2, top - 1, 5, 1, WEAR[x % WEAR.length]!);
    }
    img.rect(24, 36, 1, 1, P.gold).rect(26, 36, 1, 1, P.gold).rect(28, 36, 1, 1, P.gold).rect(24, 37, 5, 1, P.gold);
    // The ranks.
    const ranks: [RGBA, number][] = [
      [P.gold, 22],
      [P.silver, 17],
      [P.bronze, 13],
      [P.teal, 9],
      [P.teal, 6],
    ];
    ranks.forEach(([pip, len], i) => {
      const y = 35 + i * 4;
      img.rect(45, y, 3, 3, pip);
      img.rect(50, y, 3, 3, WEAR[(i * 3 + 1) % WEAR.length]!);
      img.rect(55, y, len, 3, i === 0 && f === 1 ? P.glow : P.green).rect(55, y, len, 1, P.lime);
    });
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/** A tiny agent in profile on a screen: head, body, facing in. */
function tinyAgent(img: Raster, x: number, y: number, skin: RGBA, wear: RGBA): void {
  img.rect(x, y, 4, 4, skin).rect(x - 1, y + 4, 6, 5, wear).rect(x, y + 9, 1, 2, wear).rect(x + 3, y + 9, 1, 2, wear);
}

/** The Game Hall's screens: two matches playing, each with its score lights. Two frames: a point scored, the live light blinking. */
function scoreboardSheet(): Raster {
  const fw = 66;
  const fh = 66;
  const sheet = new Raster(fw * 2, fh);
  for (let f = 0; f < 2; f++) {
    const img = new Raster(fw, fh);
    for (const x of [9, 54]) img.rect(x, 30, 3, fh - 31, P.woodMid).rect(x, 30, 1, fh - 31, P.woodHi);
    img.rect(3, 3, fw - 6, 44, P.stoneDk).rect(4, 4, fw - 8, 42, P.stone).rect(4, 4, fw - 8, 1, P.stoneHi);
    img.rect(6, 6, fw - 12, 38, P.navy);
    img.blit(crest(14), Math.round(fw / 2 - 7), 7);
    img.rect(9, 9, 3, 3, f === 0 ? P.redHi : P.redDk);
    for (const [sx, a, b, lit] of [
      [8, 0, 4, 2 + f],
      [34, 6, 3, 1 + f],
    ] as const) {
      img.rect(sx, 18, 24, 24, P.teal).rect(sx + 1, 19, 22, 22, hex("#0a2a2a"));
      tinyAgent(img, sx + 3, 23, SKIN[a % SKIN.length]!, WEAR[a]!);
      tinyAgent(img, sx + 17, 23, SKIN[(b + 1) % SKIN.length]!, WEAR[b]!);
      // The clash between them.
      const spark = f === 0 ? P.gold : P.glow;
      img.rect(sx + 11, 26, 2, 2, spark).rect(sx + 10, 27, 4, 1, spark).rect(sx + 11, 25, 1, 4, spark);
      for (let k = 0; k < 3; k++) {
        img.rect(sx + 3 + k * 3, 37, 2, 2, k < lit ? P.lime : P.stoneDk);
        img.rect(sx + 14 + k * 3, 37, 2, 2, k < 3 - lit + f ? P.lime : P.stoneDk);
      }
    }
    img.outline();
    sheet.blit(img, f * fw, 0);
  }
  return sheet;
}

/** The planning table: a map of the field, routes drawn on it, pieces placed. */
function warTable(): Raster {
  const img = new Raster(46, 32);
  for (const x of [3, 39]) img.rect(x, 20, 4, 11, P.woodLo);
  img.rect(0, 6, 46, 16, P.wood).rect(0, 6, 46, 1, P.woodHi).rect(0, 19, 46, 3, P.woodMid);
  img.rect(3, 8, 40, 10, hex("#2f6b5a")).rect(3, 8, 40, 1, hex("#3f8a6f"));
  // Routes and a target.
  img.line(6, 15, 15, 11, P.lime).line(15, 11, 24, 14, P.lime).line(24, 14, 34, 10, P.glow);
  img.line(8, 10, 18, 16, P.paper).line(18, 16, 30, 16, P.paper);
  img.rect(35, 9, 4, 4, P.redHi).rect(36, 10, 2, 2, P.white);
  // Pieces.
  for (const [x, y, c] of [
    [10, 12, P.gold],
    [20, 9, P.redHi],
    [27, 15, P.white],
    [14, 15, P.teal],
  ] as const) img.rect(x, y - 2, 2, 3, c).rect(x, y - 3, 2, 1, P.ink);
  return img.outline();
}

/**
 * The strategy board, on an easel: a decision tree in chalk, its leaves the
 * three choices a strategy makes - fold, call, raise.
 */
function strategyBoard(): Raster {
  const img = new Raster(42, 50);
  img.line(9, 49, 14, 3, P.woodMid).line(10, 49, 15, 3, P.woodLo);
  img.line(33, 49, 28, 3, P.woodMid).line(32, 49, 27, 3, P.woodLo);
  img.rect(4, 4, 34, 28, P.wood).rect(5, 5, 32, 26, hex("#1f3d3a"));
  img.rect(4, 32, 34, 2, P.woodHi);
  const box = (x: number, y: number, c: RGBA) => img.rect(x, y, 6, 4, c);
  box(18, 7, P.white);
  img.line(20, 11, 11, 15, P.paper).line(23, 11, 30, 15, P.paper);
  box(8, 15, P.paper);
  box(27, 15, P.paper);
  img.line(10, 19, 8, 23, P.paper).line(12, 19, 15, 23, P.paper).line(29, 19, 26, 23, P.paper).line(31, 19, 33, 23, P.paper);
  for (const [x, c] of [
    [6, P.red],
    [13, P.lime],
    [24, P.gold],
    [31, P.lime],
  ] as const) img.rect(x, 23, 4, 4, c);
  img.rect(6, 33, 4, 1, P.white).rect(12, 33, 3, 1, P.glow);
  return img.outline();
}

/** The Hiring Hall's board: three agents for hire, one picked out in gold. */
function hiringBoard(): Raster {
  const img = new Raster(56, 50);
  for (const x of [5, 47]) img.rect(x, 12, 4, 37, P.woodMid).rect(x, 12, 1, 37, P.woodHi);
  img.rect(2, 10, 52, 30, P.woodLo).rect(3, 11, 50, 28, P.wood).rect(3, 11, 50, 1, P.woodHi);
  img.rect(14, 0, 28, 10, P.dteal).rect(15, 1, 26, 8, P.teal);
  img.blit(crest(14), 21, 1);
  [6, 21, 36].forEach((x, i) => {
    const picked = i === 1;
    if (picked) img.rect(x - 1, 13, 16, 22, P.gold);
    img.rect(x, 14, 14, 20, P.paper);
    img.rect(x + 4, 17, 6, 6, SKIN[(i + 1) % SKIN.length]!).rect(x + 2, 23, 10, 7, WEAR[[3, 0, 4][i]!]!);
    img.rect(x + 2, 31, 10, 1, P.woodLo);
  });
  // A check over the picked one.
  img.line(26, 6, 28, 8, P.glow).line(28, 8, 32, 3, P.glow);
  return img.outline();
}

/** A champion in gold on a stone plinth, the crest held up. */
function statue(): Raster {
  const img = new Raster(26, 60);
  img.rect(3, 42, 20, 17, P.stone).rect(3, 42, 20, 2, P.stoneHi).rect(3, 55, 20, 4, P.stoneLo).rect(2, 40, 22, 3, P.stoneHi);
  img.rect(9, 48, 8, 4, P.gold).rect(10, 49, 6, 1, P.goldHi);
  // The figure.
  img.rect(10, 31, 3, 9, P.goldLo).rect(14, 31, 3, 9, P.gold);
  img.rect(9, 20, 9, 12, P.gold).rect(9, 20, 2, 12, P.goldLo).rect(16, 21, 2, 10, P.goldHi);
  img.rect(10, 13, 7, 7, P.gold).rect(11, 14, 2, 2, P.goldHi);
  img.rect(6, 21, 3, 8, P.goldLo);
  img.rect(18, 10, 3, 11, P.gold);
  img.blit(crest(12), 14, 2);
  return img.outline();
}

/** A gold cup on a stone pillar. */
function trophy(): Raster {
  const img = new Raster(18, 34);
  img.rect(4, 16, 10, 17, P.stone).rect(4, 16, 10, 2, P.stoneHi).rect(4, 30, 10, 3, P.stoneLo).rect(3, 15, 12, 2, P.stoneHi);
  img.rect(4, 3, 10, 7, P.gold).rect(5, 4, 2, 5, P.goldHi).rect(5, 10, 8, 1, P.goldLo).rect(7, 11, 4, 2, P.gold).rect(5, 13, 8, 2, P.goldLo);
  img.rect(1, 4, 3, 1, P.gold).rect(1, 4, 1, 4, P.gold).rect(14, 4, 3, 1, P.gold).rect(16, 4, 1, 4, P.gold);
  return img.outline();
}

/** A treasure chest, open and heaped with coins, or shut. */
function chest(open: boolean): Raster {
  const img = new Raster(28, 24);
  const top = open ? 10 : 8;
  if (open) {
    img.rect(3, 1, 22, 8, P.woodLo).rect(4, 2, 20, 6, P.woodMid).rect(3, 4, 22, 1, P.gold);
    img.ellipse(14, 11, 11, 4, P.gold).ellipse(13, 10, 6, 2, P.goldHi);
    img.rect(9, 8, 1, 1, P.white).rect(19, 9, 1, 1, P.white);
  } else {
    img.ellipse(14, 9, 11, 4, P.woodMid).rect(3, 8, 22, 2, P.woodMid).rect(3, 7, 22, 1, P.wood);
  }
  img.rect(3, top + 1, 22, 11, P.wood).rect(3, top + 1, 22, 2, P.woodHi).rect(3, top + 10, 22, 2, P.woodLo);
  for (const x of [5, 20]) img.rect(x, top + 1, 3, 11, P.gold).rect(x, top + 1, 1, 11, P.goldHi);
  img.rect(12, top + 4, 4, 4, P.goldLo).rect(13, top + 5, 2, 2, P.ink);
  return img.outline();
}

function coins(): Raster {
  const img = new Raster(18, 10);
  img.ellipse(9, 6, 8, 3, P.goldLo).ellipse(8, 5, 6, 2.5, P.gold).ellipse(8, 4, 3, 1.5, P.goldHi);
  img.rect(14, 2, 3, 2, P.gold).rect(2, 3, 2, 2, P.gold);
  return img.outline();
}

/** A tent of the crest's teal, a pennant on its pole. */
function tent(): Raster {
  const img = new Raster(48, 42);
  const apex = { x: 24, y: 10 };
  for (let y = apex.y; y <= 38; y++) {
    const half = ((y - apex.y) / (38 - apex.y)) * 21;
    for (let x = Math.round(apex.x - half); x <= Math.round(apex.x + half); x++) img.set(x, y, x < apex.x ? P.teal : P.dteal);
  }
  for (let y = 38; y > 36; y--) for (let x = 3; x < 46; x++) if (img.get(x, y)[3]) img.set(x, y, P.gold);
  for (let y = 22; y <= 38; y++) {
    const half = ((y - 22) / 16) * 6;
    for (let x = Math.round(24 - half); x <= Math.round(24 + half); x++) img.set(x, y, P.navy);
  }
  img.line(24, 10, 15, 37, hex("#13755a")).line(24, 10, 33, 37, hex("#014a52"));
  img.rect(23, 2, 2, 9, P.woodLo);
  img.rect(25, 2, 7, 4, P.lime).rect(25, 4, 5, 2, P.green);
  return img.outline();
}

function bench(): Raster {
  const img = new Raster(30, 14);
  img.rect(1, 2, 28, 3, P.woodMid).rect(1, 2, 28, 1, P.woodHi);
  img.rect(1, 6, 28, 3, P.wood).rect(1, 6, 28, 1, P.woodHi);
  for (const x of [3, 25]) img.rect(x, 9, 2, 4, P.woodLo);
  return img.outline();
}

/** A training dummy: straw on a post, a target on its chest in the crest's colours. */
function dummy(): Raster {
  const img = new Raster(20, 38);
  img.rect(9, 12, 2, 25, P.woodLo).rect(2, 15, 16, 2, P.woodMid);
  img.rect(5, 11, 10, 14, P.woodHi).rect(5, 11, 2, 14, P.wood).rect(5, 17, 10, 1, P.wood);
  img.ellipse(10, 6, 4, 4.5, P.thatch).rect(8, 5, 1, 1, P.woodLo).rect(11, 5, 1, 1, P.woodLo);
  img.ellipse(10, 18, 3.5, 3.5, P.teal).ellipse(10, 18, 2, 2, P.lime).rect(10, 18, 1, 1, P.redHi);
  return img.outline();
}

function logSeat(): Raster {
  const img = new Raster(22, 10);
  img.rect(3, 2, 16, 6, P.woodMid).rect(3, 2, 16, 2, P.wood).ellipse(3, 5, 2.5, 3.2, P.woodHi).ellipse(3, 5, 1, 1.5, P.woodLo);
  return img.outline();
}

// --- The arena -----------------------------------------------------------------

/**
 * The arena, in art pixels. Seen from above and in front, as the pack draws
 * its buildings: an oval of sand ringed by a low wall, six tiers of seats
 * rising behind it (deep at the back, foreshortened at the front), an outer
 * wall with a parapet, a canopied box at the back centre under the big crest
 * banner, gates east and west, and the main gate in the front wall facing the
 * town's avenue.
 *
 * Drawn in layers, because agents fight on the sand: arena.png is everything,
 * drawn under the fighters; arena-front.png is the front wall alone, drawn
 * over them; the crowd is two overlays, still and cheering.
 */
export const ARENA = { w: 330, h: 230, cx: 165, fy: 154, frx: 118, fry: 50 };
const OY = 36;
const TIERS = 6;
const tier = (k: number) => ({ rx: 121 + 6.5 * k, ry: 53 + 5 * k, cy: ARENA.fy - 4 * k });
const WALL = { rx: 164, ry: 86, cy: 94 + OY };

function arena(): { back: Raster; front: Raster; crowd: [Raster, Raster] } {
  const { w, h, cx, fy, frx, fry } = ARENA;
  const img = new Raster(w, h);
  const rand = rng(7);

  // Shadow, the outer wall's face with its courses of stone, and its top.
  img.ellipse(cx, WALL.cy + 12, WALL.rx + 1, WALL.ry, hex("#000000", 70));
  img.ellipse(cx, WALL.cy + 9, WALL.rx, WALL.ry, P.stoneLo);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inEllipse(x, y, cx, WALL.cy + 9, WALL.rx, WALL.ry)) continue;
      if (y % 4 === 0) img.set(x, y, P.stoneDk);
      else if ((x + (Math.floor(y / 4) % 2) * 5) % 10 === 0) img.set(x, y, P.stoneDk);
    }
  }
  img.ellipse(cx, WALL.cy, WALL.rx, WALL.ry, P.stone);
  img.ellipse(cx, WALL.cy, WALL.rx - 3, WALL.ry - 2, P.stoneHi);
  img.ellipse(cx, WALL.cy + 1, WALL.rx - 5, WALL.ry - 4, P.stone);

  // The tiers, back to front: each one's riser, then its seats.
  for (let k = TIERS; k >= 1; k--) {
    const t = tier(k);
    img.ellipse(cx, t.cy - 3, t.rx, t.ry, P.stoneDk);
    img.ellipse(cx, t.cy, t.rx, t.ry, k % 2 ? P.woodMid : P.wood);
    img.ellipse(cx, t.cy, t.rx, t.ry - 0.6, k % 2 ? P.wood : P.woodHi);
    img.ellipse(cx, t.cy + 1, t.rx - 0.5, t.ry - 0.5, k % 2 ? P.woodMid : P.wood);
  }

  // Aisles: stairs of stone down through the seats.
  for (const angle of [-0.62, -0.32, 0.32, 0.62].map((a) => -Math.PI / 2 + a * Math.PI)) {
    const inner = { x: cx + Math.cos(angle) * (frx + 6), y: fy - 6 + Math.sin(angle) * (fry + 4) };
    const outer = { x: cx + Math.cos(angle) * (tier(TIERS).rx - 1), y: tier(TIERS).cy + Math.sin(angle) * (tier(TIERS).ry - 1) };
    for (let s = -1; s <= 1; s++) img.line(inner.x + s, inner.y, outer.x + s, outer.y, s === 0 ? P.stoneHi : P.stone);
  }

  // The low wall round the sand: its lip at the front, its lip and face at the back, then the sand.
  img.ellipse(cx, fy + 4, frx + 3, fry + 3, P.stone);
  img.ellipse(cx, fy - 7, frx + 4, fry + 3, P.stoneHi);
  img.ellipse(cx, fy - 4, frx + 3, fry + 1, P.stoneDk);
  for (let x = 0; x < w; x += 6) for (let y = fy - fry - 8; y < fy; y++) if (inEllipse(x, y, cx, fy - 4, frx + 3, fry + 1) && !inEllipse(x, y, cx, fy, frx, fry)) img.set(x, y, P.stoneDeep);
  for (let y = fy - fry; y <= fy + fry; y++) {
    for (let x = cx - frx; x <= cx + frx; x++) {
      if (!inEllipse(x, y, cx, fy, frx, fry)) continue;
      const n = rand();
      const block = (Math.floor(x / 2) * 73 + Math.floor(y / 2) * 151) % 13;
      img.set(x, y, n < 0.06 ? P.sandDk : block < 2 ? P.sandHi : block < 4 ? P.sandLo : P.sand);
    }
  }
  // The back wall's shadow on the sand.
  for (let y = fy - fry; y < fy; y++) {
    for (let x = cx - frx; x <= cx + frx; x++) {
      if (inEllipse(x, y, cx, fy, frx, fry) && !inEllipse(x, y - 5, cx, fy, frx, fry)) img.put(x, y, hex("#7a5a3a", 90));
    }
  }
  // A ring marked in the sand, and the crest painted in the middle of it.
  for (let a = 0; a < Math.PI * 2; a += 0.01) img.put(cx + Math.cos(a) * 44, fy + 2 + Math.sin(a) * 19, hex("#189b68", 120));
  const mark = crest(48);
  img.blit(mark, cx - 24, fy + 2 - Math.round(mark.h / 2), 0.45);

  // Gates east and west: tunnels into the stands, a torch beside each.
  const torches: { x: number; y: number }[] = [];
  for (const side of [-1, 1]) {
    const gx = cx + side * (frx + 9);
    img.rect(gx - 6, fy - 22, 12, 22, P.stone).rect(gx - 6, fy - 22, 12, 2, P.stoneHi);
    img.rect(gx - 4, fy - 17, 8, 17, P.ink).ellipse(gx, fy - 17, 4, 3, P.ink);
    img.rect(gx - 4, fy - 4, 8, 4, P.sandLo);
    const tx = gx + side * 9;
    img.rect(tx, fy - 18, 2, 8, P.woodLo).rect(tx - 1, fy - 21, 4, 3, P.gold).rect(tx, fy - 23, 2, 2, P.redHi);
    torches.push({ x: tx + 1, y: fy - 22 });
  }

  // The parapet along the back of the outer wall.
  for (let x = 10; x < w - 10; x += 9) {
    const u = (x + 2 - cx) / WALL.rx;
    if (Math.abs(u) > 0.97) continue;
    const top = Math.round(WALL.cy - WALL.ry * Math.sqrt(1 - u * u));
    img.rect(x, top - 4, 5, 5, P.stone).rect(x, top - 4, 5, 1, P.stoneHi).rect(x + 4, top - 3, 1, 4, P.stoneLo);
  }

  // The box at the back centre: a striped canopy over the best seats.
  const box = { x: cx - 26, y: tier(TIERS).cy - tier(TIERS).ry + 4, w: 52 };
  img.rect(box.x + 2, box.y + 6, box.w - 4, 14, P.stoneDk).rect(box.x + 3, box.y + 7, box.w - 6, 12, P.deep);
  for (let x = 0; x < box.w; x++) {
    const c = Math.floor(x / 4) % 2 ? P.gold : P.teal;
    img.rect(box.x + x, box.y, 1, 6, c);
    if (x % 4 < 2) img.set(box.x + x, box.y + 6, c);
  }
  img.rect(box.x, box.y, box.w, 1, P.goldHi);
  for (const x of [box.x + 2, box.x + box.w - 4]) img.rect(x, box.y + 6, 2, 14, P.gold);

  // Banners on the parapet; the great crest banner over the box.
  for (const u of [-0.8, -0.5, 0.5, 0.8]) {
    const x = Math.round(cx + u * WALL.rx);
    const top = Math.round(WALL.cy - WALL.ry * Math.sqrt(1 - u * u));
    img.blit(banner(P.teal, P.dteal, P.gold, 14, 22), x - 10, top - 34);
  }
  const great = banner(P.teal, P.dteal, P.gold, 30, 30);
  img.blit(great, cx - Math.floor(great.w / 2), 0);

  // The front: the main gate through the front wall, pillars and banners either side.
  const gateTop = fy + fry - 2;
  const gateBottom = WALL.cy + WALL.ry + 9;
  for (let y = gateTop; y <= gateBottom; y++) {
    for (let x = cx - 12; x <= cx + 12; x++) {
      if (y > gateTop + 2 || inEllipse(x, y, cx, fy, frx, fry)) img.set(x, y, Math.abs(x - cx) > 10 ? P.sandDk : (x + y) % 7 === 0 ? P.sandLo : P.sand);
    }
  }
  for (const side of [-1, 1]) {
    const px = cx + side * 15 - (side < 0 ? 5 : 0);
    img.rect(px, gateBottom - 30, 6, 31, P.stone).rect(px, gateBottom - 30, 6, 2, P.stoneHi).rect(px + (side < 0 ? 0 : 5), gateBottom - 28, 1, 29, P.stoneDk);
    img.rect(px - 1, gateBottom - 33, 8, 3, P.gold).rect(px + 1, gateBottom - 36, 4, 3, P.redHi);
    torches.push({ x: px + 3, y: gateBottom - 35 });
    img.blit(banner(P.teal, P.dteal, P.gold, 10, 14), px + (side < 0 ? -14 : 8), gateBottom - 30);
  }
  img.outline();

  // The front wall alone: everything in front of the sand and south of its middle.
  const front = new Raster(w, h);
  for (let y = fy; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inEllipse(x, y, cx, fy, frx, fry)) continue;
      if (Math.abs(x - cx) <= 10 && y < gateBottom - 34) continue;
      const c = img.get(x, y);
      if (c[3] > 0) front.set(x, y, c);
    }
  }

  // The crowd: on every tier at the back and the sides, still and then cheering.
  const still = new Raster(w, h);
  const cheer = new Raster(w, h);
  const seat = rng(11);
  const aisles = [-0.62, -0.32, 0.32, 0.62].map((a) => -Math.PI / 2 + a * Math.PI);
  for (let k = 1; k <= TIERS; k++) {
    const t = tier(k);
    const inner = tier(k - 1);
    for (let a = Math.PI * 0.98; a < Math.PI * 2.02; a += 4.6 / t.rx) {
      const x = Math.round(cx + Math.cos(a) * (t.rx - 3.5));
      const y = Math.round(t.cy + Math.sin(a) * (t.ry - 3));
      if (y > fy - 6) continue;
      if (k > 0 && inEllipse(x, y, cx, inner.cy, inner.rx, inner.ry) && k > 1) continue;
      if (aisles.some((b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 5 / t.rx)) continue;
      if (x > box.x - 1 && x < box.x + box.w + 1 && y < box.y + 21) continue;
      if (Math.abs(x - cx) > frx && Math.abs(y - (fy - 12)) < 14) continue;
      if (seat() < 0.22) continue;
      const shirt = WEAR[Math.floor(seat() * WEAR.length)]!;
      const skin = SKIN[Math.floor(seat() * SKIN.length)]!;
      const shade: RGBA = [Math.round(shirt[0] * 0.7), Math.round(shirt[1] * 0.7), Math.round(shirt[2] * 0.7), 255];
      still.rect(x - 1, y - 1, 3, 2, shirt).rect(x - 1, y + 1, 3, 1, shade).rect(x, y - 3, 2, 2, skin);
      const up = seat() < 0.5;
      const hop = up && seat() < 0.5 ? 1 : 0;
      cheer.rect(x - 1, y - 1 - hop, 3, 2, shirt).rect(x - 1, y + 1 - hop, 3, 1, shade).rect(x, y - 3 - hop, 2, 2, skin);
      if (up) cheer.rect(x - 2, y - 4 - hop, 1, 2, skin).rect(x + 2, y - 4 - hop, 1, 2, skin);
    }
  }
  writeFileSync(join(out, "arena-torches.json"), JSON.stringify(torches));
  return { back: img, front, crowd: [still, cheer] };
}

// --- The pack's buildings, in the crest's colours --------------------------------

/** A flag's blue turned the crest's teal, its gold emblem the crest's green. */
function recolourFlag(img: Raster, box: { x0: number; y0: number; x1: number; y1: number }): void {
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const [r, g, b, a] = img.get(x, y);
      if (a < 100) continue;
      const lum = (r + g + b) / 3;
      if (b > r + 25 && b > 80) img.set(x, y, lum > 110 ? P.teal : lum > 70 ? P.dteal : P.deep);
      else if (r > 160 && g > 110 && b < 120) img.set(x, y, r > 220 ? P.glow : P.green);
    }
  }
}

/** The castle, for the Strategy Lab: its flag in the crest's colours and the crest over its gate. */
function strategyLab(): Raster {
  const img = readPng(join(pub, "village/buildings/Castle.png"));
  recolourFlag(img, { x0: 199, y0: 6, x1: 232, y1: 31 });
  const c = crest(30);
  img.blit(c, 200 - 15, 186);
  return img;
}

function lookout(): Raster {
  const img = readPng(join(pub, "village/buildings/Tower.png"));
  recolourFlag(img, { x0: 96, y0: 26, x1: 140, y1: 63 });
  return img;
}

/**
 * The old arena hut, for the Game Hall: its "ARENA" sign becomes a screen with
 * a match on it, and the crest goes up on its gable.
 */
function gameHall(): Raster {
  const img = readPng(join(pub, "village/buildings/Arena.png"));
  const s = { x: 180, y: 270, w: 61, h: 22 };
  img.rect(s.x, s.y, s.w, s.h, P.ink).rect(s.x + 1, s.y + 1, s.w - 2, s.h - 2, P.teal).rect(s.x + 3, s.y + 3, s.w - 6, s.h - 6, hex("#0a2a2a"));
  img.rect(s.x + 10, s.y + 6, 6, 6, SKIN[0]!).rect(s.x + 8, s.y + 12, 10, 5, WEAR[3]!);
  img.rect(s.x + 45, s.y + 6, 6, 6, SKIN[2]!).rect(s.x + 43, s.y + 12, 10, 5, WEAR[4]!);
  img.rect(s.x + 28, s.y + 9, 5, 5, P.glow).rect(s.x + 26, s.y + 11, 9, 1, P.gold).rect(s.x + 30, s.y + 7, 1, 9, P.gold);
  img.rect(s.x + 22, s.y + 4, 3, 3, P.redHi);
  const c = crest(40);
  img.blit(c, 160 - 20, 205);
  return img;
}

// --- Out ---------------------------------------------------------------------

mkdirSync(out, { recursive: true });
const save = (name: string, img: Raster) => writePng(join(out, `${name}.png`), img);

const a = arena();
save("arena", a.back);
save("arena-front", a.front);
save("arena-crowd", a.crowd[0]);
save("arena-cheer", a.crowd[1]);
save("arena-card", a.back.clone().blit(a.crowd[0], 0, 0));
save("banner", banner(P.teal, P.dteal, P.gold));
save("banner-fame", banner(P.navy, P.deep, P.gold));
save("banner-gold", banner(P.gold, P.goldLo, P.teal));
save("flag", flagSheet());
const board = leaderboardSheet();
save("leaderboard", board);
save("leaderboard-card", new Raster(board.w / 2, board.h).blit(board, 0, 0));
save("scoreboard", scoreboardSheet());
save("war-table", warTable());
save("strategy-board", strategyBoard());
save("hiring-board", hiringBoard());
save("statue", statue());
save("trophy", trophy());
save("chest", chest(true));
save("chest-shut", chest(false));
save("coins", coins());
save("tent", tent());
save("bench", bench());
save("dummy", dummy());
save("log", logSeat());
save("strategy-lab", strategyLab());
save("lookout", lookout());
save("game-hall", gameHall());
console.log(`Wrote the village's AgentClash art to ${out}`);
