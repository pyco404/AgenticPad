import type { ArtFrame, ArtRef, WorldObject } from "./model";
import { depthOrder, footprint, project, type Projection } from "./projection";
import type { Pt } from "./world";
type ProjectionCamera = { x: number; y: number; scale: number };

export type WorldTarget = { kind: "agent" | "building"; id: string };
export type ScreenBox = { x: number; y: number; width: number; height: number };
export const inside = (p: Pt, b: ScreenBox) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** The same screen transform used to draw the world; never changes a world point. */
export function screenPoint(view: Projection, camera: ProjectionCamera, width: number, height: number, p: Pt, z = 0): Pt {
  const at = project(view, p, z);
  return { x: width / 2 + (at.x - camera.x) * camera.scale, y: height / 2 + (at.y - camera.y) * camera.scale };
}

const polygonContains = (p: Pt, polygon: Pt[]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/** Back-to-front picking follows the renderer, including opaque non-interactive scenery. */
export function worldPicker(view: Projection, objects: readonly WorldObject[], camera: ProjectionCamera, width: number, height: number,
  art?: (ref: ArtRef) => ArtFrame | null, sample: (frame: ArtFrame, u: number, v: number) => boolean = () => true): (point: Pt) => WorldTarget | null {
  const screen = (p: Pt, z = 0) => screenPoint(view, camera, width, height, p, z);
  const visible = objects.filter((o) => {
    if (o.category === "surface" || o.category === "movement" || o.metadata?.flat) return false;
    const at = screen(o, o.height / 2), reach = (o.width + o.depth + o.height) * camera.scale;
    return Math.abs(at.x - width / 2) <= width / 2 + reach && Math.abs(at.y - height / 2) <= height / 2 + reach;
  });
  const areas = depthOrder(view, visible).map((o) => {
    const ref = o.metadata?.art, frame = ref && art?.(ref);
    const foot = screen(o.metadata?.topAnchor ?? o, o.elevation);
    const box = { x: foot.x - o.width * camera.scale / 2, y: foot.y - o.height * camera.scale, width: o.width * camera.scale, height: o.height * camera.scale };
    const target: WorldTarget | null = o.id.startsWith("site:") && (o.type === "building" || o.type === "arena")
      ? { kind: "building", id: o.id.slice(5) } : null;
    if (frame) return { target, hit: (p: Pt) => inside(p, box) && sample(frame, ref?.flipX ? 1 - (p.x - box.x) / box.width : (p.x - box.x) / box.width, (p.y - box.y) / box.height) };
    // Procedural arena walls: test the projected ellipses at ground and roof and the wall between them.
    const ring = (z: number) => Array.from({ length: 32 }, (_, i) => {
      const a = i / 32 * Math.PI * 2;
      return screen({ x: o.x + Math.cos(a) * o.width / 2, y: o.y + Math.sin(a) * o.depth / 2 }, z);
    });
    const floor = o.shape === "ellipse" ? ring(o.elevation) : footprint(o).map((p) => screen(p, o.elevation));
    const roof = o.shape === "ellipse" ? ring(o.elevation + o.height) : footprint(o).map((p) => screen(p, o.elevation + o.height));
    return { target, hit: (p: Pt) => polygonContains(p, floor) || polygonContains(p, roof) || floor.some((a, i) => {
      const j = (i + 1) % floor.length;
      return polygonContains(p, [a, floor[j]!, roof[j]!, roof[i]!]);
    }) };
  });
  return (p) => {
    for (let i = areas.length - 1; i >= 0; i--) if (areas[i]!.hit(p)) return areas[i]!.target;
    return null;
  };
}

/** Matches the upright live character, with a small touch-friendly minimum. */
export function agentBox(foot: Pt, scale: number): ScreenBox {
  const k = Math.max(0.32, Math.min(1.2, scale));
  const width = Math.max(12, 44 * k), height = Math.max(16, 76 * k);
  return { x: foot.x - width / 2, y: foot.y - height + 6 * k, width, height };
}
