/**
 * True 3D structures for the solid-structure prototype (docs/world-solids.md): real walls, roofs,
 * posts and panels on fixed local axes, textured with pixel materials made from each structure's
 * own artwork (app/village/game/solid-materials.ts). Nothing here reads the camera: a model is built
 * once and the camera moves around it.
 *
 * Local axes as object-appearance.ts has them: x to the structure's right, y toward its front, z up,
 * all in world units, origin at the centre of its footprint on the ground.
 */

export type SolidKind = "cottage" | "hall" | "stall" | "board";

/** Every material a model may use, in atlas order. */
export const SOLID_MATERIALS = [
  // Surfaces, tiled (mirrored) across a face at the model's texel size.
  "plaster", "timber", "stone", "fieldstone", "thatch", "thatchUnder", "tiles", "tilesUnder", "planks", "darkPlanks",
  "canopy", "cloth", "crateWood", "boardBack", "boardRoof", "gold", "brass", "soil", "shadowWood",
  // Decals: one picture stretched once over its quad.
  "door", "window", "dormerWindow", "lantern", "flowerBox", "ivy",
  "hallDoor", "stainedWindow", "banner", "hallWindow", "trophy", "lamp",
  "canopyEdge", "tomatoes", "greens", "cauliflower", "barrel", "stallLantern", "clothFront",
  "boardDisplay", "boardRoofEdge",
] as const;
export type SolidMaterial = typeof SOLID_MATERIALS[number];
export const SOLID_DECALS: ReadonlySet<SolidMaterial> = new Set(SOLID_MATERIALS.slice(SOLID_MATERIALS.indexOf("door")));

/** Flat arrays ready for a GPU buffer: per vertex a position, a normal, a material UV and a material. */
export type SolidMesh = {
  kind: SolidKind;
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; materials: Float32Array;
  /** Local bounding box, for culling, screen bounds and painter depth. */
  min: [number, number, number]; max: [number, number, number];
  /** World units per texel of its materials: the source picture's own pixel size. */
  texel: number;
  triangles: number;
};

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Collects triangles. Tiled UVs are in texels along the face; decal UVs are 0..1 over the picture. */
class Builder {
  private p: number[] = []; private n: number[] = []; private uv: number[] = []; private m: number[] = [];
  constructor(readonly texel: number) {}

  /** A planar quad a-b-c-d, counter-clockwise seen from its outside: a bottom left, b bottom right, c top right, d top left. */
  quad(a: V, b: V, c: V, d: V, material: SolidMaterial): void {
    const area = cross(sub(d, a), sub(b, a));
    if (len(area) < 1e-9) return; // A face of no size: a gable end with no wall below its eaves.
    const normal = unit(area);
    const id = SOLID_MATERIALS.indexOf(material);
    let uvs: [number, number][];
    if (SOLID_DECALS.has(material)) uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
    else {
      // Along the bottom edge and up the face, in texels; v grows downward as an image's rows do.
      const across = unit(sub(b, a)), up = unit(sub(d, a));
      const at = (q: V): [number, number] => [dot(sub(q, a), across) / this.texel, -dot(sub(q, a), up) / this.texel];
      uvs = [a, b, c, d].map(at);
    }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const q = [a, b, c, d][i]!, t = uvs[i]!;
      this.p.push(...q); this.n.push(...normal); this.uv.push(...t); this.m.push(id);
    }
  }

  tri(a: V, b: V, c: V, material: SolidMaterial): void {
    const area = cross(sub(c, a), sub(b, a));
    if (len(area) < 1e-9) return;
    const normal = unit(area), id = SOLID_MATERIALS.indexOf(material);
    const across = unit(sub(b, a)), up = unit(cross(normal, across));
    for (const q of [a, b, c]) {
      this.p.push(...q); this.n.push(...normal);
      this.uv.push(dot(sub(q, a), across) / this.texel, -dot(sub(q, a), up) / this.texel); this.m.push(id);
    }
  }

  /** An axis-aligned box; `faces` names a material per side, or one for all. Skipped sides are not built. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    faces: SolidMaterial | Partial<Record<"top" | "bottom" | "front" | "back" | "left" | "right", SolidMaterial | null>>): void {
    const f = typeof faces === "string" ? { top: faces, bottom: faces, front: faces, back: faces, left: faces, right: faces } : faces;
    const side = (k: keyof typeof f, fallback?: SolidMaterial) => (k in f ? f[k] : fallback) ?? null;
    const all = typeof faces === "string" ? faces : undefined;
    const front = side("front", all), back = side("back", all), left = side("left", all), right = side("right", all), top = side("top", all), bottom = side("bottom", all);
    if (front) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], front);
    if (back) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1], back);
    if (left) this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], left);
    if (right) this.quad([x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], right);
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], top);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], bottom);
  }

  /** A picture on a wall plane, just proud of it so it never fights the wall for depth. */
  decal(wall: "front" | "back" | "left" | "right", at: number, plane: number, u0: number, u1: number, z0: number, z1: number, material: SolidMaterial, out = 0.12): void {
    const o = plane + (wall === "front" || wall === "right" ? out : -out);
    if (wall === "front") this.quad([at + u0, o, z0], [at + u1, o, z0], [at + u1, o, z1], [at + u0, o, z1], material);
    if (wall === "back") this.quad([at - u0, o, z0], [at - u1, o, z0], [at - u1, o, z1], [at - u0, o, z1], material);
    if (wall === "right") this.quad([o, at - u0, z0], [o, at - u1, z0], [o, at - u1, z1], [o, at - u0, z1], material);
    if (wall === "left") this.quad([o, at + u0, z0], [o, at + u1, z0], [o, at + u1, z1], [o, at + u0, z1], material);
  }

  /**
   * A pitched roof with real thickness: two slabs from the eaves at y = ±halfDepth up to a ridge
   * along x, overhanging the gables by `x0`/`x1`, with undersides and edge faces.
   */
  gableRoof(x0: number, x1: number, halfDepth: number, eave: number, ridge: number, thick: number, top: SolidMaterial, under: SolidMaterial): void {
    for (const s of [1, -1] as const) {
      const lowOut: V = [0, s * halfDepth, eave], highOut: V = [0, 0, ridge];
      const lowIn: V = [0, s * halfDepth, eave - thick], highIn: V = [0, 0, ridge - thick];
      const at = (p: V, x: number): V => [x, p[1], p[2]];
      if (s > 0) {
        this.quad(at(lowOut, x0), at(lowOut, x1), at(highOut, x1), at(highOut, x0), top);
        this.quad(at(highIn, x0), at(highIn, x1), at(lowIn, x1), at(lowIn, x0), under);
        this.quad(at(lowIn, x0), at(lowIn, x1), at(lowOut, x1), at(lowOut, x0), top);
      } else {
        this.quad(at(lowOut, x1), at(lowOut, x0), at(highOut, x0), at(highOut, x1), top);
        this.quad(at(highIn, x1), at(highIn, x0), at(lowIn, x0), at(lowIn, x1), under);
        this.quad(at(lowIn, x1), at(lowIn, x0), at(lowOut, x0), at(lowOut, x1), top);
      }
      // The verges: the slab's thickness seen end on.
      this.quad(at(lowIn, x1), at(highIn, x1), at(highOut, x1), at(lowOut, x1), top);
      this.quad(at(highIn, x0), at(lowIn, x0), at(lowOut, x0), at(highOut, x0), top);
    }
  }

  /** A gable end wall: the rectangle up to the eave line and the triangle to the ridge, facing ±x. */
  gableEnd(x: number, facing: 1 | -1, halfDepth: number, z0: number, shoulder: number, apex: number, material: SolidMaterial): void {
    const d = halfDepth;
    if (facing > 0) {
      this.quad([x, d, z0], [x, -d, z0], [x, -d, shoulder], [x, d, shoulder], material);
      this.tri([x, d, shoulder], [x, -d, shoulder], [x, 0, apex], material);
    } else {
      this.quad([x, -d, z0], [x, d, z0], [x, d, shoulder], [x, -d, shoulder], material);
      this.tri([x, -d, shoulder], [x, d, shoulder], [x, 0, apex], material);
    }
  }

  /** A pointed roof of `sides` faces over a rectangle, eaves at z0, point at z1. */
  spire(cx: number, cy: number, rx: number, ry: number, z0: number, z1: number, sides: number, material: SolidMaterial, under?: SolidMaterial): void {
    const rim = Array.from({ length: sides }, (_, i) => { const a = (i + 0.5) * Math.PI * 2 / sides; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z0] as V; });
    for (let i = 0; i < sides; i++) {
      const a = rim[i]!, b = rim[(i + 1) % sides]!;
      this.tri(b, a, [cx, cy, z1], material);
      if (under) this.tri(a, b, [cx, cy, z0 + 0.5], under);
    }
  }

  /** An upright many-sided drum (a barrel, a post): sides only, and a lid. */
  drum(cx: number, cy: number, r: number, z0: number, z1: number, sides: number, material: SolidMaterial, lid: SolidMaterial): void {
    const rim = Array.from({ length: sides }, (_, i) => { const a = i * Math.PI * 2 / sides; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const; });
    for (let i = 0; i < sides; i++) {
      const a = rim[i]!, b = rim[(i + 1) % sides]!;
      this.quad([b[0], b[1], z0], [a[0], a[1], z0], [a[0], a[1], z1], [b[0], b[1], z1], material);
      this.tri([b[0], b[1], z1], [a[0], a[1], z1], [cx, cy, z1], lid);
    }
  }

  /** A free-standing picture, a face each way (foliage, a lantern on its bracket). */
  card(cx: number, cy: number, w: number, z0: number, z1: number, material: SolidMaterial, along: "x" | "y" = "x"): void {
    const h = w / 2;
    if (along === "x") {
      this.quad([cx - h, cy, z0], [cx + h, cy, z0], [cx + h, cy, z1], [cx - h, cy, z1], material);
      this.quad([cx + h, cy, z0], [cx - h, cy, z0], [cx - h, cy, z1], [cx + h, cy, z1], material);
    } else {
      this.quad([cx, cy + h, z0], [cx, cy - h, z0], [cx, cy - h, z1], [cx, cy + h, z1], material);
      this.quad([cx, cy - h, z0], [cx, cy + h, z0], [cx, cy + h, z1], [cx, cy - h, z1], material);
    }
  }

  done(kind: SolidKind): SolidMesh {
    const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, this.p[i + k]!); max[k] = Math.max(max[k]!, this.p[i + k]!); }
    return { kind, positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv), materials: new Float32Array(this.m),
      min, max, texel: this.texel, triangles: this.p.length / 9 };
  }
}

/** Timber framing on one wall: corner posts, sill, rail and plate, and studs where `studs` say. */
function framing(b: Builder, wall: "front" | "back" | "left" | "right", half: number, plane: number, z0: number, z1: number, rail: number, studs: number[], beam = 1.4) {
  const out = beam * 0.5;
  const along = (u0: number, u1: number, za: number, zb: number) => {
    if (wall === "front") b.box(u0, plane - out, za, u1, plane + out, zb, { front: "timber", top: "timber", bottom: "timber", left: "timber", right: "timber" });
    if (wall === "back") b.box(-u1, plane - out, za, -u0, plane + out, zb, { back: "timber", top: "timber", bottom: "timber", left: "timber", right: "timber" });
    if (wall === "right") b.box(plane - out, -u1, za, plane + out, -u0, zb, { right: "timber", top: "timber", bottom: "timber", front: "timber", back: "timber" });
    if (wall === "left") b.box(plane - out, u0, za, plane + out, u1, zb, { left: "timber", top: "timber", bottom: "timber", front: "timber", back: "timber" });
  };
  along(-half, half, z0, z0 + beam);                 // sill
  along(-half, half, z1 - beam, z1);                 // plate
  if (rail > 0) along(-half, half, rail, rail + beam * 0.8);
  for (const u of [-half, half, ...studs]) along(u - beam / 2, u + beam / 2, z0, z1);
}

/** The gold cottage (cottage-gold.png): stone footing, timber-framed plaster, thatch, a stone chimney. */
function cottage(): SolidMesh {
  const b = new Builder(0.55);
  const W = 27, D = 17, base = 3, wall = 30, eave = 29, ridge = 56;
  b.box(-W - 1.2, -D - 1.2, 0, W + 1.2, D + 1.2, base, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  b.box(-W, -D, base, W, D, wall, { front: "plaster", back: "plaster", left: "plaster", right: "plaster" });
  // Gable ends under the thatch, plaster with a king post.
  const shoulder = eave + (23 - D) * (ridge - eave) / 23, apex = ridge - 2.5;
  b.gableEnd(W, 1, D, wall, Math.max(wall, shoulder), apex, "plaster");
  b.gableEnd(-W, -1, D, wall, Math.max(wall, shoulder), apex, "plaster");
  for (const x of [W, -W]) b.box(x - 0.7, -0.7, wall, x + 0.7, 0.7, apex - 1, "timber");
  // The thatch: thick, overhanging, a ridge along the front.
  b.gableRoof(-W - 5, W + 5, 23, eave, ridge, 2.6, "thatch", "thatchUnder");
  // A dormer on the front slope over the window, its own small thatch.
  b.box(6, 4, 36, 18, 15, 46, { front: "plaster", left: "plaster", right: "plaster" });
  b.decal("front", 12, 15, -4.5, 4.5, 37.5, 45, "dormerWindow");
  // Its own little gable, the ridge running back into the main roof.
  for (const side of [-1, 1] as const) {
    const eaveX = 12 + side * 7.5, ridgeX = 12;
    const lo = (y: number): V => [eaveX, y, 45], hi = (y: number): V => [ridgeX, y, 51];
    if (side > 0) b.quad(lo(17.5), lo(3), hi(3), hi(17.5), "thatch"); else b.quad(lo(3), lo(17.5), hi(17.5), hi(3), "thatch");
  }
  b.tri([5, 15, 46], [19, 15, 46], [12, 15, 50.5], "plaster");
  // Chimney through the back slope, stone, a clay pot.
  b.box(14, -9, 30, 22, -1, 70, { front: "stone", back: "stone", left: "stone", right: "stone", top: "stone" });
  b.box(15.5, -7.5, 70, 20.5, -2.5, 74, { front: "darkPlanks", back: "darkPlanks", left: "darkPlanks", right: "darkPlanks", top: "shadowWood" });
  // Framing on every wall, so the same construction continues all round.
  framing(b, "front", W, D, base, wall, 0, [-18, -3, 4, 19]);
  framing(b, "back", W, -D, base, wall, 17, [-9, 0, 9]);
  framing(b, "left", D, -W, base, wall, 17, [0]);
  framing(b, "right", D, W, base, wall, 17, [0]);
  // Front: the arched plank door in a timber frame, on a stone step; a lantern; a window and its flower box.
  b.box(-17, D, 0, -5, D + 4, base, "fieldstone");
  b.decal("front", -11, D, -5, 5, base, 23, "door", 0.4);
  b.box(-16.5, D, base, -15.4, D + 1.4, 24, "timber"); b.box(-6.6, D, base, -5.5, D + 1.4, 24, "timber");
  b.box(-16.5, D, 23, -5.5, D + 1.4, 24.6, "timber");
  b.decal("front", -1.5, D, -1.8, 1.8, 13, 21, "lantern", 0.6);
  b.decal("front", 12, D, -5, 5, 11, 23, "window", 0.3);
  b.box(6, D, 9, 18, D + 3, 11.5, { front: "planks", top: "soil", left: "planks", right: "planks", bottom: "planks" });
  b.decal("front", 12, D + 3, -6.5, 6.5, 10, 15.5, "flowerBox", 0.05);
  b.card(-W - 0.5, D + 1.5, 8, 0, 26, "ivy", "y");
  b.card(W + 0.5, D + 1.5, 7, 0, 22, "ivy", "y");
  // Pots of flowers either side of the step, as the picture has them.
  for (const x of [-20, -2]) b.card(x, D + 3, 6, 0, 5, "flowerBox");
  // Back: two windows and a plain plank door; sides: a window each.
  b.decal("back", -12, -D, -4.5, 4.5, 12, 23, "window", 0.3);
  b.decal("back", 14, -D, -4.5, 4.5, 12, 23, "window", 0.3);
  b.decal("back", 3, -D, -4, 4, base, 20, "door", 0.4);
  b.decal("left", 0, -W, -4.5, 4.5, 12, 23, "window", 0.3);
  b.decal("right", 0, W, -4.5, 4.5, 12, 23, "window", 0.3);
  return b.done("cottage");
}

/**
 * The Hall of Fame (hall-of-fame.png): a stone ground floor with an arched door on steps, a
 * timber-and-plaster upper floor, a tall front gable with its stained window and banners, red-tiled
 * wings with pointed roofs, and pinnacles at the gable's corners.
 */
function hall(): SolidMesh {
  const b = new Builder(1.2);
  const W = 34, D = 30, ground = 44, upper = 74;
  // Centre block: stone below, framed plaster above, all four sides.
  b.box(-W, -D, 0, W, D, ground, { front: "stone", back: "stone", left: "stone", right: "stone" });
  b.box(-W, -D, ground, W, D, upper, { front: "plaster", back: "plaster", left: "plaster", right: "plaster" });
  b.box(-W - 1.5, -D - 1.5, ground - 2, W + 1.5, D + 1.5, ground + 1, { front: "stone", back: "stone", left: "stone", right: "stone", top: "stone", bottom: "stone" });
  framing(b, "front", W, D, ground + 1, upper, 0, [-20, 20], 2.2);
  framing(b, "back", W, -D, ground + 1, upper, 0, [-12, 12], 2.2);
  // Its gable faces the front, so its ridge runs front to back: build the roof turned a quarter.
  const roof = new Builder(1.2);
  roof.gableRoof(-D - 6, D + 6, W + 5, upper - 2, 122, 3, "tiles", "tilesUnder");
  roof.gableEnd(D + 0.01, 1, W, upper, upper, 118, "plaster");
  roof.gableEnd(-D - 0.01, -1, W, upper, upper, 118, "plaster");
  const turned = roof.done("hall");
  for (let i = 0; i < turned.positions.length; i += 9) {
    const tri: V[] = [0, 3, 6].map((k) => [turned.positions[i + k + 1]!, -turned.positions[i + k]!, turned.positions[i + k + 2]!] as V);
    const id = SOLID_MATERIALS[turned.materials[i / 3]!]!;
    b.tri(tri[0]!, tri[1]!, tri[2]!, id);
  }
  b.decal("front", 0, D, -8.5, 8.5, 80, 112, "stainedWindow", 0.4);
  b.decal("front", 0, D, -10, 10, ground + 6, upper - 2, "hallWindow", 0.3);
  // Wings either side: stone, framed upper floor, pointed tiled roofs.
  for (const s of [-1, 1] as const) {
    const x0 = s < 0 ? -W - 26 : W, x1 = s < 0 ? -W : W + 26;
    b.box(x0, -D + 4, 0, x1, D - 4, ground - 4, { front: "stone", back: "stone", left: s < 0 ? "stone" : null, right: s > 0 ? "stone" : null });
    b.box(x0, -D + 4, ground - 4, x1, D - 4, 66, { front: "plaster", back: "plaster", left: s < 0 ? "plaster" : null, right: s > 0 ? "plaster" : null });
    b.spire((x0 + x1) / 2, 0, 18, 30, 64, 104, 8, "tiles", "tilesUnder");
    b.decal("front", (x0 + x1) / 2, D - 4, -4, 4, 14, 34, "hallWindow", 0.3);
    b.decal("front", (x0 + x1) / 2, D - 4, -4, 4, 48, 62, "hallWindow", 0.3);
    b.decal("back", (x0 + x1) / 2, -D + 4, -4, 4, 14, 34, "hallWindow", 0.3);
    b.decal(s < 0 ? "left" : "right", 0, s < 0 ? x0 : x1, -5, 5, 14, 34, "hallWindow", 0.3);
    // Pinnacles at the gable's corners.
    const px = s * (W - 4);
    b.box(px - 5, D - 6, 0, px + 5, D + 4, 86, { front: "stone", back: "stone", left: "stone", right: "stone", top: "stone" });
    b.spire(px, D - 1, 6.5, 6.5, 86, 104, 6, "tiles");
    b.decal("front", s * 21, D, -6, 6, 64, 98, "banner", 0.5);
  }
  // Front: the arched door between lamps, three stone steps, the trophy on its plinth.
  b.decal("front", 0, D, -11, 11, 0, 30, "hallDoor", 0.4);
  for (const [i, depth] of [6, 4, 2].entries()) b.box(-15, D, i * 2, 15, D + depth, i * 2 + 2, { front: "stone", top: "stone", left: "stone", right: "stone" });
  for (const s of [-1, 1]) b.decal("front", s * 15, D, -2.5, 2.5, 16, 26, "lamp", 0.6);
  b.box(-31, D + 2, 0, -17, D + 14, 16, { front: "stone", back: "stone", left: "stone", right: "stone", top: "stone" });
  b.card(-24, D + 8, 16, 16, 32, "trophy");
  // Back and sides of the centre block: windows and a service door, the same stone and timber.
  for (const x of [-18, 18]) { b.decal("back", x, -D, -5, 5, 12, 34, "hallWindow", 0.3); b.decal("back", x, -D, -5, 5, ground + 6, upper - 4, "hallWindow", 0.3); }
  b.decal("back", 0, -D, -8, 8, 0, 24, "door", 0.4);
  return b.done("hall");
}

/** The blue market stall (market-blue.png): four posts, a striped canopy, a counter of crates, storage behind. */
function stall(): SolidMesh {
  const b = new Builder(1);
  const W = 44, D = 22;
  for (const x of [-W, W]) for (const y of [-D, D]) b.box(x - 2.5, y - 2.5, 0, x + 2.5, y + 2.5, y > 0 ? 70 : 84, { front: "planks", back: "planks", left: "planks", right: "planks", top: "darkPlanks" });
  // The canopy: a cloth roof sloping down to the front, with its scalloped edge hanging there.
  const front: V[] = [[-W - 6, D + 6, 72], [W + 6, D + 6, 72]], back: V[] = [[-W - 4, -D - 2, 86], [W + 4, -D - 2, 86]];
  b.quad(front[0]!, front[1]!, back[1]!, back[0]!, "canopy");
  b.quad(back[0]!, back[1]!, front[1]!, front[0]!, "cloth");
  b.quad([-W - 6, D + 6, 62], [W + 6, D + 6, 62], [W + 6, D + 6, 72], [-W - 6, D + 6, 72], "canopyEdge");
  b.quad([W + 6, D + 6, 62], [-W - 6, D + 6, 62], [-W - 6, D + 6, 72], [W + 6, D + 6, 72], "canopyEdge");
  b.box(-W - 4, -D - 3, 84, W + 4, -D - 1, 87, "darkPlanks");
  // The counter: crate-wood sides, a cloth hanging at the front, three crates of produce on top.
  b.box(-W + 4, 2, 0, W - 4, D, 30, { top: "planks", back: "crateWood", left: "crateWood", right: "crateWood", front: "cloth" });
  b.decal("front", 0, D, -W + 4, W - 4, 2, 28, "clothFront", 0.15);
  for (const [i, produce] of (["tomatoes", "greens", "cauliflower"] as const).entries()) {
    const x = -26 + i * 26;
    b.box(x - 11, 4, 30, x + 11, D - 1, 38, { front: "crateWood", back: "crateWood", left: "crateWood", right: "crateWood" });
    b.quad([x - 10, D - 2, 37.5], [x + 10, D - 2, 37.5], [x + 10, 5, 40], [x - 10, 5, 40], produce);
  }
  // Storage behind: stacked crates and a barrel, reached from the rear.
  b.box(-36, -D + 2, 0, -14, -4, 18, "crateWood");
  b.quad([-35, -5, 18.2], [-15, -5, 18.2], [-15, -D + 3, 18.2], [-35, -D + 3, 18.2], "greens");
  b.box(-12, -D + 2, 0, 4, -6, 14, "crateWood");
  b.box(-10, -D + 4, 14, 2, -8, 24, "crateWood");
  b.drum(28, -10, 9, 0, 28, 10, "barrel", "shadowWood");
  b.decal("front", 28, -10 + 9.2, -8, 8, 0, 28, "barrel", 0.02);
  b.drum(16, D + 8, 7, 0, 14, 8, "crateWood", "soil");
  b.box(-W - 10, D - 2, 0, -W + 6, D + 10, 12, "crateWood");
  b.quad([-W - 9, D + 9, 12.2], [-W + 5, D + 9, 12.2], [-W + 5, D - 1, 12.2], [-W - 9, D - 1, 12.2], "tomatoes");
  // A lantern hung off the front-left post.
  b.box(-W - 9, D - 1, 58, -W, D + 1, 60, "darkPlanks");
  b.card(-W - 8, D, 7, 46, 58, "stallLantern");
  return b.done("stall");
}

/** The Notice Board (leaderboard.png): a display on a framed panel with real thickness, two posts, a little roof. */
function board(): SolidMesh {
  const b = new Builder(1.6);
  const W = 60, T = 3, z0 = 28, z1 = 102;
  for (const x of [-W + 8, W - 8]) b.box(x - 3.5, -3.5, 0, x + 3.5, 3.5, z1 + 6, { front: "planks", back: "planks", left: "planks", right: "planks", top: "darkPlanks" });
  // The panel: wood behind, the frame's gold edge all round, the display inset on its front.
  b.box(-W, -T, z0, W, T, z1, { back: "boardBack", left: "gold", right: "gold", top: "gold", bottom: "gold", front: "gold" });
  b.decal("front", 0, T, -W + 3, W - 3, z0 + 3, z1 - 3, "boardDisplay", 0.1);
  // Cross braces and a bar on the back, so its rear reads as the board's own frame.
  b.box(-W + 4, -T - 1.6, (z0 + z1) / 2 - 2, W - 4, -T, (z0 + z1) / 2 + 2, "darkPlanks");
  for (const x of [-W / 2, W / 2]) b.box(x - 2, -T - 1.6, z0 + 2, x + 2, -T, z1 - 2, "darkPlanks");
  // A shallow roof over it.
  b.gableRoof(-W - 6, W + 6, 10, z1 + 4, z1 + 13, 1.6, "boardRoof", "darkPlanks");
  b.quad([-W - 6, 10, z1 + 1], [W + 6, 10, z1 + 1], [W + 6, 10, z1 + 4.2], [-W - 6, 10, z1 + 4.2], "boardRoofEdge");
  return b.done("board");
}

const BUILT = new Map<SolidKind, SolidMesh>();
/** One mesh per kind, built on first use and shared by every instance of it. */
export function solidMesh(kind: SolidKind): SolidMesh {
  let mesh = BUILT.get(kind);
  if (!mesh) {
    mesh = kind === "cottage" ? cottage() : kind === "hall" ? hall() : kind === "stall" ? stall() : board();
    BUILT.set(kind, mesh);
  }
  return mesh;
}
