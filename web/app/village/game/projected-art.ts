import { COLOSSEUM_FLOOR } from "../../../lib/world/arena-geometry";
import type { WorldModel, WorldObject } from "../../../lib/world/model";
import { depthOrder, footprint, project, type FieldView } from "../../../lib/world/projection";
import type { Pt } from "../../../lib/world/world";

export type ProjectionCamera = { x: number; y: number; scale: number };
type Vertex = Pt & { z?: number };
type Brush = {
  polygon: (points: Vertex[], colour: string, stroke?: string) => void;
  line: (points: Vertex[], colour: string, width?: number) => void;
};
const COLOUR = { grass: "#739052", edge: "#b3c58a", earth: "#76664f", deep: "#443c34", water: "#408f9c", bank: "#99b9a4",
  wall: "#d0c6a2", shade: "#8d987e", roof: "#386e64", gold: "#e5c67c", glass: "#72c1c1", wood: "#936f4b" };

function brush(ctx: CanvasRenderingContext2D, view: FieldView): Brush {
  const path = (points: Vertex[]) => {
    ctx.beginPath();
    points.forEach((p, i) => { const s = project(view, p, p.z ?? 0); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  };
  return {
    polygon: (points, colour, stroke) => { if (!points.length) return; path(points); ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } },
    line: (points, colour, width = 2) => { path(points); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.stroke(); },
  };
}

function prism(b: Brush, view: FieldView, o: WorldObject, wall = COLOUR.wall, roof = COLOUR.roof): void {
  const corners = footprint(o), z = o.elevation, top = z + o.height;
  const edges = corners.map((a, i) => ({ a, c: corners[(i + 1) % corners.length]! }))
    .sort((a, c) => project(view, a.a).depth + project(view, a.c).depth - project(view, c.a).depth - project(view, c.c).depth);
  for (const { a, c } of edges) {
    b.polygon([{ ...a, z }, { ...c, z }, { ...c, z: top }, { ...a, z: top }], a.x === c.x ? COLOUR.shade : wall, "#667260");
    if (o.height > 35 && o.category === "structure" && o.type !== "bridge") {
      const length = Math.hypot(c.x - a.x, c.y - a.y), n = Math.max(1, Math.floor(length / 28));
      for (let row = 0; row < Math.min(4, Math.floor(o.height / 26)); row++) for (let i = 0; i < n; i++) {
        const u = (i + 0.24) / n, v = (i + 0.63) / n;
        const p = { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u };
        const q = { x: a.x + (c.x - a.x) * v, y: a.y + (c.y - a.y) * v };
        const h = z + 12 + row * 26;
        b.polygon([{ ...p, z: h }, { ...q, z: h }, { ...q, z: h + 12 }, { ...p, z: h + 12 }], COLOUR.glass, "#3b6868");
      }
      b.line([{ ...a, z: top - 7 }, { ...c, z: top - 7 }], COLOUR.gold, 3);
    }
  }
  b.polygon(corners.map((p) => ({ ...p, z: top })), roof, "#b1c6a0");
  if (o.type === "bridge") {
    for (const side of [-1, 1]) b.line([{ x: o.x - o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }, { x: o.x + o.width / 2, y: o.y + side * o.depth / 2, z: top + 10 }], COLOUR.gold, 4);
    for (let d = -o.width / 2 + 9; d < o.width / 2; d += 12) b.line([{ x: o.x + d, y: o.y - o.depth / 2, z: top + 1 }, { x: o.x + d, y: o.y + o.depth / 2, z: top + 1 }], "#706b58", 2);
  }
}

function arena(b: Brush, view: FieldView, o: WorldObject): void {
  const outer = footprint(o), inner = outer.map((p) => ({ x: COLOSSEUM_FLOOR.x + (p.x - o.x) * COLOSSEUM_FLOOR.rx / (o.width / 2), y: COLOSSEUM_FLOOR.y + (p.y - o.y) * COLOSSEUM_FLOOR.ry / (o.depth / 2) }));
  b.polygon(outer, "#b0a67f");
  b.polygon(inner, "#d7b876", "#f5d995");
  const segments = outer.map((a, i) => ({ a, c: outer[(i + 1) % outer.length]!, ia: inner[i]!, ic: inner[(i + 1) % inner.length]! }))
    .sort((a, c) => project(view, a.a).depth + project(view, a.c).depth - project(view, c.a).depth - project(view, c.c).depth);
  for (const { a, c, ia, ic } of segments) {
    b.polygon([a, c, { ...c, z: o.height }, { ...a, z: o.height }], "#c6bb97", "#7b826a");
    const midpoint = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    b.line([{ ...midpoint, z: 8 }, { ...midpoint, z: o.height - 12 }], "#566e5e", 11);
    b.polygon([{ ...a, z: o.height }, { ...c, z: o.height }, { ...ic, z: 8 }, { ...ia, z: 8 }], "#3d7969", "#7ea68b");
    for (const t of [0.25, 0.5, 0.75]) b.line([{ x: a.x + (ia.x - a.x) * t, y: a.y + (ia.y - a.y) * t, z: o.height * (1 - t) },
      { x: c.x + (ic.x - c.x) * t, y: c.y + (ic.y - c.y) * t, z: o.height * (1 - t) }], "#a9b86d", 2);
    b.line([{ ...a, z: o.height + 2 }, { ...c, z: o.height + 2 }], COLOUR.gold, 5);
  }
  for (const dx of [-1, 1]) {
    const tower = { ...o, x: o.x + dx * o.width * 0.35, y: o.y + o.depth * 0.34, width: 45, depth: 42, height: o.height + 24, shape: undefined };
    prism(b, view, tower);
    b.line([{ x: tower.x, y: tower.y, z: tower.height }, { x: tower.x, y: tower.y, z: tower.height + 26 }], COLOUR.gold, 3);
    b.polygon([{ x: tower.x, y: tower.y, z: tower.height + 26 }, { x: tower.x + 20, y: tower.y, z: tower.height + 22 }, { x: tower.x, y: tower.y, z: tower.height + 13 }], "#2c8e76");
  }
}

function tree(b: Brush, view: FieldView, o: WorldObject): void {
  const z = o.elevation, h = o.height;
  b.line([{ x: o.x, y: o.y, z }, { x: o.x, y: o.y, z: z + h * 0.58 }], "#806545", Math.max(5, o.width * 0.12));
  // Two intersecting canopy planes give every camera the same tree height and spread.
  for (const axis of ["x", "y"] as const) for (const tier of [0, 1, 2]) {
    const w = o.width * (0.5 - tier * 0.095), bottom = h * (0.3 + tier * 0.15), top = h * (0.75 + tier * 0.125);
    b.polygon([{ x: o.x, y: o.y, z: z + top }, { x: o.x - (axis === "x" ? w : 0), y: o.y - (axis === "y" ? w : 0), z: z + bottom },
      { x: o.x + (axis === "x" ? w : 0), y: o.y + (axis === "y" ? w : 0), z: z + bottom }], axis === "x" ? ["#3c6b48", "#4b7d50", "#6c945d"][tier]! : "#548653");
  }
}

function prop(b: Brush, view: FieldView, o: WorldObject): void {
  const key = o.metadata?.texture ?? "", top = o.elevation + o.height;
  if (/flag|banner|lamp|lantern/.test(key)) {
    b.line([{ x: o.x, y: o.y, z: 0 }, { x: o.x, y: o.y, z: top }], "#807153", Math.max(3, o.width * 0.12));
    if (/lamp|lantern/.test(key)) prism(b, view, { ...o, width: 12, depth: 10, height: 9, elevation: top - 11 }, "#e5c67c", "#3e605c");
    else {
      const w = o.width * 0.65;
      b.polygon([{ x: o.x, y: o.y, z: top }, { x: o.x + w, y: o.y, z: top - 3 }, { x: o.x + w, y: o.y, z: top * 0.65 }, { x: o.x, y: o.y, z: top * 0.6 }], "#349478", COLOUR.gold);
    }
  } else if (/bush|planter/.test(key)) {
    prism(b, view, { ...o, shape: "ellipse", height: o.height * 0.7 }, "#4c7a4e", "#82a25e");
  } else if (/fountain/.test(key)) {
    prism(b, view, { ...o, shape: "ellipse", height: o.height * 0.25 }, "#b7bea6", COLOUR.water);
    prism(b, view, { ...o, width: o.width * 0.14, depth: o.depth * 0.25 }, "#bcc8ba", "#a6ded3");
  } else if (/farm-bed|plot|yard/.test(key)) prism(b, view, o, "#7c6b49", "#87964e");
  else prism(b, view, o, /bench|fence|chest|tent|barrel/.test(key) ? COLOUR.wood : "#aaa995", /bench|fence|chest|tent|barrel/.test(key) ? "#bc9867" : "#8b9a7d");
}

function road(b: Brush, o: WorldObject): void {
  const points = o.points ?? [], half = (o.lineWidth ?? 30) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, c = points[i]!, len = Math.hypot(c.x - a.x, c.y - a.y);
    if (!len) continue;
    const nx = -(c.y - a.y) / len * half, ny = (c.x - a.x) / len * half;
    b.polygon([{ x: a.x + nx, y: a.y + ny }, { x: c.x + nx, y: c.y + ny }, { x: c.x - nx, y: c.y - ny }, { x: a.x - nx, y: a.y - ny }], "#a5a597", "#858b7d");
  }
}

export function renderProjectedWorld(ctx: CanvasRenderingContext2D, world: WorldModel, view: FieldView, camera: ProjectionCamera, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2); ctx.scale(camera.scale, camera.scale); ctx.translate(-camera.x, -camera.y);
  const b = brush(ctx, view), bounds = world.bounds;
  const corners = [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }, { x: bounds.x0, y: bounds.y1 }];
  const slab = { id: "terrain", type: "prop", category: "prop", orientation: "south", x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2,
    width: bounds.x1 - bounds.x0, depth: bounds.y1 - bounds.y0, elevation: -world.slabDepth, height: world.slabDepth } as WorldObject;
  prism(b, view, slab, COLOUR.earth, COLOUR.grass);
  // Strata follow the actual terrain block edges in every projection.
  for (const z of [-35, -80, -115]) for (let i = 0; i < 4; i++) b.line([{ ...corners[i]!, z }, { ...corners[(i + 1) % 4]!, z }], z === -115 ? COLOUR.deep : "#998366", 3);
  const side = view !== "isometric" && view !== "top";
  const ordered = depthOrder(view, world.objects.filter((o) => o.category !== "movement"));
  const waterCells = new Set(world.objects.filter((o) => o.type === "water").map((o) => `${o.x},${o.y}`));
  for (const o of ordered.filter((o) => o.category === "surface")) {
    if (o.type === "road") { road(b, o); continue; }
    const wet = o.type === "water" || o.type === "pond";
    if (side) {
      const pts = footprint(o).map((p) => project(view, p));
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      ctx.fillStyle = wet ? COLOUR.water : "#aba997"; ctx.fillRect(x0, wet ? 0 : -2, x1 - x0, wet ? 9 : 2);
    } else {
      const rim = footprint(o);
      if (wet) for (let i = 0; i < rim.length; i++) {
        const neighbour = [{ x: 0, y: -64 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: -64, y: 0 }][i];
        if (o.type === "water" && neighbour && waterCells.has(`${o.x + neighbour.x},${o.y + neighbour.y}`)) continue;
        b.polygon([rim[i]!, rim[(i + 1) % rim.length]!, { ...rim[(i + 1) % rim.length]!, z: o.elevation }, { ...rim[i]!, z: o.elevation }], "#5f8172");
      }
      b.polygon(rim.map((p) => ({ ...p, z: o.elevation })), wet ? COLOUR.water : "#aaa994", o.type === "pond" ? COLOUR.bank : undefined);
      if (wet && (Math.round(o.x / 64) + Math.round(o.y / 64)) % 3 === 0) b.line([{ x: o.x - o.width * 0.2, y: o.y, z: o.elevation + 0.2 }, { x: o.x + o.width * 0.2, y: o.y, z: o.elevation + 0.2 }], "#80bfbe", 1);
    }
  }
  const standing = ordered.filter((o) => o.category !== "surface");
  const visible = side ? [...standing.filter((o) => o.category === "vegetation"), ...standing.filter((o) => o.category !== "vegetation")] : standing;
  for (const o of visible) {
    const centre = project(view, o, o.height / 2), reach = o.width + o.depth + o.height;
    if (Math.abs(centre.x - camera.x) > width / camera.scale / 2 + reach || Math.abs(centre.y - camera.y) > height / camera.scale / 2 + reach) continue;
    // Schematic elevations show structures through the surrounding woodland.
    ctx.globalAlpha = side && o.type === "tree" ? 0.26 : 1;
    if (o.type === "tree") tree(b, view, o);
    else if (o.type === "arena") arena(b, view, o);
    else if (o.type === "mountain") {
      const ring = footprint({ ...o, shape: "ellipse" });
      for (let i = 0; i < ring.length; i++) b.polygon([ring[i]!, ring[(i + 1) % ring.length]!, { x: o.x, y: o.y, z: o.height }], i % 3 === 0 ? "#b6b7a6" : i % 3 === 1 ? "#7b8977" : "#98a18c", "#7c8876");
      b.line([{ x: o.x - 18, y: o.y, z: o.height - 25 }, { x: o.x, y: o.y, z: o.height }, { x: o.x + 18, y: o.y, z: o.height - 25 }], "#e9e8cd", 10);
    } else if (o.type === "prop") prop(b, view, o);
    else prism(b, view, o, o.type === "stall" ? "#bda878" : COLOUR.wall, o.type === "bridge" ? "#b6aa83" : o.type === "stall" ? "#b17261" : COLOUR.roof);
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
