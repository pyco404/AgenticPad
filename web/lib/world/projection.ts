import type { WorldObject } from "./model";
import type { Box, Pt } from "./world";

export const FIELD_VIEWS = ["top", "isometric", "front", "back", "left", "right"] as const;
export type FieldView = typeof FIELD_VIEWS[number];
export const VIEW_LABELS: Record<FieldView, string> = { top: "Top", isometric: "Isometric", front: "Front", back: "Back", left: "Left", right: "Right" };
export type Projected = Pt & { depth: number };
export const DIRECTIONAL_TILT = 28 * Math.PI / 180;
export type CameraAngle = { yaw: number; tilt: number };
export type Projection = FieldView | CameraAngle;
export const CAMERA_ANGLES: Record<FieldView, CameraAngle> = {
  top: { yaw: 0, tilt: Math.PI / 2 }, isometric: { yaw: Math.PI / 4, tilt: Math.asin(1 / Math.sqrt(3)) },
  front: { yaw: 0, tilt: DIRECTIONAL_TILT }, back: { yaw: Math.PI, tilt: DIRECTIONAL_TILT },
  left: { yaw: -Math.PI / 2, tilt: DIRECTIONAL_TILT }, right: { yaw: Math.PI / 2, tilt: DIRECTIONAL_TILT },
};
export const cameraAngle = (view: Projection): CameraAngle => typeof view === "string" ? CAMERA_ANGLES[view] : view;
export const yawDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const dragCamera = (angle: CameraAngle, dx: number, dy: number): CameraAngle => ({
  yaw: angle.yaw - dx * 0.006, tilt: Math.max(15 * Math.PI / 180, Math.min(Math.PI / 2, angle.tilt - dy * 0.005)),
});
export const easeCamera = (angle: CameraAngle, target: CameraAngle, seconds: number): CameraAngle => {
  const alpha = 1 - Math.exp(-Math.max(0, seconds) * 14);
  return { yaw: angle.yaw + yawDelta(angle.yaw, target.yaw) * alpha, tilt: angle.tilt + (target.tilt - angle.tilt) * alpha };
};
const SIN_TILT = Math.sin(DIRECTIONAL_TILT), COS_TILT = Math.cos(DIRECTIONAL_TILT);
export const isDirectional = (view: FieldView): view is "front" | "back" | "left" | "right" => view !== "top" && view !== "isometric";

/** Orthographic basis vectors, all in world units. South/east are the near isometric edges. */
export function project(view: Projection, p: Pt, z = 0): Projected {
  if (typeof view !== "string") {
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw), along = p.x * s + p.y * c;
    return { x: p.x * c - p.y * s, y: along * Math.sin(view.tilt) - z * Math.cos(view.tilt), depth: along };
  }
  switch (view) {
    case "top": return { x: p.x, y: p.y, depth: p.y };
    case "isometric": return { x: (p.x - p.y) * Math.SQRT1_2, y: (p.x + p.y) / Math.sqrt(6) - z * Math.sqrt(2 / 3), depth: p.x + p.y };
    case "front": return { x: p.x, y: p.y * SIN_TILT - z * COS_TILT, depth: p.y };
    case "back": return { x: -p.x, y: -p.y * SIN_TILT - z * COS_TILT, depth: -p.y };
    case "left": return { x: p.y, y: -p.x * SIN_TILT - z * COS_TILT, depth: -p.x };
    case "right": return { x: -p.y, y: p.x * SIN_TILT - z * COS_TILT, depth: p.x };
  }
}

/** Every tilted camera retains both ground axes; inverse never changes world coordinates. */
export function unprojectGround(view: Projection, p: Pt): Pt {
  if (typeof view !== "string") {
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw), along = p.y / Math.sin(view.tilt);
    return { x: p.x * c + along * s, y: -p.x * s + along * c };
  }
  if (view === "top") return { ...p };
  if (view === "isometric") return { x: p.x * Math.SQRT1_2 + p.y * Math.sqrt(1.5), y: -p.x * Math.SQRT1_2 + p.y * Math.sqrt(1.5) };
  if (view === "front") return { x: p.x, y: p.y / SIN_TILT };
  if (view === "back") return { x: -p.x, y: -p.y / SIN_TILT };
  if (view === "left") return { x: -p.y / SIN_TILT, y: p.x };
  return { x: p.y / SIN_TILT, y: -p.x };
}

export function footprint(o: WorldObject): Pt[] {
  if (o.shape === "ellipse") return Array.from({ length: 40 }, (_, i) => ({ x: o.x + Math.cos(i * Math.PI / 20) * o.width / 2, y: o.y + Math.sin(i * Math.PI / 20) * o.depth / 2 }));
  return [{ x: o.x - o.width / 2, y: o.y - o.depth / 2 }, { x: o.x + o.width / 2, y: o.y - o.depth / 2 },
    { x: o.x + o.width / 2, y: o.y + o.depth / 2 }, { x: o.x - o.width / 2, y: o.y + o.depth / 2 }];
}

export function projectedBounds(view: Projection, b: Box, minZ = -120, maxZ = 300): Box {
  const points = [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].flatMap((y) => [minZ, maxZ].map((z) => project(view, { x, y }, z))));
  return { x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)), x1: Math.max(...points.map((p) => p.x)), y1: Math.max(...points.map((p) => p.y)) };
}

/** Painter order uses the camera's viewing axis, never screen height (which includes z). */
export function depthOrder(view: Projection, objects: readonly WorldObject[]): WorldObject[] {
  const key = (o: WorldObject) => {
    const centre = project(view, o).depth;
    // Footprints of large structures extend toward the camera. Canopies still sort by their trunk.
    if ((typeof view === "string" && !isDirectional(view)) || o.type === "tree") return centre;
    const { yaw } = cameraAngle(view);
    return centre + (Math.abs(Math.sin(yaw)) * o.width + Math.abs(Math.cos(yaw)) * o.depth) / 2;
  };
  return [...objects].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

/** Immersive defaults fill the vertical space on narrow screens; Overview shows every outer edge. */
export function frameProjection(view: Projection, bounds: Box, width: number, height: number, slabDepth = 120, framing: "immersive" | "overview" = "immersive"): Pt & { scale: number } {
  const b = projectedBounds(view, bounds, -slabDepth, 320);
  const across = Math.max(1, width - 32) / (b.x1 - b.x0), down = Math.max(1, height - 100) / (b.y1 - b.y0);
  const fit = Math.min(across, down);
  const tilt = cameraAngle(view).tilt;
  const blend = framing === "overview" ? 0 : Math.max(0, Math.min(1, (CAMERA_ANGLES.isometric.tilt - tilt) / (CAMERA_ANGLES.isometric.tilt - DIRECTIONAL_TILT)));
  const scale = fit + (Math.max(across, down * 0.9) - fit) * blend * blend * (3 - 2 * blend);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scale: Math.min(scale, 1.5) };
}
