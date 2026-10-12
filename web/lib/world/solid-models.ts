/**
 * True 3D structures for the solid-structure prototype (docs/world-solids.md): real walls, roofs,
 * posts and panels on fixed local axes, textured with pixel materials made from each structure's
 * own artwork (app/village/game/solid-materials.ts). Nothing here reads the camera: a model is built
 * once and the camera moves around it.
 *
 * Local axes as object-appearance.ts has them: x to the structure's right, y toward its front, z up,
 * all in world units, origin at the centre of its footprint on the ground.
 */

/**
 * Each family of structure. Ordinary buildings come in families drawn from the village's own
 * pictures; landmarks (hall, board) are each their own.
 */
export const TREE_KINDS = ['treeSmall', 'treeMedium', 'treeLarge', 'treeRound', 'treeTall', 'treeSparse', 'treeDense'] as const;
export type TreeKind = typeof TREE_KINDS[number];
export type SolidKind = "cottage" | "redCottage" | "townhouse" | "workshop" | "stall" | "redStall" | "hall" | "board"
  | TreeKind | 'shrub' | 'tower' | 'shed' | 'tent' | 'bazaar' | 'hiringBoard' | 'strategyBoard' | 'scoreBoard' | 'waypost' | 'mushroom';
/**
 * One build of a family: `size` scales it to its picture's footprint (its texture pixels stay the
 * village's size); `mirror` flips it left for right; `tone` and `plants` pick its roof shade and its
 * planting. Instances sharing a variant share one mesh.
 */
export type SolidVariant = { size: number; mirror: boolean; tone: 0 | 1; plants: 0 | 1 };
const PLAIN: SolidVariant = { size: 1, mirror: false, tone: 0, plants: 0 };

/** Every material a model may use, in atlas order. */
export const SOLID_MATERIALS = [
  // Surfaces, tiled (mirrored) across a face at the model's texel size.
  "plaster", "timber", "stone", "fieldstone", "thatch", "thatchUnder", "tiles", "tilesUnder", "planks", "darkPlanks",
  "canopy", "cloth", "crateWood", "boardBack", "boardRoof", "gold", "brass", "soil", "shadowWood", "clay",
  "thatchOld", "tilesBrown", "slate", "slateUnder", "shutterGreen", "canopyRed", "clothRed", "iron", "bark", "leaves", "leavesLight", "leavesDark", "canvasGreen", "mushroomCap",
  // Decals: one picture stretched once over its quad.
  "door", "window", "dormerWindow", "lantern", "flowerBox", "ivy",
  "hallDoor", "stainedWindow", "banner", "hallWindow", "trophy", "lamp",
  "canopyEdge", "tomatoes", "greens", "cauliflower", "barrel", "stallLantern", "clothFront",
  "boardDisplay", "boardRoofEdge", "gableWindow", "gableFlowers", "flowersBlue",
  "flowersRed", "flowersWhite", "fire", "anvil", "shield", "sacks", "cheese", "clothRedFront", "canopyRedEdge", "hiringDisplay", "strategyDisplay", "scoreDisplay",
] as const;
export type SolidMaterial = typeof SOLID_MATERIALS[number];
export const SOLID_DECALS: ReadonlySet<SolidMaterial> = new Set(SOLID_MATERIALS.slice(SOLID_MATERIALS.indexOf("door")));

/** Flat arrays ready for a GPU buffer: per vertex a position, a normal, a material UV and a material. */
export type SolidMesh = {
  kind: SolidKind;
  /** Family and variant: meshes with one key are one mesh. */
  key: string;
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

/** A wall's plane: `o` is its point at u = 0 on the ground, `n` its outward normal (level). */
type Wall = { o: V; n: V };
const UP: V = [0, 0, 1];
/** Along a wall, left to right as seen from outside it. */
const along = (w: Wall): V => cross(w.n, UP);
/** The point `u` along a wall, `z` up it and `d` out from it (negative: into the wall). */
const onWall = (w: Wall, u: number, z: number, d = 0): V => { const a = along(w); return [w.o[0] + a[0] * u + w.n[0] * d, w.o[1] + a[1] * u + w.n[1] * d, z]; };
/**
 * An opening through a wall, `recess` deep: a door or a window set back in it. `arch` rounds its
 * head; its pane is the picture (or surface) at the back of the recess.
 */
export type Opening = { u0: number; u1: number; z0: number; z1: number; recess: number; pane: SolidMaterial; reveal?: SolidMaterial; arch?: boolean };

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

  appendTriangle(vertices: V[], normal: V, material: SolidMaterial, uv: number[][]): void {
    for (let i = 0; i < 3; i++) {
      this.p.push(...vertices[i]!); this.n.push(...normal); this.uv.push(...uv[i]!); this.m.push(SOLID_MATERIALS.indexOf(material));
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

  /** A tiled face facing `normal`, whichever order its corners come in. */
  face(points: V[], normal: V, material: SolidMaterial): void {
    const [a, b, c, d] = points as [V, V, V, V | undefined];
    if (!d) { if (dot(cross(sub(c, a), sub(b, a)), normal) < 0) this.tri(a, c, b, material); else this.tri(a, b, c, material); return; }
    if (dot(cross(sub(d, a), sub(b, a)), normal) < 0) this.quad(a, d, c, b, material); else this.quad(a, b, c, d, material);
  }

  /**
   * A wall from u0 to u1 and z0 to z1, built around its openings: the solid parts as panels, each
   * opening with its jambs, sill and head (the wall's thickness) and its pane set back in it.
   */
  wall(w: Wall, u0: number, u1: number, z0: number, z1: number, openings: Opening[], material: SolidMaterial): void {
    const spring = (o: Opening) => o.arch ? o.z1 - (o.u1 - o.u0) / 2 : o.z1;
    const cut = (xs: number[], lo: number, hi: number) => [...new Set([lo, hi, ...xs.filter((x) => x > lo && x < hi)])].sort((a, b) => a - b);
    const us = cut(openings.flatMap((o) => [o.u0, o.u1]), u0, u1), zs = cut(openings.flatMap((o) => [o.z0, o.z1]), z0, z1);
    for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const uc = (us[i]! + us[i + 1]!) / 2, zc = (zs[j]! + zs[j + 1]!) / 2;
      if (openings.some((o) => uc > o.u0 && uc < o.u1 && zc > o.z0 && zc < o.z1)) continue;
      this.quad(onWall(w, us[i]!, zs[j]!), onWall(w, us[i + 1]!, zs[j]!), onWall(w, us[i + 1]!, zs[j + 1]!), onWall(w, us[i]!, zs[j + 1]!), material);
    }
    const a = along(w), N = 8;
    for (const o of openings) {
      const d = -o.recess, reveal = o.reveal ?? material, top = spring(o);
      this.face([onWall(w, o.u0, o.z0), onWall(w, o.u0, o.z0, d), onWall(w, o.u0, top, d), onWall(w, o.u0, top)], a, reveal);
      this.face([onWall(w, o.u1, o.z0), onWall(w, o.u1, o.z0, d), onWall(w, o.u1, top, d), onWall(w, o.u1, top)], [-a[0], -a[1], -a[2]], reveal);
      this.face([onWall(w, o.u0, o.z0), onWall(w, o.u1, o.z0), onWall(w, o.u1, o.z0, d), onWall(w, o.u0, o.z0, d)], UP, reveal);
      if (o.arch) {
        // The round head: the wall fills its corners, and its soffit curves through the wall.
        const r = (o.u1 - o.u0) / 2, cu = (o.u0 + o.u1) / 2;
        const arc = Array.from({ length: N + 1 }, (_, k) => { const t = Math.PI * k / N; return [cu + Math.cos(t) * r, top + Math.sin(t) * r] as const; });
        for (let k = 0; k < N; k++) {
          const [pu, pz] = arc[k]!, [qu, qz] = arc[k + 1]!, corner = k < N / 2 ? o.u1 : o.u0;
          this.face([onWall(w, corner, o.z1), onWall(w, pu, pz), onWall(w, qu, qz)], w.n, material);
          const t = Math.PI * (k + 0.5) / N, inward: V = [-(a[0] * Math.cos(t)), -(a[1] * Math.cos(t)), -Math.sin(t)];
          this.face([onWall(w, pu, pz), onWall(w, qu, qz), onWall(w, qu, qz, d), onWall(w, pu, pz, d)], inward, reveal);
        }
      } else this.face([onWall(w, o.u0, o.z1), onWall(w, o.u1, o.z1), onWall(w, o.u1, o.z1, d), onWall(w, o.u0, o.z1, d)], [0, 0, -1], reveal);
      this.quad(onWall(w, o.u0, o.z0, d), onWall(w, o.u1, o.z0, d), onWall(w, o.u1, o.z1, d), onWall(w, o.u0, o.z1, d), o.pane);
    }
  }

  /** A timber standing `proud` of a wall from (ua, za) to (ub, zb), `width` across: its face and both edges. */
  beam(w: Wall, ua: number, za: number, ub: number, zb: number, width: number, proud: number, material: SolidMaterial): void {
    const l = Math.hypot(ub - ua, zb - za) || 1, pu = -(zb - za) / l * width / 2, pz = (ub - ua) / l * width / 2;
    const A0 = onWall(w, ua - pu, za - pz, proud), B0 = onWall(w, ub - pu, zb - pz, proud), B1 = onWall(w, ub + pu, zb + pz, proud), A1 = onWall(w, ua + pu, za + pz, proud);
    this.face([A0, B0, B1, A1], w.n, material);
    const a = along(w), edge = (s: number): V => [a[0] * pu / (width / 2) * s, a[1] * pu / (width / 2) * s, pz / (width / 2) * s];
    this.face([onWall(w, ua + pu, za + pz), onWall(w, ub + pu, zb + pz), B1, A1], edge(1), material);
    this.face([onWall(w, ua - pu, za - pz), onWall(w, ub - pu, zb - pz), B0, A0], edge(-1), material);
  }

  /**
   * A hipped roof with real thickness: eaves round the rectangle x0..x1, y0..y1 at `eave`, a ridge
   * from rx0 to rx1 along y = 0 at `ridge`; undersides `thick` below, and the eaves' edge between.
   * `valley` ends the front slope along the line where a cross-gable's roof meets it, from its eave
   * at `eave` x to the ridge at `ridge` x, so the two roofs join with neither gap nor overlap.
   */
  hipRoof(x0: number, x1: number, y0: number, y1: number, rx0: number, rx1: number, eave: number, ridge: number, thick: number, top: SolidMaterial, under: SolidMaterial, valley?: { eave: number; ridge: number }): void {
    const f = valley?.eave ?? x0;
    const shapes: [V[], V][] = [
      [[[f, y1, eave], [x1, y1, eave], [rx1, 0, ridge], [valley?.ridge ?? rx0, 0, ridge]], [0, 1, 1]],
      [[[x1, y0, eave], [x0, y0, eave], [rx0, 0, ridge], [rx1, 0, ridge]], [0, -1, 1]],
      [[[x0, y0, eave], [x0, y1, eave], [rx0, 0, ridge]], [-1, 0, 1]],
      [[[x1, y1, eave], [x1, y0, eave], [rx1, 0, ridge]], [1, 0, 1]],
    ];
    for (const [points, normal] of shapes) {
      this.face(points, normal, top);
      this.face(points.map((p) => [p[0], p[1], p[2] - thick] as V), [-normal[0], -normal[1], -normal[2]], under);
    }
    const corners: V[] = [[f, y1, eave], [x1, y1, eave], [x1, y0, eave], [x0, y0, eave]], normals: V[] = [[0, 1, 0], [1, 0, 0], [0, -1, 0], [-1, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!, q = i === 3 ? [x0, y1, eave] as V : corners[(i + 1) % 4]!;
      this.face([[p[0], p[1], p[2] - thick], [q[0], q[1], q[2] - thick], q, p], normals[i]!, top);
    }
  }

  /**
   * A gable roof whose ridge runs front to back (along y) at x = cx: slopes down to eaves at
   * cx ± half, from y0 back to y1 front; thick slabs, undersides and the verge at the front.
   */
  crossGable(cx: number, half: number, y0: number, y1: number, eave: number, ridge: number, thick: number, top: SolidMaterial, under: SolidMaterial): void {
    for (const s of [-1, 1] as const) {
      const e = cx + s * half, n: V = [s, 0, half / Math.max(1, ridge - eave)];
      const points: V[] = [[e, y0, eave], [e, y1, eave], [cx, y1, ridge], [cx, y0, ridge]];
      this.face(points, n, top);
      this.face(points.map((p) => [p[0], p[1], p[2] - thick] as V), [-n[0], 0, -n[2]], under);
      this.face([[e, y0, eave - thick], [e, y1, eave - thick], [e, y1, eave], [e, y0, eave]], [s, 0, 0], top);
      this.face([[e, y1, eave - thick], [cx, y1, ridge - thick], [cx, y1, ridge], [e, y1, eave]], [0, 1, 0], top);
    }
  }

  done(kind: SolidKind): SolidMesh {
    const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, this.p[i + k]!); max[k] = Math.max(max[k]!, this.p[i + k]!); }
    return { kind, key: kind, positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv), materials: new Float32Array(this.m),
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

/**
 * The gold cottage, cottage-gold.png rebuilt as one closed building at its own proportions (one
 * picture pixel = 0.55 world units). A long plastered, timber-framed block on a stone footing under
 * a heavy hipped thatch; at its front left a cross-gable whose framed plaster triangle stands over
 * the arched plank door, with a little leaded window and flower box in it; at the front right the
 * shuttered window and its flower box; a thatched dormer over that on the slope; a fieldstone
 * chimney with a clay pot by the right hip; ivy at both front corners, pots by the door. Doors and
 * windows are real openings: their reveals show the wall's thickness and their panes sit inside.
 */
type CottageStyle = { roof: SolidMaterial; under: SolidMaterial; porch: boolean; flowers: SolidMaterial };
function cottage(v: SolidVariant, red = false): SolidMesh {
  const b = new Builder(0.55 / v.size);
  const style: CottageStyle = red
    ? { roof: v.tone ? "tilesBrown" : "tiles", under: "tilesUnder", porch: true, flowers: "flowersRed" }
    : { roof: v.tone ? "thatchOld" : "thatch", under: "thatchUnder", porch: false, flowers: "flowersBlue" };
  const W = 29, D = 18, base = 3, top = 26;
  const front: Wall = { o: [0, D, 0], n: [0, 1, 0] }, back: Wall = { o: [0, -D, 0], n: [0, -1, 0] };
  const left: Wall = { o: [-W, 0, 0], n: [-1, 0, 0] }, right: Wall = { o: [W, 0, 0], n: [1, 0, 0] };
  // Footing and step, in the picture's fieldstone.
  b.box(-W - 1.2, -D - 1.2, 0, W + 1.2, D + 1.2, base, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  b.box(-20, D + 1.2, 0, -8, D + 4.5, 2.2, { front: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  // Walls round the openings. Front: the arched door under the gable, the shuttered window right.
  b.wall(front, -W, W, base, top, [
    { u0: -19, u1: -9, z0: base, z1: 22, recess: 1.8, pane: "door", reveal: "timber", arch: true },
    { u0: 9.5, u1: 18.5, z0: 9, z1: 19, recess: 1.4, pane: "window", reveal: "plaster" },
  ], "plaster");
  // Back (u runs west): two windows and a plank door; ends: a window each.
  b.wall(back, -W, W, base, top, [
    { u0: 9, u1: 17, z0: 10, z1: 19, recess: 1.4, pane: "window" },
    { u0: -18, u1: -10, z0: 10, z1: 19, recess: 1.4, pane: "window" },
    { u0: -5, u1: 2, z0: base, z1: 19, recess: 1.6, pane: "darkPlanks", reveal: "timber" },
  ], "plaster");
  b.wall(left, -D, D, base, top, [{ u0: -4, u1: 4, z0: 11, z1: 19, recess: 1.4, pane: "window" }], "plaster");
  b.wall(right, -D, D, base, top, [{ u0: -4, u1: 4, z0: 11, z1: 19, recess: 1.4, pane: "window" }], "plaster");
  // Timber framing proud of the plaster, all round: posts, sill, wall plate and studs beside the openings.
  for (const [w, half, studs] of [[front, W, [-21, -7, 7.5, 20.5]], [back, W, [-20, -8, 7, 19]], [left, D, [-6, 6]], [right, D, [-6, 6]]] as const) {
    for (const u of [-half + 0.8, half - 0.8, ...studs]) b.beam(w, u, base, u, top, 1.6, 0.5, "timber");
    b.beam(w, -half, base + 0.7, half, base + 0.7, 1.4, 0.45, "timber");
    b.beam(w, -half, top - 0.7, half, top - 0.7, 1.4, 0.5, "timber");
    b.beam(w, -half, 14.5, half, 14.5, 1.1, 0.4, "timber");
  }
  // The hipped thatch, thick, its eaves overhanging, and a rolled ridge.
  const E = 24.5, R = 50, T = 3;
  const cx = -14, gw = 15, apex = 46;
  // The cross-gable's right slope meets the front slope along the valley from (cx + gw + 3, eave) to the ridge at cx.
  b.hipRoof(-W - 4, W + 4, -D - 4, D + 4, cx, 12, E, R, T, style.roof, style.under, { eave: cx + gw + 3, ridge: cx });
  b.box(cx - 0.5, -1.6, R - 1.4, 12.5, 1.6, R + 1.2, { top: style.roof, front: style.roof, back: style.roof, left: style.roof, right: style.roof });
  // The cross-gable over the door: its own thatch from the main roof out past the front wall, and
  // under it the framed plaster triangle with its little window and flower box.
  b.crossGable(cx, gw + 3, 0, D + 5, E, R, T, style.roof, style.under);
  b.face([[cx - gw, D, top], [cx + gw, D, top], [cx, D, apex]], [0, 1, 0], "plaster");
  b.beam(front, cx, top, cx, apex - 1, 1.5, 0.5, "timber");
  b.beam(front, cx - gw + 1.5, top + 0.5, cx - 1, apex - 3, 1.4, 0.5, "timber");
  b.beam(front, cx + gw - 1.5, top + 0.5, cx + 1, apex - 3, 1.4, 0.5, "timber");
  b.beam(front, cx - 9, 36.5, cx + 9, 36.5, 1.2, 0.5, "timber");
  b.decal("front", cx, D, -4.2, 4.2, 28.5, 35.8, "gableWindow", 0.6);
  for (const [u0, z0, u1, z1] of [[cx - 4.8, 28, cx + 4.8, 28], [cx - 4.8, 36.2, cx + 4.8, 36.2], [cx - 4.8, 28, cx - 4.8, 36.2], [cx + 4.8, 28, cx + 4.8, 36.2]] as const) b.beam(front, u0, z0, u1, z1, 1, 0.8, "timber");
  b.box(cx - 8, D, 26, cx + 8, D + 2.6, 28, { front: "planks", top: "soil", left: "planks", right: "planks", bottom: "planks" });
  b.card(cx, D + 1.3, 17, 27.5, 31.5, "gableFlowers");
  // The door's timber surround, the lantern on its bracket.
  b.beam(front, -19.8, base, -19.8, 17, 1.4, 0.7, "timber"); b.beam(front, -8.2, base, -8.2, 17, 1.4, 0.7, "timber");
  b.box(-6.9, D, 19, -5.9, D + 3, 19.8, "timber");
  b.card(-6.4, D + 2.6, 3.8, 12.5, 19, "lantern"); b.card(-6.4, D + 2.6, 3.8, 12.5, 19, "lantern", "y");
  // The front window's shutters, sill and flower box.
  for (const [x0, x1] of [[6.8, 9.4], [18.6, 21.2]] as const) b.box(x0, D, 9, x1, D + 0.8, 19, { front: "planks", left: "planks", right: "planks", top: "planks" });
  b.box(9, D, 8.2, 19, D + 1.6, 9, "fieldstone");
  b.box(8.6, D, 6, 19.4, D + 3, 8.2, { front: "planks", top: "soil", left: "planks", right: "planks" });
  b.card(14, D + 1.5, 12, 7.5, 11.5, red ? "flowersRed" : "flowerBox");
  // The red cottage's little tiled porch over its door, on two brackets.
  if (style.porch) {
    b.crossGable(-14, 8, D, D + 6, 22.5, 26.5, 1.2, style.roof, style.under);
    for (const x of [-21, -7]) b.box(x - 0.6, D, 19, x + 0.6, D + 5, 20, "timber");
  }
  // The dormer on the front slope over that window: plastered cheeks, a recessed leaded window,
  // its own small thatch.
  const dormer: Wall = { o: [0, 16.5, 0], n: [0, 1, 0] };
  b.wall(dormer, 8, 20, 27.5, 37, [{ u0: 10.8, u1: 17.2, z0: 29, z1: 35.5, recess: 1, pane: "dormerWindow" }], "plaster");
  for (const [x, s] of [[8, -1], [20, 1]] as const) b.face([[x, 6, 27.5], [x, 16.5, 27.5], [x, 16.5, 37], [x, 6, 37]], [s, 0, 0], "plaster");
  b.face([[8, 16.5, 37], [20, 16.5, 37], [14, 16.5, 41.5]], [0, 1, 0], "plaster");
  b.crossGable(14, 7.6, 3, 19, 36.4, 43, 2.2, style.roof, style.under);
  // The chimney by the right hip: fieldstone, a corbelled top, a clay pot.
  b.box(17, -7, 26, 24.5, 0, 62, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone" });
  b.box(16.3, -7.7, 59.5, 25.2, 0.7, 61.5, "fieldstone");
  b.drum(20.75, -3.5, 2.1, 61.5, 65.5, 8, "clay", "shadowWood");
  // Ivy up both front corners and pots of flowers by the step, each a crossed pair, as the picture's planting.
  const ivy = v.plants ? [[-W - 0.6, 24]] : [[-W - 0.6, 24], [W + 0.6, 20]];
  for (const [x, h] of ivy as [number, number][]) { b.card(x, D + 0.8, 8, 0, h, "ivy"); b.card(x, D + 0.8, 7, 0, h, "ivy", "y"); }
  for (const x of v.plants ? [-23.5, -3.5, 23] : [-23.5, -3.5]) {
    b.drum(x, D + 3.2, 1.7, 0, 2.6, 8, "clay", "soil");
    b.card(x, D + 3.2, 5, 2, 6.5, style.flowers); b.card(x, D + 3.2, 5, 2, 6.5, style.flowers, "y");
  }
  if (red) { b.drum(25, D + 4, 2.6, 0, 6, 8, "crateWood", "shadowWood"); b.drum(-27, -D - 3.5, 2.6, 0, 6, 8, "crateWood", "shadowWood"); }
  return b.done(red ? "redCottage" : "cottage");
}

/**
 * The Hall of Fame (hall-of-fame.png): a stone ground floor with an arched door on steps, a
 * timber-and-plaster upper floor, a tall front gable with its stained window and banners, red-tiled
 * wings with pointed roofs, and pinnacles at the gable's corners.
 */
function hall(v: SolidVariant): SolidMesh {
  const b = new Builder(1.2 / v.size);
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
function stall(v: SolidVariant, red = false): SolidMesh {
  const b = new Builder(0.55 / v.size);
  const canopy: SolidMaterial = red ? "canopyRed" : "canopy", cloth: SolidMaterial = red ? "clothRed" : "cloth";
  const edge: SolidMaterial = red ? "canopyRedEdge" : "canopyEdge";
  const W = 44, D = 22;
  for (const x of [-W, W]) for (const y of [-D, D]) b.box(x - 2.5, y - 2.5, 0, x + 2.5, y + 2.5, y > 0 ? 70 : 84, { front: "planks", back: "planks", left: "planks", right: "planks", top: "darkPlanks" });
  // The canopy: a cloth roof sloping down to the front, with its scalloped edge hanging there.
  const front: V[] = [[-W - 6, D + 6, 72], [W + 6, D + 6, 72]], back: V[] = [[-W - 4, -D - 2, 86], [W + 4, -D - 2, 86]];
  b.quad(front[0]!, front[1]!, back[1]!, back[0]!, canopy);
  b.quad(back[0]!, back[1]!, front[1]!, front[0]!, cloth);
  b.quad([-W - 6, D + 6, 62], [W + 6, D + 6, 62], [W + 6, D + 6, 72], [-W - 6, D + 6, 72], edge);
  b.quad([W + 6, D + 6, 62], [-W - 6, D + 6, 62], [-W - 6, D + 6, 72], [W + 6, D + 6, 72], edge);
  b.box(-W - 4, -D - 3, 84, W + 4, -D - 1, 87, "darkPlanks");
  // The counter: crate-wood sides, a cloth hanging at the front, three crates of produce on top.
  b.box(-W + 4, 2, 0, W - 4, D, 30, { top: "planks", back: "crateWood", left: "crateWood", right: "crateWood", front: cloth });
  b.decal("front", 0, D, -W + 4, W - 4, 2, 28, red ? "clothRedFront" : "clothFront", 0.15);
  // The red stall sells grain and cheese (market-red.png): sacks stand by its counter.
  if (red) for (const x of [-W - 2, W - 6]) { b.card(x, D + 4, 12, 0, 15, "sacks"); b.card(x, D + 4, 12, 0, 15, "sacks", "y"); }
  for (const [i, produce] of ((red ? ["cheese", "sacks", "cheese"] : ["tomatoes", "greens", "cauliflower"]) as SolidMaterial[]).entries()) {
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
  return b.done(red ? "redStall" : "stall");
}

/** The Notice Board (leaderboard.png): a display on a framed panel with real thickness, two posts, a little roof. */
function board(v: SolidVariant, kind: SolidKind = 'board', display: SolidMaterial = 'boardDisplay'): SolidMesh {
  const b = new Builder(1.6 / v.size);
  const W = 60, T = 3, z0 = 28, z1 = 102;
  for (const x of [-W + 8, W - 8]) b.box(x - 3.5, -3.5, 0, x + 3.5, 3.5, z1 + 6, { front: "planks", back: "planks", left: "planks", right: "planks", top: "darkPlanks" });
  // The panel: wood behind, the frame's gold edge all round, the display inset on its front.
  b.box(-W, -T, z0, W, T, z1, { back: "boardBack", left: "gold", right: "gold", top: "gold", bottom: "gold", front: "gold" });
  b.decal("front", 0, T, -W + 3, W - 3, z0 + 3, z1 - 3, display, 0.1);
  // Cross braces and a bar on the back, so its rear reads as the board's own frame.
  b.box(-W + 4, -T - 1.6, (z0 + z1) / 2 - 2, W - 4, -T, (z0 + z1) / 2 + 2, "darkPlanks");
  for (const x of [-W / 2, W / 2]) b.box(x - 2, -T - 1.6, z0 + 2, x + 2, -T, z1 - 2, "darkPlanks");
  // A shallow roof over it.
  b.gableRoof(-W - 6, W + 6, 10, z1 + 4, z1 + 13, 1.6, "boardRoof", "darkPlanks");
  b.quad([-W - 6, 10, z1 + 1], [W + 6, 10, z1 + 1], [W + 6, 10, z1 + 4.2], [-W - 6, 10, z1 + 4.2], "boardRoofEdge");
  return b.done(kind);
}

/**
 * The two-storey residence (cottage-green.png): narrow and deep, its gable to the front, timber-framed
 * plaster on a stone footing, the upper floor jettied out over the lower; green-shuttered windows
 * with flower boxes on both floors, the door to the left, thatch, a chimney at the back right.
 */
function townhouse(v: SolidVariant): SolidMesh {
  const b = new Builder(0.55 / v.size);
  const W = 19, D = 22, base = 3, floor = 25, top = 46, J = 1.6, roof: SolidMaterial = v.tone ? "thatchOld" : "thatch";
  const front: Wall = { o: [0, D, 0], n: [0, 1, 0] }, upper: Wall = { o: [0, D + J, 0], n: [0, 1, 0] }, back: Wall = { o: [0, -D, 0], n: [0, -1, 0] };
  const left: Wall = { o: [-W, 0, 0], n: [-1, 0, 0] }, right: Wall = { o: [W, 0, 0], n: [1, 0, 0] };
  b.box(-W - 1.2, -D - 1.2, 0, W + 1.2, D + 1.2, base, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  b.box(-14, D + 1.2, 0, -4, D + 4.5, 2.2, { front: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  // Ground floor, the upper floor jettied out over it, and its overhang's underside.
  b.wall(front, -W, W, base, floor, [
    { u0: -14, u1: -5, z0: base, z1: 21, recess: 1.8, pane: "door", reveal: "timber", arch: true },
    { u0: 4, u1: 13, z0: 9, z1: 19, recess: 1.4, pane: "window" },
  ], "plaster");
  b.wall(upper, -W, W, floor, top, [{ u0: -5, u1: 5, z0: 30, z1: 40, recess: 1.4, pane: "window" }], "plaster");
  b.face([[-W, D, floor], [W, D, floor], [W, D + J, floor], [-W, D + J, floor]], [0, 0, -1], "timber");
  for (const s of [-1, 1] as const) b.face([[s * W, D, floor], [s * W, D + J, floor], [s * W, D + J, top], [s * W, D, top]], [s, 0, 0], "plaster");
  for (const [w, z0, z1, holes] of [[back, base, top, [{ u0: -12, u1: -4, z0: 9, z1: 18, recess: 1.4, pane: "window" as SolidMaterial }, { u0: 4, u1: 12, z0: 30, z1: 39, recess: 1.4, pane: "window" as SolidMaterial }]],
    [left, base, top, [{ u0: -4, u1: 4, z0: 30, z1: 39, recess: 1.4, pane: "window" as SolidMaterial }]], [right, base, top, [{ u0: -4, u1: 4, z0: 10, z1: 19, recess: 1.4, pane: "window" as SolidMaterial }]]] as const) {
    b.wall(w, w === back ? -W : -D, w === back ? W : D, z0, z1, [...holes], "plaster");
  }
  // Framing on both floors, every side.
  for (const [w, half, studs, z0, z1] of [[front, W, [-15.5, -3.5, 2.5, 14.5], base, floor], [upper, W, [-7, 7], floor, top], [back, W, [-14, 0, 14], base, top], [left, D, [-8, 8], base, top], [right, D, [-8, 8], base, top]] as const) {
    for (const u of [-half + 0.8, half - 0.8, ...studs]) b.beam(w, u, z0, u, z1, 1.6, 0.5, "timber");
    b.beam(w, -half, z0 + 0.7, half, z0 + 0.7, 1.4, 0.45, "timber");
    b.beam(w, -half, z1 - 0.7, half, z1 - 0.7, 1.4, 0.5, "timber");
  }
  b.beam(back, -W, floor, W, floor, 1.4, 0.5, "timber"); b.beam(left, -D, floor, D, floor, 1.4, 0.5, "timber"); b.beam(right, -D, floor, D, floor, 1.4, 0.5, "timber");
  // Green shutters and flower boxes at both front windows.
  for (const [x, z0, z1, y] of [[8.5, 9, 19, D], [0, 30, 40, D + J]] as const) {
    for (const s of [-1, 1]) b.box(x + s * 4.5 + (s < 0 ? -2.6 : 0), y, z0, x + s * 4.5 + (s > 0 ? 2.6 : 0), y + 0.8, z1, { front: "shutterGreen", left: "shutterGreen", right: "shutterGreen", top: "shutterGreen" });
    b.box(x - 5.4, y, z0 - 2.4, x + 5.4, y + 2.8, z0 - 0.2, { front: "planks", top: "soil", left: "planks", right: "planks" });
    b.card(x, y + 1.4, 11, z0 - 1, z0 + 3, "flowersWhite");
  }
  // The thatch, ridge front to back, its gable over the jetty; a plaster gable with a king post.
  b.crossGable(0, W + 4.5, -D - 4, D + J + 4, top - 2, 76, 3, roof, "thatchUnder");
  b.face([[-W, D + J, top], [W, D + J, top], [0, D + J, 72]], [0, 1, 0], "plaster");
  b.face([[W, -D, top], [-W, -D, top], [0, -D, 72]], [0, -1, 0], "plaster");
  b.beam(upper, 0, top, 0, 71, 1.5, 0.5, "timber"); b.beam(upper, -12, top + 0.5, 0, 66, 1.3, 0.5, "timber"); b.beam(upper, 12, top + 0.5, 0, 66, 1.3, 0.5, "timber");
  b.box(9, -14, 50, 16, -7, 84, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone" });
  b.box(8.3, -14.7, 81.5, 16.7, -6.3, 83.5, "fieldstone");
  b.drum(12.5, -10.5, 2, 83.5, 87.5, 8, "clay", "shadowWood");
  b.box(14, D + 2.5, 15, 15, D + 3.5, 16, "timber"); b.card(14.5, D + 3.2, 3.6, 9, 15, "lantern"); b.card(14.5, D + 3.2, 3.6, 9, 15, "lantern", "y");
  for (const x of v.plants ? [-17, 17] : [-17]) { b.drum(x, D + 3, 2, 0, 3, 8, "clay", "soil"); b.card(x, D + 3, 6, 2, 8, "flowersWhite"); b.card(x, D + 3, 6, 2, 8, "flowersWhite", "y"); }
  b.card(-W - 0.6, D + 0.8, 8, 0, 22, "ivy", "y");
  return b.done("townhouse");
}

/**
 * The workshop (smithy.png): a stone ground floor and an open forge bay under a slate roof whose
 * front gable shows its timber truss; a lean-to on the right; the anvil, a stone wheel and a
 * hanging shield sign out front; a stone chimney rising from the forge at the back.
 */
function workshop(v: SolidVariant): SolidMesh {
  const b = new Builder(0.55 / v.size);
  const W = 30, D = 20, base = 3, top = 30;
  const front: Wall = { o: [0, D, 0], n: [0, 1, 0] }, back: Wall = { o: [0, -D, 0], n: [0, -1, 0] };
  const left: Wall = { o: [-W, 0, 0], n: [-1, 0, 0] }, right: Wall = { o: [W, 0, 0], n: [1, 0, 0] };
  b.box(-W - 1.2, -D - 1.2, 0, W + 1.2, D + 1.2, base, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone", top: "fieldstone" });
  // The forge bay: a deep opening with the fire at its back and the hearth before it.
  b.wall(front, -W, W, base, top, [
    { u0: -24, u1: -6, z0: base, z1: 22, recess: 7, pane: "fire", reveal: "fieldstone" },
    { u0: 6, u1: 14, z0: base, z1: 21, recess: 1.6, pane: "darkPlanks", reveal: "timber" },
    { u0: 18, u1: 25, z0: 11, z1: 19, recess: 1.4, pane: "window" },
  ], "fieldstone");
  b.box(-23, D - 7, base, -7, D - 2, 8, { top: "fieldstone", front: "fieldstone", left: "fieldstone", right: "fieldstone" });
  b.wall(back, -W, W, base, top, [{ u0: -10, u1: 0, z0: 11, z1: 20, recess: 1.4, pane: "window" }], "fieldstone");
  b.wall(left, -D, D, base, top, [{ u0: -5, u1: 5, z0: 11, z1: 20, recess: 1.4, pane: "window" }], "fieldstone");
  b.wall(right, -D, D, base, top, [], "fieldstone");
  for (const [w, half] of [[front, W], [back, W], [left, D], [right, D]] as const) {
    for (const u of [-half + 0.9, half - 0.9]) b.beam(w, u, base, u, top, 2, 0.6, "timber");
    b.beam(w, -half, top - 0.8, half, top - 0.8, 1.8, 0.6, "timber");
  }
  // Slate roof, ridge front to back, with the truss in its gable: posts, tie beam and braces.
  b.crossGable(0, W + 4, -D - 4, D + 5, top - 1.5, 62, 2.6, "slate", "slateUnder");
  for (const [y, n] of [[D, 1], [-D, -1]] as const) b.face([[-W, y, top], [W, y, top], [0, y, 59]], [0, n, 0], "plaster");
  for (const w of [front, back]) {
    b.beam(w, -W + 1, top + 1, 0, 58, 2, 0.7, "timber"); b.beam(w, W - 1, top + 1, 0, 58, 2, 0.7, "timber");
    b.beam(w, 0, top, 0, 58, 1.8, 0.7, "timber"); b.beam(w, -16, top + 1, 0, 46, 1.4, 0.6, "timber"); b.beam(w, 16, top + 1, 0, 46, 1.4, 0.6, "timber");
  }
  // The lean-to on the right, under its own slate.
  b.box(W, -14, base, W + 13, 8, 18, { front: "fieldstone", back: "fieldstone", right: "fieldstone" });
  b.quad([W, 10, 25], [W + 15, 10, 19], [W + 15, -16, 19], [W, -16, 25], "slate");
  b.quad([W + 15, 10, 18], [W, 10, 24], [W, -16, 24], [W + 15, -16, 18], "slateUnder");
  // The chimney from the forge, the anvil and wheel out front, the sign on its bracket.
  b.box(-22, -14, base, -12, -4, 78, { front: "fieldstone", back: "fieldstone", left: "fieldstone", right: "fieldstone" });
  b.box(-22.8, -14.8, 75, -11.2, -3.2, 77.5, "fieldstone");
  b.drum(-17, -9, 2.4, 77.5, 81, 8, "clay", "shadowWood");
  b.drum(-15, D + 9, 3.2, 0, 7, 8, "darkPlanks", "darkPlanks");
  b.card(-15, D + 9, 12, 7, 14, "anvil"); b.card(-15, D + 9, 8, 7, 14, "anvil", "y");
  b.drum(4, D + 8, 4.5, 0, 9, 10, "fieldstone", "fieldstone");
  b.box(W - 2, D, 26, W - 1, D + 8, 27, "timber");
  b.card(W - 1.5, D + 6.5, 8, 15, 25.5, "shield"); b.card(W - 1.5, D + 6.5, 6, 15, 25.5, "shield", "y");
  if (v.plants) b.card(-W - 0.6, D + 0.8, 8, 0, 20, "ivy", "y");
  return b.done("workshop");
}

/** A tapered solid branch, including its end faces. */
function branch(b: Builder, start: V, end: V, r0: number, r1: number) {
  const axis = unit(sub(end, start)), a = unit(cross(axis, Math.abs(axis[2]) > .9 ? [1, 0, 0] : UP)), c = cross(axis, a);
  const rim = (p: V, r: number, i: number): V => {
    const t = i * Math.PI / 4;
    return [0, 1, 2].map(k => p[k]! + r * (a[k]! * Math.cos(t) + c[k]! * Math.sin(t))) as V;
  };
  for (let i = 0; i < 8; i++) {
    const p = rim(start, r0, i), q = rim(start, r0, i + 1), r = rim(end, r1, i + 1), s = rim(end, r1, i);
    b.face([p, q, r, s], sub(p, start), 'bark');
    b.face([s, r, end], axis, 'bark');
    b.face([q, p, start], [-axis[0], -axis[1], -axis[2]], 'bark');
  }
}

/** Closed faceted foliage lobes. Every face is a textured solid surface, never a sprite card. */
function crown(b: Builder, centre: V, radius: V, seed: number) {
  const ring = (j: number, i: number): V => {
    i %= 10; // The final segment must meet the first, including the radial irregularity.
    const a = i * Math.PI / 5, t = j * Math.PI / 5;
    const wobble = 1 + .06 * Math.sin(i * 2.3 + j + seed);
    return [centre[0] + Math.cos(a) * Math.sin(t) * radius[0] * wobble,
      centre[1] + Math.sin(a) * Math.sin(t) * radius[1] * wobble, centre[2] + Math.cos(t) * radius[2]];
  };
  for (let j = 0; j < 5; j++) for (let i = 0; i < 10; i++) {
    const a = ring(j, i), c = ring(j + 1, i), d = ring(j + 1, i + 1), e = ring(j, i + 1);
    const material = j >= 3 ? 'leavesDark' : (i + seed) % 4 === 0 ? 'leavesLight' : 'leaves';
    const n = sub(c, centre);
    if (j === 0) b.face([a, c, d], n, material);
    else if (j === 4) b.face([a, c, e], sub(a, centre), material);
    else { b.face([a, c, d], n, material); b.face([a, d, e], sub(e, centre), material); }
  }
}

/** Seven related broadleaf silhouettes, with roots, tapered trunks, branching and closed crowns. */
function tree(kind: TreeKind | 'shrub', v: SolidVariant): SolidMesh {
  const b = new Builder(2 / v.size);
  if (kind === 'shrub') {
    crown(b, [-12, 0, 16], [18, 16, 16], 2); crown(b, [12, 3, 18], [20, 18, 18], 4);
    crown(b, [0, -8, 22], [18, 16, 22], 7);
    return b.done(kind);
  }
  const index = TREE_KINDS.indexOf(kind);
  const specs = [
    { trunk: 47, r: 5, crown: 81, spread: 30, tall: 29, lobes: 4 },
    { trunk: 70, r: 7, crown: 112, spread: 43, tall: 38, lobes: 5 },
    { trunk: 80, r: 9, crown: 127, spread: 54, tall: 48, lobes: 6 },
    { trunk: 61, r: 7, crown: 103, spread: 48, tall: 42, lobes: 5 },
    { trunk: 93, r: 7, crown: 140, spread: 34, tall: 47, lobes: 5 },
    { trunk: 76, r: 6, crown: 119, spread: 38, tall: 29, lobes: 3 },
    { trunk: 64, r: 8, crown: 112, spread: 51, tall: 46, lobes: 7 },
  ][index]!;
  const { trunk, r, spread, tall, lobes } = specs;
  b.drum(0, 0, r * 1.4, 0, 9, 8, 'bark', 'bark');
  branch(b, [0, 0, 8], [3, -2, trunk + 25], r, r * .55);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + index * .4;
    branch(b, [0, 0, 6], [Math.cos(a) * r * 2.4, Math.sin(a) * r * 2.4, 3], r * .45, 1.7);
  }
  for (let i = 0; i < lobes; i++) {
    const a = i * Math.PI * 2 / lobes + index * .47;
    const x = Math.cos(a) * spread * .48, y = Math.sin(a) * spread * .48;
    const z = specs.crown - 9 + (i % 3) * 6;
    branch(b, [2, -1, trunk - 10 + (i % 2) * 8], [x, y, z], r * .5, 1.8);
    crown(b, [x, y, z], [spread * .63, spread * .58, tall * .8], index + i);
  }
  crown(b, [3, -4, specs.crown + tall * .24], [spread * .64, spread * .61, tall * .82], index + 8);
  return b.done(kind);
}

function tower(v: SolidVariant): SolidMesh {
  const b = new Builder(.7 / v.size), W = 23, D = 20;
  for (const x of [-W, W]) for (const y of [-D, D]) {
    b.box(x - 3, y - 3, 0, x + 3, y + 3, 98, 'timber');
    b.box(x - 4, y - 4, 0, x + 4, y + 4, 6, 'fieldstone');
  }
  b.box(-W - 5, -D - 5, 65, W + 5, D + 5, 70, 'planks');
  for (const z of [72, 86]) {
    for (const y of [-D - 4, D + 4]) b.box(-W - 4, y - 1, z, W + 4, y + 1, z + 3, 'planks');
    for (const x of [-W - 4, W + 4]) b.box(x - 1, -D - 4, z, x + 1, D + 4, z + 3, 'planks');
  }
  for (const x of [-9, 9]) b.box(x - 1.5, D + 4, 0, x + 1.5, D + 7, 69, 'timber');
  for (let z = 6; z < 67; z += 8) b.box(-9, D + 4, z, 9, D + 7, z + 2, 'planks');
  b.gableRoof(-W - 8, W + 8, D + 8, 96, 119, 3, 'thatch', 'thatchUnder');
  return b.done('tower');
}

function shed(v: SolidVariant): SolidMesh {
  const b = new Builder(.55 / v.size), W = 29, D = 20, top = 34;
  b.box(-W - 1, -D - 1, 0, W + 1, D + 1, 4, 'fieldstone');
  const front: Wall = { o: [0, D, 0], n: [0, 1, 0] };
  b.wall(front, -W, W, 4, top, [{ u0: -9, u1: 9, z0: 4, z1: 29, recess: 3, pane: 'darkPlanks', reveal: 'timber' }], 'planks');
  b.box(-W, -D, 4, W, D, top, { back: 'planks', left: 'planks', right: 'planks' });
  b.gableEnd(W, 1, D, top, top, 48, 'planks'); b.gableEnd(-W, -1, D, top, top, 48, 'planks');
  b.gableRoof(-W - 4, W + 4, D + 4, top - 1, 51, 2, 'slate', 'slateUnder');
  for (const wall of ['left', 'right'] as const) b.decal(wall, 0, wall === 'left' ? -W : W, -4, 4, 16, 24, 'window');
  for (const x of [-W + 1, W - 1]) b.beam(front, x, 4, x, top, 2, .6, 'timber');
  return b.done('shed');
}

function tent(v: SolidVariant): SolidMesh {
  const b = new Builder(1 / v.size), W = 36, D = 28, H = 48;
  b.face([[-W, D, 0], [0, D, H], [0, -D, H], [-W, -D, 0]], [-1, 0, 1], 'canvasGreen');
  b.face([[0, D, H], [W, D, 0], [W, -D, 0], [0, -D, H]], [1, 0, 1], 'canvasGreen');
  b.face([[W, -D, 0], [-W, -D, 0], [0, -D, H]], [0, -1, 0], 'canvasGreen');
  // Opening only at the front: separate triangular canvas flaps around a dark interior.
  b.face([[-W, D, 0], [-10, D, 0], [0, D, H]], [0, 1, 0], 'canvasGreen');
  b.face([[10, D, 0], [W, D, 0], [0, D, H]], [0, 1, 0], 'canvasGreen');
  b.face([[-10, D - 4, 0], [10, D - 4, 0], [0, D - 4, H - 5]], [0, 1, 0], 'shadowWood');
  for (const y of [-D, D]) b.box(-1.5, y - 1.5, 0, 1.5, y + 1.5, H + 3, 'timber');
  for (const x of [-W - 4, W + 4]) for (const y of [-D - 4, D + 4]) b.box(x - 1, y - 1, 0, x + 1, y + 1, 5, 'timber');
  return b.done('tent');
}

function bazaar(v: SolidVariant): SolidMesh {
  const b = new Builder(.55 / v.size);
  // Reuse the exact working stall geometry for a group, instead of a painted stall facade.
  for (const [i, x] of [-72, 72].entries()) {
    const mesh = stall(v, i === 1);
    for (let t = 0; t < mesh.positions.length; t += 9) {
      const vertices = [0, 3, 6].map(k => [mesh.positions[t + k]! + x, mesh.positions[t + k + 1]!, mesh.positions[t + k + 2]!] as V);
      const n: V = [mesh.normals[t]!, mesh.normals[t + 1]!, mesh.normals[t + 2]!];
      const material = SOLID_MATERIALS[mesh.materials[t / 3]!]!;
      // Preserve the source UVs, including decal crops, when joining existing models.
      b.appendTriangle(vertices, n, material, [0, 2, 4].map(k => [mesh.uvs[t / 3 * 2 + k]!, mesh.uvs[t / 3 * 2 + k + 1]!]));
    }
  }
  return b.done('bazaar');
}

function waypost(v: SolidVariant): SolidMesh {
  const b = new Builder(.6 / v.size);
  b.box(-3, -3, 0, 3, 3, 58, 'timber');
  b.drum(0, 0, 6, 0, 3, 8, 'fieldstone', 'fieldstone');
  for (const [z, sign] of [[26, -1], [43, 1]] as const) {
    b.box(-22, -2, z, 22, 2, z + 9, 'planks');
    for (const y of [-2, 2]) b.face([[sign * 22, y, z], [sign * 30, y, z + 4.5], [sign * 22, y, z + 9]], [0, y, 0], 'planks');
    b.face([[sign * 22, -2, z], [sign * 30, -2, z + 4.5], [sign * 30, 2, z + 4.5], [sign * 22, 2, z]], [sign, 0, -1], 'planks');
    b.face([[sign * 30, -2, z + 4.5], [sign * 22, -2, z + 9], [sign * 22, 2, z + 9], [sign * 30, 2, z + 4.5]], [sign, 0, 1], 'planks');
  }
  return b.done('waypost');
}

function mushroom(v: SolidVariant): SolidMesh {
  const b = new Builder(.7 / v.size);
  b.drum(0, 0, 3.5, 0, 12, 8, 'plaster', 'plaster');
  const rim: V[] = Array.from({ length: 10 }, (_, i) => [Math.cos(i * Math.PI / 5) * 14, Math.sin(i * Math.PI / 5) * 14, 10]);
  for (let i = 0; i < 10; i++) {
    const a = rim[i]!, c = rim[(i + 1) % 10]!;
    b.face([a, c, [0, 0, 22]], [a[0], a[1], 1], 'mushroomCap');
    b.face([c, a, [0, 0, 10]], [0, 0, -1], 'plaster');
  }
  return b.done('mushroom');
}

/** A finished build: scaled to its size and, for a mirrored variant, flipped left for right. */
function finish(mesh: SolidMesh, v: SolidVariant, key: string): SolidMesh {
  const p = mesh.positions, n = mesh.normals, uv = mesh.uvs, m = mesh.materials;
  for (let i = 0; i < p.length; i += 3) { p[i]! *= v.size; p[i + 1]! *= v.size; p[i + 2]! *= v.size; if (v.mirror) { p[i]! *= -1; n[i]! *= -1; } }
  if (v.mirror) for (let t = 0; t < p.length / 9; t++) {
    // A mirror turns every triangle inside out: swap two corners so each still faces out.
    const swap = (a: Float32Array, size: number) => { for (let k = 0; k < size; k++) { const i = (t * 3 + 1) * size + k, j = (t * 3 + 2) * size + k, x = a[i]!; a[i] = a[j]!; a[j] = x; } };
    swap(p, 3); swap(n, 3); swap(uv, 2); swap(m, 1);
  }
  const min = [0, 1, 2].map((k) => Math.min(...Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + k]!))) as [number, number, number];
  const max = [0, 1, 2].map((k) => Math.max(...Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + k]!))) as [number, number, number];
  return { ...mesh, key, min, max, texel: mesh.texel * v.size };
}

const BUILT = new Map<string, SolidMesh>();
/** Sizes are kept to two decimals, so neighbouring footprints share a mesh rather than each building its own. */
export const solidKey = (kind: SolidKind, v: SolidVariant = PLAIN) => `${kind}:${v.size.toFixed(2)}:${v.mirror ? "m" : ""}${v.tone}${v.plants}`;
/** One mesh per family and variant, built on first use and shared by every instance of it. */
export function solidMesh(kind: SolidKind, variant: SolidVariant = PLAIN): SolidMesh {
  const v = { ...variant, size: Math.round(variant.size * 100) / 100 }, key = solidKey(kind, v);
  let mesh = BUILT.get(key);
  if (!mesh) {
    const builders: Partial<Record<SolidKind, () => SolidMesh>> = { cottage: () => cottage(v), redCottage: () => cottage(v, true), townhouse: () => townhouse(v), workshop: () => workshop(v),
      stall: () => stall(v), redStall: () => stall(v, true), hall: () => hall(v), board: () => board(v),
      tower: () => tower(v), shed: () => shed(v), tent: () => tent(v), bazaar: () => bazaar(v), waypost: () => waypost(v), mushroom: () => mushroom(v),
      hiringBoard: () => board(v, 'hiringBoard', 'hiringDisplay'), strategyBoard: () => board(v, 'strategyBoard', 'strategyDisplay'), scoreBoard: () => board(v, 'scoreBoard', 'scoreDisplay'),
      ...Object.fromEntries([...TREE_KINDS, 'shrub' as const].map(k => [k, () => tree(k, v)])) };
    const build = builders[kind];
    if (!build) throw new Error(`Unknown solid family: ${kind}`);
    mesh = finish(build(), v, key);
    BUILT.set(key, mesh);
  }
  return mesh;
}
