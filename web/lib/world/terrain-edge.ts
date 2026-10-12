import type { Box, Pt } from './world';

export type EdgeVertex = Pt & { z: number };
export type EdgeMaterial = 'turf' | 'soil' | 'earth' | 'sediment' | 'rock';
export type EdgeFace = { points: EdgeVertex[]; normal: EdgeVertex; material: EdgeMaterial; tone: number; segment: number };
export type TerrainEdge = { rings: EdgeVertex[][]; faces: EdgeFace[]; segments: number };
const modules = [8, 18, 12, -6, -12, 2, 16, 6];
const cache = new Map<string, TerrainEdge>();

/** Fixed top boundary; all erosion lives below it. Adjacent modules share every ring vertex. */
export function terrainEdge(bounds: Box, depth: number): TerrainEdge {
  const key = `${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}:${depth}`;
  const known = cache.get(key); if (known) return known;
  const { x0, y0, x1, y1 } = bounds;
  const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const anchors: { point: Pt; normal: Pt }[] = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side]!, b = corners[(side + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(2, Math.ceil(length / 144));
    const nx = (b.y - a.y) / length, ny = -(b.x - a.x) / length;
    const spans = Array.from({ length: count }, (_, j) => [1, .72, 1.18, .86, 1.24, .94][j % 6]!);
    const total = spans.reduce((a, b) => a + b, 0); let along = 0;
    for (let j = 0; j < count; j++) {
      // Corner normals blend the two sides, so lower rings wrap rather than separate.
      const previous = corners[(side + 3) % 4]!, pl = Math.hypot(a.x - previous.x, a.y - previous.y);
      anchors.push({ point: { x: a.x + (b.x - a.x) * along / total, y: a.y + (b.y - a.y) * along / total },
        normal: j ? { x: nx, y: ny } : { x: (nx + (a.y - previous.y) / pl) / Math.SQRT2,
          y: (ny - (a.x - previous.x) / pl) / Math.SQRT2 } });
      along += spans[j]!;
    }
  }
  const segments = anchors.length, size = Math.min(1, depth / 120, (x1 - x0) / 500, (y1 - y0) / 500);
  const rings = [0, .1, .36, .68, 1].map((fraction, level) => anchors.map(({ point: p, normal: n }, i) => {
    if (!level) return { ...p, z: 0 };
    const radius = [0, 0, 65, 115, 170][level]! * size;
    const cx = Math.max(x0 + radius, Math.min(x1 - radius, p.x)), cy = Math.max(y0 + radius, Math.min(y1 - radius, p.y));
    const dx = p.x - cx, dy = p.y - cy, distance = Math.hypot(dx, dy);
    const round = radius && distance ? { x: cx + dx / distance * radius, y: cy + dy / distance * radius } : p;
    const erosion = modules[i % modules.length]! + 10 * Math.sin(i * .29) + 6 * Math.sin(i * .73);
    const rocky = Math.sin(i * .19 + 1.8) > .72;
    const offset = (level === 1 ? 5 + erosion * .25 : erosion * (level === 2 ? .8 : 1.55)
      + (rocky && level === 3 ? 12 : 0) - (i % 8 === 4 && level === 3 ? 10 : 0)) * size;
    const uneven = (Math.sin(i * .41) * 7 + Math.sin(i * .17 + 1) * 5 + (modules[i % 8]! - 3) * .4) * size;
    return { x: round.x + n.x * offset, y: round.y + n.y * offset,
      z: -depth * fraction + uneven * (level === 1 ? .18 : level === 4 ? 1 : .8) };
  }));
  const faces: EdgeFace[] = [];
  const triangle = (points: EdgeVertex[], material: EdgeMaterial, tone: number, segment: number) => {
    const [a, b, c] = points as [EdgeVertex, EdgeVertex, EdgeVertex];
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    const length = Math.hypot(normal.x, normal.y, normal.z);
    faces.push({ points, normal: { x: normal.x / length, y: normal.y / length, z: normal.z / length }, material, tone, segment });
  };
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments, rocky = Math.sin(i * .19 + 1.8) > .72;
    for (let band = 0; band < 4; band++) {
      const material: EdgeMaterial = band === 0 ? 'turf' : rocky && band >= 2 ? 'rock' : band === 1 ? 'soil' : band === 2 ? 'earth' : 'sediment';
      const tone = ((i % 8) % 3) * .035;
      const a = rings[band]![i]!, b = rings[band]![next]!, c = rings[band + 1]![next]!, d = rings[band + 1]![i]!;
      triangle([a, c, b], material, tone, i); triangle([a, d, c], material, tone, i);
    }
  }
  const result = { rings, faces, segments };
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, result); return result;
}
