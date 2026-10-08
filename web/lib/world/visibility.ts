import { ARENA_PASSAGES, COLOSSEUM_FLOOR } from "./arena-geometry";
import type { WorldObject } from "./model";
import { cameraAngle, project, type Projection } from "./projection";
import type { Pt } from "./world";

type Block = { object: WorldObject; across: number; halfAcross: number };

/** Sight rays rise toward the camera. Cross-axis lanes keep live-agent queries local. */
export function directionalVisibility(view: Projection, objects: readonly WorldObject[]): (p: Pt, z: number) => boolean {
  const { yaw, tilt } = cameraAngle(view), nx = Math.sin(yaw), ny = Math.cos(yaw), slope = Math.tan(tilt);
  if (tilt > Math.PI / 2 - 0.001) return () => true;
  const lanes = new Map<number, Block[]>(), cell = 128;
  for (const o of objects) {
    // Only real cover hides an agent: buildings, the arena, mountains and trees. Posts, flags, lamps,
    // benches, signs and stalls are too thin or low to, and counting them made walkers blink.
    if (o.category === "surface" || o.category === "movement" || o.type === "agent" || o.height < 5) continue;
    if (o.type !== "tree" && o.type !== "arena" && o.type !== "mountain" && (o.height < 40 || Math.min(o.width, o.depth) < 24 || /flag|banner|lamp|lantern|sign|post|bench|stall|market|kiosk|tent|fence|statue|fountain/.test(o.metadata?.texture ?? ""))) continue;
    const halfAcross = (Math.abs(ny) * o.width + Math.abs(nx) * (o.type === "tree" ? o.width : o.depth)) / 2;
    const block = { object: o, across: project(view, o).x, halfAcross };
    for (let c = Math.floor((block.across - halfAcross) / cell); c <= Math.floor((block.across + halfAcross) / cell); c++) {
      const bucket = lanes.get(c) ?? []; bucket.push(block); lanes.set(c, bucket);
    }
  }
  const ellipse = (p: Pt, x: number, y: number, rx: number, ry: number): [number, number] | null => {
    const dx = (p.x - x) / rx, dy = (p.y - y) / ry, vx = nx / rx, vy = ny / ry;
    const a = vx * vx + vy * vy, b = dx * vx + dy * vy, d = b * b - a * (dx * dx + dy * dy - 1);
    return d < 0 ? null : [(-b - Math.sqrt(d)) / a, (-b + Math.sqrt(d)) / a];
  };
  const box = (p: Pt, o: WorldObject, w = o.width, d = o.depth): [number, number] | null => {
    let far = -Infinity, near = Infinity;
    for (const [at, centre, half, direction] of [[p.x, o.x, w / 2, nx], [p.y, o.y, d / 2, ny]]) {
      if (Math.abs(direction!) < 1e-8) { if (Math.abs(at! - centre!) > half!) return null; }
      else {
        const a = (centre! - half! - at!) / direction!, b = (centre! + half! - at!) / direction!;
        far = Math.max(far, Math.min(a, b)); near = Math.min(near, Math.max(a, b));
      }
    }
    return near > far ? [far, near] : null;
  };
  return (p, z) => {
    const at = project(view, p);
    const hits = (span: [number, number] | null, bottom: number, top: number) => span !== null && span[1] > Math.max(0, span[0]) &&
      z + Math.max(0, span[0]) * slope <= top && z + span[1] * slope >= bottom;
    for (const b of lanes.get(Math.floor(at.x / cell)) ?? []) {
      const delta = Math.abs(at.x - b.across), o = b.object;
      if (delta > b.halfAcross) continue;
      const span = o.shape === "ellipse" || o.type === "mountain" ? ellipse(p, o.x, o.y, o.width / 2, o.depth / 2) : box(p, o);
      if (o.type === "arena" && span) {
        const f = COLOSSEUM_FLOOR, inner = ellipse(p, f.x, f.y, f.rx, f.ry);
        // Subtract the hollow floor and both entrance corridors before testing the remaining wall.
        let walls: [number, number][] = inner ? [[span[0], Math.min(span[1], inner[0])], [Math.max(span[0], inner[1]), span[1]]] : [span];
        for (const passage of ARENA_PASSAGES) {
          let from = -Infinity, to = Infinity;
          for (const [at, lo, hi, direction] of [[p.x, passage.x0, passage.x1, nx], [p.y, passage.y0, passage.y1, ny]]) {
            if (Math.abs(direction!) < 1e-8) { if (at! < lo! || at! > hi!) { to = -Infinity; break; } }
            else {
              const a = (lo! - at!) / direction!, c = (hi! - at!) / direction!;
              from = Math.max(from, Math.min(a, c)); to = Math.min(to, Math.max(a, c));
            }
          }
          if (to > from) walls = walls.flatMap(([a, c]) => to <= a || from >= c ? [[a, c] as [number, number]] :
            [[a, Math.min(c, from)], [Math.max(a, to), c]] as [number, number][]);
        }
        if (walls.some((wall) => hits(wall, o.elevation, o.elevation + o.height))) return false;
      } else if (o.type === "tree") {
        if (hits(box(p, o, o.width * 0.12, o.width * 0.12), o.elevation, o.elevation + o.height * 0.58)) return false;
        const canopyTop = o.elevation + o.height * (1 - delta / b.halfAcross * 0.65);
        if (hits(ellipse(p, o.x, o.y, o.width / 2, o.width / 2), o.elevation + o.height * 0.3, canopyTop)) return false;
      } else if (hits(span, o.elevation, o.elevation + o.height)) return false;
    }
    return true;
  };
}
