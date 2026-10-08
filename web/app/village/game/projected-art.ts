import { COLOSSEUM_FLOOR } from "../../../lib/world/arena-geometry";
import type { ArtFrame, ArtRef, TopGround, WorldModel, WorldObject } from "../../../lib/world/model";
import { cameraAngle, depthOrder, footprint, project, type Projection } from "../../../lib/world/projection";
import { TERRAIN, darker } from "./palette";
import { ARENA_PALETTE as A } from "./arena-art";
import { buildingMaterial, VILLAGE_MATERIAL as M, type ProjectedMaterials } from "./projected-materials";
import type { Pt } from "../../../lib/world/world";

export type ProjectionCamera = { x: number; y: number; scale: number };
type Vertex = Pt & { z?: number };
type Brush = {
  detail: boolean;
  ground: (points: Pt[], z: number, material?: CanvasPattern) => void;
  sprite: (o: WorldObject) => boolean;
  polygon: (points: Vertex[], colour: string, stroke?: string) => void;
  line: (points: Vertex[], colour: string, width?: number) => void;
};
const COLOUR = { grass: TERRAIN.grass.base, edge: TERRAIN.grass.light, earth: "#81552f", deep: "#3c2b20", water: TERRAIN.water.base, bank: TERRAIN.paved.hi,
  wall: M.plaster, shade: M.plasterShade, roof: M.goldRoof, gold: M.gold, glass: M.glass, wood: M.wood };

function brush(ctx: CanvasRenderingContext2D, view: Projection, scale: number, materials?: ProjectedMaterials): Brush {
  const path = (points: Vertex[]) => {
    ctx.beginPath();
    points.forEach((p, i) => { const s = project(view, p, p.z ?? 0); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  };
  return {
    detail: scale > 0.12,
    ground: (points, z, material) => {
      if (!material) return;
      // Texture coordinates remain on the shared ground plane as the camera rotates.
      const origin = project(view, { x: 0, y: 0 }, z), x = project(view, { x: 1, y: 0 }, z), y = project(view, { x: 0, y: 1 }, z);
      ctx.save(); ctx.transform(x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y, origin.x, origin.y);
      ctx.beginPath(); points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = material; ctx.fill(); ctx.restore();
    },
    sprite: (o) => {
      if (o.height <= 5) return false;
      const sprite = materials?.sprites.get(o.metadata?.texture ?? "");
      if (!sprite) return false;
      const frame = o.metadata?.frame ?? 0, columns = Math.max(1, Math.floor(sprite.image.width / sprite.width));
      const at = project(view, o.metadata?.topAnchor ?? o, o.elevation), tilt = cameraAngle(view).tilt;
      // Camera-facing sprite art is the same convention as Top's upright standees.
      const h = o.height / 0.85 * (0.55 + 0.45 * Math.cos(tilt));
      ctx.drawImage(sprite.image, frame % columns * sprite.width, Math.floor(frame / columns) * sprite.height, sprite.width, sprite.height,
        at.x - o.width / 2, at.y - h, o.width, h);
      return true;
    },
    polygon: (points, colour, stroke) => { if (!points.length) return; path(points); ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } },
    line: (points, colour, width = 2) => { path(points); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.stroke(); },
  };
}

/** What Top supplies to draw itself: its ground layer and its texture frames. */
export type TopArt = { ground?: TopGround | null; art?: (ref: ArtRef) => ArtFrame | null };

/** Draws in ground-plane coordinates: the world's own x/y, laid flat at z=0 for this view. */
function onGround(ctx: CanvasRenderingContext2D, view: Projection, draw: () => void): void {
  const o = project(view, { x: 0, y: 0 }, 0), x = project(view, { x: 1, y: 0 }, 0), y = project(view, { x: 0, y: 1 }, 0);
  ctx.save(); ctx.transform(x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y); draw(); ctx.restore();
}

/**
 * An object in Top's own picture: standing upright on its foot like Top's standees, or, for
 * flat art, lying on the ground exactly where Top lays it. False if the art is not loaded.
 */
function picture(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject, top?: TopArt): boolean {
  const ref = o.metadata?.art, f = ref && top?.art?.(ref);
  if (!ref || !f) return false;
  const foot = o.metadata?.topAnchor ?? { x: o.x, y: o.y };
  const draw = (x: number, y: number, w: number, h: number) => {
    ctx.save(); ctx.translate(x, y); if (ref.flipX) ctx.scale(-1, 1);
    ctx.drawImage(f.image as CanvasImageSource, f.x, f.y, f.width, f.height, -w / 2, -h, w, h);
    ctx.restore();
  };
  if (o.metadata?.flat) onGround(ctx, view, () => draw(foot.x, foot.y, o.width, o.depth));
  else { const at = project(view, foot, o.elevation); draw(at.x, at.y, o.width, o.height); }
  return true;
}

function prism(b: Brush, view: Projection, o: WorldObject, wall: string = COLOUR.wall, roof: string = COLOUR.roof): void {
  const corners = footprint(o), z = o.elevation, top = z + o.height;
  const edges = corners.map((a, i) => ({ a, c: corners[(i + 1) % corners.length]! }))
    .sort((a, c) => project(view, a.a).depth + project(view, a.c).depth - project(view, c.a).depth - project(view, c.c).depth);
  for (const { a, c } of edges) {
    b.polygon([{ ...a, z }, { ...c, z }, { ...c, z: top }, { ...a, z: top }], a.x === c.x ? darker(wall, 0.3) : wall, M.outline);
    if (b.detail && o.height > 35 && o.category === "structure" && o.type !== "bridge") {
      const length = Math.hypot(c.x - a.x, c.y - a.y), n = Math.max(1, Math.floor(length / 28));
      for (let row = 0; row < Math.min(4, Math.floor(o.height / 26)); row++) for (let i = 0; i < n; i++) {
        const u = (i + 0.24) / n, v = (i + 0.63) / n;
        const p = { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u };
        const q = { x: a.x + (c.x - a.x) * v, y: a.y + (c.y - a.y) * v };
        const h = z + 12 + row * 26;
        b.polygon([{ ...p, z: h }, { ...q, z: h }, { ...q, z: h + 12 }, { ...p, z: h + 12 }], COLOUR.glass, M.window);
      }
      b.line([{ ...a, z: top - 7 }, { ...c, z: top - 7 }], COLOUR.gold, 3);
    }
  }
  b.polygon(corners.map((p) => ({ ...p, z: top })), roof, darker(roof, 0.45));
  if (o.type === "bridge") {
    for (const side of [-1, 1]) b.line([{ x: o.x - o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }, { x: o.x + o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }], COLOUR.gold, 4);
    for (let d = -o.width / 2 + 9; d < o.width / 2; d += 12) b.line([{ x: o.x + d, y: o.y - o.depth / 2, z: top + 1 }, { x: o.x + d, y: o.y + o.depth / 2, z: top + 1 }], M.woodDark, 2);
  }
}

/** Gables, timber framing, warm plaster and tiled/thatch roofs use the reference village's materials. */
function cottage(b: Brush, view: Projection, o: WorldObject, material = buildingMaterial(o)): void {
  const z = o.elevation, top = z + o.height, eave = z + o.height * 0.68;
  const corners = footprint({ ...o, shape: undefined });
  prism(b, view, { ...o, shape: undefined, height: o.height * 0.68 }, material.wall, material.roof);
  const [nw, ne, se, sw] = corners as [Pt, Pt, Pt, Pt];
  const west = { x: nw.x, y: o.y, z: top }, east = { x: ne.x, y: o.y, z: top };
  const roofs = [
    { points: [{ ...nw, z: eave }, { ...ne, z: eave }, east, west], fill: material.roofLight },
    { points: [{ ...sw, z: eave }, { ...se, z: eave }, east, west], fill: material.roof },
    { points: [{ ...nw, z: eave }, { ...sw, z: eave }, west], fill: darker(material.wall, 0.2) },
    { points: [{ ...ne, z: eave }, { ...se, z: eave }, east], fill: material.wall },
  ].sort((a, c) => a.points.reduce((n, p) => n + project(view, p).depth, 0) / a.points.length - c.points.reduce((n, p) => n + project(view, p).depth, 0) / c.points.length);
  for (const face of roofs) b.polygon(face.points, face.fill, M.outline);
  b.line([west, east], material.roofLight, 4);
  for (const pair of [[nw, ne], [sw, se]] as const) {
    b.line(pair.map((p) => ({ ...p, z: eave })), M.timber, 4);
    if (b.detail) for (const t of [0.25, 0.5, 0.75]) {
      const y = pair[0].y + (o.y - pair[0].y) * t, h = eave + (top - eave) * t;
      b.line([{ x: nw.x, y, z: h }, { x: ne.x, y, z: h }], darker(material.roof, 0.2), 2);
      for (let x = nw.x + 8; x < ne.x; x += 18) b.line([{ x, y, z: h }, { x: x + 3, y: y + (o.y - y) * 0.15, z: h + (top - h) * 0.15 }], material.roofLight, 2);
    }
  }
  // Vertical posts and horizontal beams are attached to the same footprint, not camera-facing geometry.
  for (const p of corners) b.line([{ ...p, z }, { ...p, z: eave }], M.timber, 5);
  for (const level of [z + o.height * 0.12, z + o.height * 0.4]) for (let i = 0; i < 4; i++)
    b.line([{ ...corners[i]!, z: level }, { ...corners[(i + 1) % 4]!, z: level }], M.timber, 3);
  const doorWidth = Math.min(25, o.width * 0.18), doorHeight = Math.min(eave - z - 2, o.height * 0.35);
  b.polygon([{ x: o.x - doorWidth / 2, y: se.y, z }, { x: o.x + doorWidth / 2, y: se.y, z },
    { x: o.x + doorWidth / 2, y: se.y, z: z + doorHeight }, { x: o.x - doorWidth / 2, y: se.y, z: z + doorHeight }], M.woodDark, M.timber);
  b.line([{ x: o.x - doorWidth / 2, y: se.y, z: z + doorHeight }, { x: o.x + doorWidth / 2, y: se.y, z: z + doorHeight }], M.goldLight, 3);
  if (o.id.startsWith("site:")) {
    const banner = { x: o.x + o.width * 0.3, y: se.y, z: eave * 0.75 };
    b.polygon([{ ...banner, x: banner.x - 8 }, { ...banner, x: banner.x + 8 }, { ...banner, x: banner.x + 8, z: banner.z - 20 }, { ...banner, x: banner.x - 8, z: banner.z - 20 }], M.crestDark, M.gold);
    b.line([{ ...banner, x: banner.x - 3, z: banner.z - 7 }, { ...banner, x: banner.x + 3, z: banner.z - 7 }], M.crest, 4);
  }
}

/** AgenticPad's official logo (agenticpad-tb.png, unaltered) in the middle of the sand, inside a ring. */
function arenaFloor(ctx: CanvasRenderingContext2D, view: Projection, top?: TopArt): void {
  const { x, y, rx, ry } = COLOSSEUM_FLOOR;
  onGround(ctx, view, () => {
    ctx.save();
    // A worn, darker band round the wall's foot and raking rings across the sand.
    ctx.strokeStyle = A.sandShade; ctx.globalAlpha = 0.55; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.ellipse(x, y, rx - 8, ry - 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    for (const k of [0.78, 0.6]) { ctx.beginPath(); ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 0.6; ctx.strokeStyle = A.green; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 100, 80, 0, 0, Math.PI * 2); ctx.stroke();
    const f = top?.art?.({ key: "ac-arena-emblem", frame: "__BASE" });
    if (f) { ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false; ctx.drawImage(f.image as CanvasImageSource, f.x, f.y, f.width, f.height, x - 68, y - 68, 136, 136); }
    ctx.restore();
  });
}

function arena(b: Brush, view: Projection, o: WorldObject, floor?: () => void): void {
  const outer = footprint(o), inner = outer.map((p) => ({ x: COLOSSEUM_FLOOR.x + (p.x - o.x) * COLOSSEUM_FLOOR.rx / (o.width / 2), y: COLOSSEUM_FLOOR.y + (p.y - o.y) * COLOSSEUM_FLOOR.ry / (o.depth / 2) }));
  b.polygon(outer, A.stoneShade);
  b.polygon(inner, A.sand, A.sandEdge);
  floor?.();
  const segments = outer.map((a, i) => ({ a, c: outer[(i + 1) % outer.length]!, ia: inner[i]!, ic: inner[(i + 1) % inner.length]! }))
    .sort((a, c) => project(view, a.a).depth + project(view, a.c).depth - project(view, c.a).depth - project(view, c.c).depth);
  for (const { a, c, ia, ic } of segments) {
    // Light from the south-west, as the village's art is shaded: walls turned away fall into shadow.
    const nx = (c.y - a.y), ny = -(c.x - a.x), lit = (-nx * 0.6 + ny * 0.8) / Math.hypot(nx, ny);
    const wall = lit > 0.2 ? A.stoneLight : lit > -0.3 ? A.stone : A.stoneShade;
    b.polygon([a, c, { ...c, z: o.height }, { ...a, z: o.height }], wall, A.joint);
    // Coursed stone: joint lines every course, plinth and cornice in shadow.
    if (b.detail) for (const z of [10, 20, 30]) b.line([{ ...a, z }, { ...c, z }], darker(wall, 0.18), 1);
    b.line([{ ...a, z: 2 }, { ...c, z: 2 }], A.stoneShade, 4);
    const midpoint = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    // Arched openings in deep shadow with a stone keystone.
    b.line([{ ...midpoint, z: 6 }, { ...midpoint, z: o.height - 14 }], A.dark, 10);
    if (b.detail) b.line([{ ...midpoint, z: o.height - 15 }, { ...midpoint, z: o.height - 11 }], A.stoneLight, 8);
    // Timber seating: boards and risers alternating, the lowest row in AgenticPad green.
    b.polygon([{ ...a, z: o.height }, { ...c, z: o.height }, { ...ic, z: 8 }, { ...ia, z: 8 }], A.wood[1], A.woodDark);
    for (const [i, t] of [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].entries()) b.line([{ x: a.x + (ia.x - a.x) * t, y: a.y + (ia.y - a.y) * t, z: o.height * (1 - t) },
      { x: c.x + (ic.x - c.x) * t, y: c.y + (ic.y - c.y) * t, z: o.height * (1 - t) }], i === 4 ? A.green : i % 2 ? A.wood[3] : A.woodDark, i === 4 ? 4 : 3);
    // Trim: a green band under a thin brass rail.
    b.line([{ ...a, z: o.height - 6 }, { ...c, z: o.height - 6 }], A.emerald, 4);
    b.line([{ ...a, z: o.height - 2 }, { ...c, z: o.height - 2 }], A.goldLight, 2);
    b.line([{ ...a, z: o.height + 1 }, { ...c, z: o.height + 1 }], A.stoneShade, 3);
    if (midpoint.y < o.y - o.depth * 0.08) {
      const point = (outer: Pt, inner: Pt, t: number, z: number) => ({ x: inner.x + (outer.x - inner.x) * t, y: inner.y + (outer.y - inner.y) * t, z });
      const ridgeA = point(a, ia, 0.82, o.height), ridgeC = point(c, ic, 0.82, o.height);
      b.polygon([point(a, ia, 0.55, o.height * 0.65), point(c, ic, 0.55, o.height * 0.65), ridgeC, ridgeA], A.roofLight, A.roofShade);
      b.polygon([ridgeA, ridgeC, point(c, ic, 1, o.height * 0.75), point(a, ia, 1, o.height * 0.75)], A.roof, A.roofShade);
      b.line([ridgeA, ridgeC], A.gold, 2);
      if (b.detail) for (const t of [0.64, 0.73, 0.91]) b.line([point(a, ia, t, o.height * (t < 0.82 ? 0.65 + (t - 0.55) / 0.27 * 0.35 : 1 - (t - 0.82) / 0.18 * 0.25)),
        point(c, ic, t, o.height * (t < 0.82 ? 0.65 + (t - 0.55) / 0.27 * 0.35 : 1 - (t - 0.82) / 0.18 * 0.25))], A.roofTile, 2);
    }
  }
  for (const dx of [-1, 1]) {
    const tower = { ...o, x: o.x + dx * o.width * 0.35, y: o.y + o.depth * 0.34, width: 45, depth: 42, height: o.height + 24, shape: undefined };
    cottage(b, view, tower, { wall: A.stoneLight, roof: A.roof, roofLight: A.roofLight });
    b.line([{ x: tower.x, y: tower.y, z: tower.height }, { x: tower.x, y: tower.y, z: tower.height + 26 }], A.gold, 3);
    b.polygon([{ x: tower.x, y: tower.y, z: tower.height + 26 }, { x: tower.x + 20, y: tower.y, z: tower.height + 22 }, { x: tower.x, y: tower.y, z: tower.height + 13 }], A.green);
  }
}

function tree(b: Brush, view: Projection, o: WorldObject): void {
  if (b.sprite(o)) return;
  const z = o.elevation, h = o.height;
  b.line([{ x: o.x, y: o.y, z }, { x: o.x, y: o.y, z: z + h * 0.65 }], M.wood, Math.max(5, o.width * 0.12));
  // Rounded deciduous foliage is also the fallback while the reference sheet loads.
  for (const [radius, level, colour] of [[0.5, 0.5, TERRAIN.tree.deep], [0.43, 0.7, TERRAIN.tree.mid], [0.3, 0.88, TERRAIN.tree.light]] as const) {
    b.polygon(Array.from({ length: 12 }, (_, i) => ({ x: o.x + Math.cos(i * Math.PI / 6) * o.width * radius,
      y: o.y + Math.sin(i * Math.PI / 6) * o.width * radius, z: z + h * level })), colour, TERRAIN.tree.low);
  }
}

function prop(b: Brush, view: Projection, o: WorldObject): void {
  if (b.sprite(o)) return;
  const key = o.metadata?.texture ?? "", top = o.elevation + o.height;
  if (key === "fence") {
    // Top's garden rail (gardens.ts): two timber rails on posts every 30 units, as tall as it draws them.
    const x0 = o.x - o.width / 2, x1 = o.x + o.width / 2;
    for (const z of [17, 8]) b.line([{ x: x0, y: o.y, z }, { x: x1, y: o.y, z }], M.wood, 4);
    for (let x = x0; x <= x1 + 0.5; x += 30) b.line([{ x, y: o.y, z: 0 }, { x, y: o.y, z: 24 }], M.woodDark, 5);
    return;
  }
  if (key === "torch") {
    // Top's arena gate torch (arena.ts): a dark post, a gold collar and an orange flame.
    b.line([{ x: o.x, y: o.y, z: 0 }, { x: o.x, y: o.y, z: 30 }], "#153c32", 8);
    b.line([{ x: o.x, y: o.y, z: 30 }, { x: o.x, y: o.y, z: 33 }], "#d6a340", 12);
    b.line([{ x: o.x, y: o.y, z: 33 }, { x: o.x, y: o.y, z: 45 }], "#e47b27", 8);
    b.line([{ x: o.x, y: o.y, z: 36 }, { x: o.x, y: o.y, z: 44 }], "#ffc95e", 4);
    return;
  }
  if (/flag|banner|lamp|lantern/.test(key)) {
    b.line([{ x: o.x, y: o.y, z: 0 }, { x: o.x, y: o.y, z: top }], M.woodDark, Math.max(3, o.width * 0.12));
    if (/lamp|lantern/.test(key)) prism(b, view, { ...o, width: 12, depth: 10, height: 9, elevation: top - 11 }, "#e5c67c", "#3e605c");
    else {
      const w = o.width * 0.65;
      b.polygon([{ x: o.x, y: o.y, z: top }, { x: o.x + w, y: o.y, z: top - 3 }, { x: o.x + w, y: o.y, z: top * 0.65 }, { x: o.x, y: o.y, z: top * 0.6 }], M.crest, COLOUR.gold);
    }
  } else if (/bush|planter/.test(key)) {
    prism(b, view, { ...o, shape: "ellipse", height: o.height * 0.7 }, TERRAIN.tree.low, TERRAIN.tree.light);
  } else if (/fountain/.test(key)) {
    prism(b, view, { ...o, shape: "ellipse", height: o.height * 0.25 }, M.stone, COLOUR.water);
    prism(b, view, { ...o, width: o.width * 0.14, depth: o.depth * 0.25 }, M.stoneLight, "#8ccce1");
  } else if (/farm-bed|plot|yard/.test(key)) prism(b, view, o, M.woodDark, TERRAIN.grass.shade);
  else prism(b, view, o, /bench|fence|chest|tent|barrel/.test(key) ? COLOUR.wood : M.stone, /bench|fence|chest|tent|barrel/.test(key) ? M.woodLight : M.stoneShade);
}

function road(b: Brush, o: WorldObject): void {
  const points = o.points ?? [], half = (o.lineWidth ?? 30) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, c = points[i]!, len = Math.hypot(c.x - a.x, c.y - a.y);
    if (!len) continue;
    const nx = -(c.y - a.y) / len * half, ny = (c.x - a.x) / len * half;
    b.polygon([{ x: a.x + nx, y: a.y + ny }, { x: c.x + nx, y: c.y + ny }, { x: c.x - nx, y: c.y - ny }, { x: a.x - nx, y: a.y - ny }], TERRAIN.paved.base, TERRAIN.paved.edge);
    b.line([{ x: a.x + nx * 0.83, y: a.y + ny * 0.83 }, { x: c.x + nx * 0.83, y: c.y + ny * 0.83 }], TERRAIN.paved.hi, 2);
    if (b.detail) for (let d = 9; d < len; d += 18) {
      const t = d / len, px = a.x + (c.x - a.x) * t, py = a.y + (c.y - a.y) * t;
      for (const lane of [-0.55, 0, 0.55]) {
        const stagger = lane === 0 ? 4 : 0;
        b.line([{ x: px + nx * lane, y: py + ny * lane }, { x: px + nx * (lane + 0.3), y: py + ny * (lane + 0.3) }], TERRAIN.paved.mid, 2);
        if (stagger) b.line([{ x: px - (c.x - a.x) / len * stagger, y: py - (c.y - a.y) / len * stagger }, { x: px + (c.x - a.x) / len * stagger, y: py + (c.y - a.y) / len * stagger }], TERRAIN.paved.hi, 2);
      }
    }
  }
}

export function renderProjectedWorld(ctx: CanvasRenderingContext2D, world: WorldModel, view: Projection, camera: ProjectionCamera, width: number, height: number, materials?: ProjectedMaterials, top?: TopArt): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2); ctx.scale(camera.scale, camera.scale); ctx.translate(-camera.x, -camera.y);
  const b = brush(ctx, view, camera.scale, materials), bounds = world.bounds;
  const corners = [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }, { x: bounds.x0, y: bounds.y1 }];
  const slab = { id: "terrain", type: "prop", category: "prop", orientation: "south", x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2,
    width: bounds.x1 - bounds.x0, depth: bounds.y1 - bounds.y0, elevation: -world.slabDepth, height: world.slabDepth } as WorldObject;
  prism(b, view, slab, COLOUR.earth, COLOUR.grass);
  // Top's own ground layer when it has been captured: the same terrain, roads, water and beds.
  const ground = top?.ground;
  if (ground) onGround(ctx, view, () => ctx.drawImage(ground.image as CanvasImageSource, ground.x0, ground.y0, ground.width, ground.height));
  else b.ground(corners, 0, materials?.grass);
  // Strata follow the actual terrain block edges in every projection.
  for (const z of [-35, -80, -115]) for (let i = 0; i < 4; i++) b.line([{ ...corners[i]!, z }, { ...corners[(i + 1) % 4]!, z }], z === -115 ? COLOUR.deep : "#c09958", 3);
  const ordered = depthOrder(view, world.objects.filter((o) => o.category !== "movement"));
  const waterCells = new Set(world.objects.filter((o) => o.type === "water").map((o) => `${o.x},${o.y}`));
  for (const o of ordered.filter((o) => o.category === "surface")) {
    if (ground) continue;
    if (o.type === "road") { road(b, o); continue; }
    const wet = o.type === "water" || o.type === "pond";
    {
      const rim = footprint(o);
      if (wet) for (let i = 0; i < rim.length; i++) {
        const neighbour = [{ x: 0, y: -64 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: -64, y: 0 }][i];
        if (o.type === "water" && neighbour && waterCells.has(`${o.x + neighbour.x},${o.y + neighbour.y}`)) continue;
        b.polygon([rim[i]!, rim[(i + 1) % rim.length]!, { ...rim[(i + 1) % rim.length]!, z: o.elevation }, { ...rim[i]!, z: o.elevation }], TERRAIN.water.edge);
      }
      b.polygon(rim.map((p) => ({ ...p, z: o.elevation })), wet ? COLOUR.water : TERRAIN.paved.base, o.type === "pond" ? COLOUR.bank : undefined);
      if (wet) b.ground(rim, o.elevation, materials?.water);
      if (o.type === "pond") for (let i = 0; i < rim.length; i += 2) {
        const p = rim[i]!, q = rim[(i + 1) % rim.length]!;
        b.line([{ ...p, z: 1 }, { ...q, z: 1 }], i % 4 ? M.stone : M.stoneLight, 9);
      }
      if (o.type === "water") for (const [i, delta] of [{ x: 0, y: -64 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: -64, y: 0 }].entries()) {
        if (waterCells.has(`${o.x + delta.x},${o.y + delta.y}`)) continue;
        b.line([{ ...rim[i]!, z: 0 }, { ...rim[(i + 1) % rim.length]!, z: 0 }], TERRAIN.grass.shade, 5);
        b.line([{ ...rim[i]!, z: o.elevation }, { ...rim[(i + 1) % rim.length]!, z: o.elevation }], TERRAIN.water.edge, 3);
      }
      if (wet && (Math.round(o.x / 64) + Math.round(o.y / 64)) % 3 === 0) b.line([{ x: o.x - o.width * 0.2, y: o.y, z: o.elevation + 0.2 }, { x: o.x + o.width * 0.2, y: o.y, z: o.elevation + 0.2 }], "#8fc9df", 2);
    }
  }
  // Flat art lies on the ground, under everything standing.
  for (const o of ordered) if (o.metadata?.flat) picture(ctx, view, o, top);
  const standing = ordered.filter((o) => o.category !== "surface" && !o.metadata?.flat);
  for (const o of standing) {
    // Top's ground layer already carries its own shadows.
    if (ground || o.height < 12) continue;
    const at = project(view, o);
    if (Math.abs(at.x - camera.x) > width / camera.scale / 2 + o.width || Math.abs(at.y - camera.y) > height / camera.scale / 2 + o.depth) continue;
    const radius = o.type === "tree" ? o.width * 0.34 : o.width * 0.52;
    b.polygon(Array.from({ length: 8 }, (_, i) => ({ x: o.x + Math.cos(i * Math.PI / 4) * radius,
      y: o.y + Math.sin(i * Math.PI / 4) * (o.type === "tree" ? radius * 0.6 : o.depth * 0.5), z: 0.1 })), "#163e2438");
  }
  for (const o of standing) {
    const centre = project(view, o, o.height / 2), reach = o.width + o.depth + o.height;
    if (Math.abs(centre.x - camera.x) > width / camera.scale / 2 + reach || Math.abs(centre.y - camera.y) > height / camera.scale / 2 + reach) continue;
    if (o.type !== "arena" && picture(ctx, view, o, top)) continue;
    if (o.type === "tree") tree(b, view, o);
    else if (o.type === "arena") arena(b, view, o, () => arenaFloor(ctx, view, top));
    else if (o.type === "mountain") {
      const ring = footprint({ ...o, shape: "ellipse" });
      for (let i = 0; i < ring.length; i++) b.polygon([ring[i]!, ring[(i + 1) % ring.length]!, { x: o.x, y: o.y, z: o.height }], i % 3 === 0 ? "#b6b7a6" : i % 3 === 1 ? "#7b8977" : "#98a18c", "#7c8876");
      b.line([{ x: o.x - 18, y: o.y, z: o.height - 25 }, { x: o.x, y: o.y, z: o.height }, { x: o.x + 18, y: o.y, z: o.height - 25 }], "#e9e8cd", 10);
    } else if (o.type === "prop" || o.type === "stall") prop(b, view, o);
    else if (o.type === "building") { if (!b.sprite(o)) cottage(b, view, o); }
    else prism(b, view, o, COLOUR.wall, o.type === "bridge" ? M.woodLight : COLOUR.roof);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Explicit view entry points share geometry/art; only their orthographic basis differs. */
export const renderIsometricView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "isometric", camera, w, h);
export const renderFrontView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "front", camera, w, h);
export const renderBackView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "back", camera, w, h);
export const renderLeftView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "left", camera, w, h);
export const renderRightView = (ctx: CanvasRenderingContext2D, world: WorldModel, camera: ProjectionCamera, w: number, h: number) => renderProjectedWorld(ctx, world, "right", camera, w, h);
