import type { WorldObject } from "./model";
import type { Box, Pt } from "./world";

export const FIELD_VIEWS = ["top", "isometric", "front", "back", "left", "right"] as const;
export type FieldView = typeof FIELD_VIEWS[number];
export const VIEW_LABELS: Record<FieldView, string> = { top: "Top", isometric: "Isometric", front: "Front", back: "Back", left: "Left", right: "Right" };
export type Projected = Pt & { depth: number };

/** Orthographic basis vectors, all in world units. South/east are the near isometric edges. */
export function project(view: FieldView, p: Pt, z = 0): Projected {
  switch (view) {
    case "top": return { x: p.x, y: p.y, depth: p.y };
    case "isometric": return { x: (p.x - p.y) * Math.SQRT1_2, y: (p.x + p.y) / Math.sqrt(6) - z * Math.sqrt(2 / 3), depth: p.x + p.y };
    case "front": return { x: p.x, y: -z, depth: p.y };
    case "back": return { x: -p.x, y: -z, depth: -p.y };
    case "left": return { x: -p.y, y: -z, depth: -p.x };
    case "right": return { x: p.y, y: -z, depth: p.x };
  }
}

/** Ground inverse exists for Top/Isometric; elevations discard the viewing axis by design. */
export function unprojectGround(view: "top" | "isometric", p: Pt): Pt {
  if (view === "top") return { ...p };
  return { x: p.x * Math.SQRT1_2 + p.y * Math.sqrt(1.5), y: -p.x * Math.SQRT1_2 + p.y * Math.sqrt(1.5) };
}

export function footprint(o: WorldObject): Pt[] {
  if (o.shape === "ellipse") return Array.from({ length: 40 }, (_, i) => ({ x: o.x + Math.cos(i * Math.PI / 20) * o.width / 2, y: o.y + Math.sin(i * Math.PI / 20) * o.depth / 2 }));
  return [{ x: o.x - o.width / 2, y: o.y - o.depth / 2 }, { x: o.x + o.width / 2, y: o.y - o.depth / 2 },
    { x: o.x + o.width / 2, y: o.y + o.depth / 2 }, { x: o.x - o.width / 2, y: o.y + o.depth / 2 }];
}

export function projectedBounds(view: FieldView, b: Box, minZ = -120, maxZ = 300): Box {
  const points = [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].flatMap((y) => [minZ, maxZ].map((z) => project(view, { x, y }, z))));
  return { x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)), x1: Math.max(...points.map((p) => p.x)), y1: Math.max(...points.map((p) => p.y)) };
}

/** Painter order uses the camera's viewing axis, never screen height (which includes z). */
export function depthOrder(view: FieldView, objects: readonly WorldObject[]): WorldObject[] {
  return [...objects].sort((a, b) => project(view, a).depth - project(view, b).depth || a.id.localeCompare(b.id));
}
