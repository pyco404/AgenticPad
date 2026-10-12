import type { ArtFrame, ArtRef, WorldObject } from "./model";
import { depthOrder, footprint, project, type Projection } from "./projection";
import type { Pt } from "./world";
import { projectedObjectFaces } from "./object-geometry";
import { solidMesh } from './solid-models';
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
  // Project each shared mesh once. Thousands of trees test points against the same native
  // polygons after removing their translation and scale, rather than keeping faces per instance.
  const shapes = new Map<string, { polygons: Pt[][]; bounds: { x0: number; y0: number; x1: number; y1: number } }>();
  const areas = depthOrder(view, visible).map((o) => {
    const target: WorldTarget | null = o.id.startsWith("site:") && (o.type === "building" || o.type === "arena")
      ? { kind: "building", id: o.id.slice(5) } : null;
    if (o.solid) {
      const vegetation = o.solid.startsWith('tree') || o.solid === 'shrub';
      const factor = vegetation ? o.width / (o.solid === 'shrub' && !o.id.startsWith('forest:') ? 64 : 192) : 1;
      const key = `${solidMesh(o.solid, o.solidVariant).key}:${o.orientation}`;
      let shape = shapes.get(key);
      if (!shape) {
        const template = { ...o, id: `pick:${o.solid}`, x: 0, y: 0, elevation: 0,
          width: vegetation ? o.solid === 'shrub' ? 64 : 192 : o.width, metadata: { topAnchor: { x: 0, y: 0 } } };
        const polygons = projectedObjectFaces(view, template).map(f => f.points);
        const points = polygons.flat();
        shape = { polygons, bounds: { x0: Math.min(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)),
          x1: Math.max(...points.map(p => p.x)), y1: Math.max(...points.map(p => p.y)) } };
        shapes.set(key, shape);
      }
      const origin = project(view, o.metadata?.topAnchor ?? { x: o.x, y: o.y + o.depth / 2 }, o.elevation);
      const shared = shape;
      return { target, hit: (p: Pt) => {
        const local = { x: ((p.x - width / 2) / camera.scale + camera.x - origin.x) / factor,
          y: ((p.y - height / 2) / camera.scale + camera.y - origin.y) / factor };
        const b = shared.bounds;
        return local.x >= b.x0 && local.x <= b.x1 && local.y >= b.y0 && local.y <= b.y1 && shared.polygons.some(poly => polygonContains(local, poly));
      } };
    }
    if (o.type !== "arena" && o.type !== "bridge" && o.type !== "agent") {
      const front = o.directionalAssets?.front ?? o.metadata?.art;
      const faces = projectedObjectFaces(view, o, front ? art?.(front) ?? undefined : undefined).map(({ face, points }) => ({ face, frame: face.art && art?.(face.art),
        points: points.map(p => ({ x: width / 2 + (p.x - camera.x) * camera.scale, y: height / 2 + (p.y - camera.y) * camera.scale })) }));
      return { target, hit: (p: Pt) => [...faces].reverse().some(({ face, frame, points }) => {
        if (!polygonContains(p, points)) return false;
        if (!face.art) return true;
        if (!frame) return false;
        // Inverse of the same affine world-face texture transform used by the renderer.
        const [bl, , tr, tl] = points;
        const ax = tr!.x - tl!.x, ay = tr!.y - tl!.y, bx = bl!.x - tl!.x, by = bl!.y - tl!.y;
        const determinant = ax * by - ay * bx;
        if (Math.abs(determinant) < 1e-8) return false;
        const dx = p.x - tl!.x, dy = p.y - tl!.y;
        const u = (dx * by - dy * bx) / determinant, v = (ax * dy - ay * dx) / determinant;
        const tx = face.art.flipX ? 1 - u : u, crop = face.crop;
        return sample(frame, crop ? (crop.x + tx * crop.width) / frame.width : tx,
          crop ? (crop.y + v * crop.height) / frame.height : v);
      }) };
    }
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
