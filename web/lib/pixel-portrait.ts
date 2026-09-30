import { API } from "@/lib/api";

/**
 * How many pixels across a portrait is drawn at: the village's pixel art, not
 * a smooth vector. The small drawing (silhouette, colours and eyes) for 32 px
 * and under, since the full one's detail turns to noise that small.
 */
export const GRID_SMALL = 20;
export const GRID_LARGE = 40;

/** Each drawing's pixels, once per page: every row of a ladder showing the same agent, and the village, share one. */
const drawn = new Map<string, Promise<ImageData | null>>();
/** The ones already done, so a row that mounts again draws in the same frame rather than flashing empty. */
export const ready = new Map<string, ImageData>();

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * The stored drawing, rasterised onto a grid and snapped to its own colours:
 * every pixel is one of the portrait's flat fills or fully clear, so edges are
 * hard steps rather than a blur. The stored SVG is untouched - this is only
 * how it is shown. `bare` leaves out the plate, the shape behind the
 * character, so only the character itself is drawn.
 */
export function pixelate(url: string, grid: number, bare = false): Promise<ImageData | null> {
  const key = `${url}@${grid}${bare ? ":bare" : ""}`;
  let job = drawn.get(key);
  if (!job) {
    job = (async () => {
      const stored = await (await fetch(url)).text();
      // The plate is the drawing's first shape, straight before the character's group.
      const svg = bare ? stored.replace(/<polygon [^>]*\/>(?=<g )/, "") : stored;
      const colours = [...new Set(svg.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [])].map(hex);
      const blob = URL.createObjectURL(new Blob([svg.replace(/shape-rendering="[^"]*"/, 'shape-rendering="crispEdges"')], { type: "image/svg+xml" }));
      try {
        const img = new Image();
        img.src = blob;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = grid;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(img, 0, 0, grid, grid);
        const data = g.getImageData(0, 0, grid, grid);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3]! < 128) {
            px[i + 3] = 0;
            continue;
          }
          let best = 0;
          let bestD = Infinity;
          colours.forEach(([r, gr, b], j) => {
            const d = (px[i]! - r) ** 2 + (px[i + 1]! - gr) ** 2 + (px[i + 2]! - b) ** 2;
            if (d < bestD) [best, bestD] = [j, d];
          });
          const c = colours[best];
          if (c) [px[i], px[i + 1], px[i + 2]] = c;
          px[i + 3] = 255;
        }
        ready.set(key, data);
        return data;
      } finally {
        URL.revokeObjectURL(blob);
      }
    })().catch(() => {
      drawn.delete(key);
      return null;
    });
    drawn.set(key, job);
  }
  return job;
}

/** Where an agent's portrait is: the small drawing for 32 px and under. */
export const portraitUrl = (id: string, small: boolean) => `${API}/agents/${id}/portrait.svg${small ? "?size=small" : ""}`;

type Rgba = [number, number, number, number];
const at = (d: ImageData, x: number, y: number): Rgba => {
  const i = (y * d.width + x) * 4;
  return [d.data[i]!, d.data[i + 1]!, d.data[i + 2]!, d.data[i + 3]!];
};
const put = (d: ImageData, x: number, y: number, c: Rgba) => d.data.set(c, (y * d.width + x) * 4);
const same = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
const keyOf = (c: Rgba) => c.join(",");
const lum = (c: Rgba) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/**
 * The same character seen from behind and from the side, worked out from its
 * front view alone, so every character gets them without drawing anything new.
 *
 * The plate, if the drawing has one, stays as it is. The character is everything the plate's colour
 * cannot reach from the edges. From behind, each row of it takes that row's commonest colour: a hat
 * stays a hat, a face becomes the back of a head, and the eyes and mouth -
 * never the commonest colour in their row - are gone. From the side (facing
 * right), the near half of the face is spread across the front of each row -
 * one eye, as a profile shows - and the back of the head fills in behind it. Both get a dark edge round the outline.
 */
export function turned(front: ImageData): { side: ImageData; back: ImageData } {
  const w = front.width;
  const h = front.height;
  // The plate: the commonest colour near the edges.
  const ring = new Map<string, { c: Rgba; n: number }>();
  let clear = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 3 && x < w - 4 && y > 3 && y < h - 4) continue;
      const c = at(front, x, y);
      if (c[3] === 0) {
        clear++;
        continue;
      }
      const e = ring.get(keyOf(c)) ?? { c, n: 0 };
      e.n++;
      ring.set(keyOf(c), e);
    }
  }
  // Drawn without its plate, the edges are mostly clear: then there is no plate, and a hat brim or an ear
  // that reaches the edge is still the character's.
  const top = [...ring.values()].sort((a, b) => b.n - a.n)[0];
  const plate = top && top.n > clear ? top.c : undefined;
  // The plate is what the plate's colour reaches from the edges: a pupil drawn in the same colour,
  // closed in by the face, is still the character's.
  const outside = new Uint8Array(w * h);
  const open = (x: number, y: number) => {
    const c = at(front, x, y);
    return c[3] === 0 || (!!plate && same(c, plate));
  };
  const todo: number[] = [];
  for (let x = 0; x < w; x++) todo.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) todo.push(0, y, w - 1, y);
  while (todo.length) {
    const y = todo.pop()!;
    const x = todo.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h || outside[y * w + x] || !open(x, y)) continue;
    outside[y * w + x] = 1;
    todo.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const charAt = (x: number, y: number) => !outside[y * w + x] && at(front, x, y)[3] > 0;
  // The outline: the darkest colour the character uses in any quantity.
  const counts = new Map<string, { c: Rgba; n: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(front, x, y);
      if (!charAt(x, y)) continue;
      const e = counts.get(keyOf(c)) ?? { c, n: 0 };
      e.n++;
      counts.set(keyOf(c), e);
    }
  }
  const dark = [...counts.values()].filter((e) => e.n > 4).sort((a, b) => lum(a.c) - lum(b.c))[0]?.c;
  const isDark = (c: Rgba) => !!dark && same(c, dark);

  /** A row's character: where it starts and ends, and its commonest colour other than the outline. */
  const rows = Array.from({ length: h }, (_, y) => {
    let a = -1;
    let b = -1;
    const n = new Map<string, { c: Rgba; n: number }>();
    for (let x = 0; x < w; x++) {
      const c = at(front, x, y);
      if (!charAt(x, y)) continue;
      if (a < 0) a = x;
      b = x;
      if (isDark(c)) continue;
      const e = n.get(keyOf(c)) ?? { c, n: 0 };
      e.n++;
      n.set(keyOf(c), e);
    }
    const fill = [...n.values()].sort((p, q) => q.n - p.n)[0]?.c ?? dark ?? null;
    return { a, b, fill };
  });

  const back = new ImageData(new Uint8ClampedArray(front.data), w, h);
  const side = new ImageData(new Uint8ClampedArray(front.data), w, h);
  for (let y = 0; y < h; y++) {
    const { a, b, fill } = rows[y]!;
    if (a < 0 || !fill) continue;
    const span = b - a + 1;
    const behind = Math.round(span * 0.45);
    for (let x = a; x <= b; x++) {
      if (!charAt(x, y)) continue;
      put(back, x, y, fill);
      // Side: the back of the head first, then the front view squeezed into the rest.
      if (x < a + behind) put(side, x, y, fill);
      else {
        // Only the near half of the face, spread across the front: one eye, as a profile shows.
        const near = a + Math.floor(span * 0.4);
        const from = near + Math.min(b - near, Math.round(((x - a - behind) / Math.max(1, span - behind - 1)) * (b - near)));
        put(side, x, y, charAt(from, y) ? at(front, from, y) : fill);
      }
    }
  }
  // A dark edge wherever the character meets the plate or the clear, so both read as one shape.
  if (dark) {
    for (const view of [back, side]) {
      const edge: [number, number][] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!charAt(x, y)) continue;
          const out = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx!;
            const ny = y + dy!;
            return nx < 0 || ny < 0 || nx >= w || ny >= h || !charAt(nx, ny);
          });
          if (out) edge.push([x, y]);
        }
      }
      for (const [x, y] of edge) put(view, x, y, dark);
    }
  }
  return { side, back };
}

/**
 * The colours to dress a character's body in, taken from its head: `main`, the
 * commonest colour it wears, and `dark`, its outline.
 */
export function bodyColours(head: ImageData): { main: number; dark: number } {
  const counts = new Map<string, { c: Rgba; n: number }>();
  for (let y = 0; y < head.height; y++) {
    for (let x = 0; x < head.width; x++) {
      const c = at(head, x, y);
      if (c[3] === 0) continue;
      const e = counts.get(keyOf(c)) ?? { c, n: 0 };
      e.n++;
      counts.set(keyOf(c), e);
    }
  }
  const all = [...counts.values()];
  const dark = all.filter((e) => e.n > 4).sort((a, b) => lum(a.c) - lum(b.c))[0]?.c ?? [27, 22, 32, 255];
  const main = all.filter((e) => !same(e.c, dark)).sort((a, b) => b.n - a.n)[0]?.c ?? [58, 49, 66, 255];
  const num = (c: Rgba) => (c[0] << 16) | (c[1] << 8) | c[2];
  return { main: num(main), dark: num(dark) };
}
