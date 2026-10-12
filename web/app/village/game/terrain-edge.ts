import { terrainEdge, type EdgeVertex } from '../../../lib/world/terrain-edge';
import { project, cameraAngle, type Projection } from '../../../lib/world/projection';
import type { Box } from '../../../lib/world/world';
import type { TopGround } from '../../../lib/world/model';
import { darker, TERRAIN } from './palette';
import { worldPerformance } from '../../../lib/world/render-performance';

const palette = { turf: TERRAIN.grass.shade, soil: '#795334', earth: '#936a43', sediment: '#584a37', rock: '#62615a' };
const samples = new WeakMap<object, { data: Uint8ClampedArray; width: number; height: number }>();
function groundSample(ground: TopGround | null | undefined) {
  if (!ground) return undefined;
  const image = ground.image as object; let sample = samples.get(image);
  if (!sample) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(image as CanvasImageSource, 0, 0, 256, 256);
    sample = { data: g.getImageData(0, 0, 256, 256).data, width: 256, height: 256 }; samples.set(image, sample);
  }
  return sample;
}

/** Ground bake only. No new textures, GPU work, world objects or per-frame layers. */
export function drawTerrainEdge(ctx: CanvasRenderingContext2D, view: Projection, bounds: Box, depth: number, ground?: TopGround | null): void {
  const started = worldPerformance.start(), mesh = terrainEdge(bounds, depth), angle = cameraAngle(view), sample = groundSample(ground);
  const toward = { x: Math.sin(angle.yaw) * Math.cos(angle.tilt), y: Math.cos(angle.yaw) * Math.cos(angle.tilt), z: Math.sin(angle.tilt) };
  const projected = new Map<EdgeVertex, ReturnType<typeof project>>();
  const at = (p: EdgeVertex) => { let q = projected.get(p); if (!q) { q = project(view, p, p.z); projected.set(p, q); } return q; };
  // Draw paired triangles as a single wall facet: no diagonal antialias cracks or tiled grid.
  const faces = [];
  for (let i = 0; i < mesh.faces.length; i += 2) {
    const a = mesh.faces[i]!, b = mesh.faces[i + 1]!;
    const normal = { x: (a.normal.x + b.normal.x) / 2, y: (a.normal.y + b.normal.y) / 2, z: (a.normal.z + b.normal.z) / 2 };
    if (normal.x * toward.x + normal.y * toward.y + normal.z * toward.z <= .001) continue;
    const points = [a.points[0]!, b.points[1]!, a.points[1]!, a.points[2]!];
    faces.push({ ...a, normal, points, depth: points.reduce((sum, p) => sum + at(p).depth, 0) / 4 });
  }
  faces.sort((a, b) => a.depth - b.depth);
  ctx.lineWidth = .65 / Math.max(.01, Math.abs(ctx.getTransform().a)); ctx.lineJoin = 'round';
  for (const face of faces) {
    let colour = palette[face.material];
    if (face.material === 'turf' && sample && ground) {
      const anchor = mesh.rings[0]![face.segment]!;
      const x = Math.max(0, Math.min(255, Math.floor((anchor.x - ground.x0) / ground.width * 256)));
      const y = Math.max(0, Math.min(255, Math.floor((anchor.y - ground.y0) / ground.height * 256)));
      const at = (y * 256 + x) * 4, r = sample.data[at]!, g = sample.data[at + 1]!, b = sample.data[at + 2]!;
      // Coastal edges retain a dark silt lip instead of acquiring a grass fringe over the sea.
      colour = b > r * 1.15 && b > g * .9 ? '#49625d' : palette.turf;
    }
    const light = Math.max(0, face.normal.x * -.46 + face.normal.y * .52 + face.normal.z * .72);
    ctx.fillStyle = darker(colour, .22 - light * .16 + face.tone); ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath(); face.points.forEach((p, i) => { const q = at(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if ((face.material === 'rock' && face.segment % 3 === 1) || (face.material === 'soil' && face.segment % 7 === 3)) {
      const [a, b, c, d] = face.points as [EdgeVertex, EdgeVertex, EdgeVertex, EdgeVertex];
      const mix = (p: EdgeVertex, q: EdgeVertex, t: number): EdgeVertex => ({ x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t });
      // Fixed-world fractures and small angular mineral patches, inset from all facet boundaries.
      const seed = face.segment + Math.round(Math.abs(a.z)), u = .18 + (seed % 5) * .07;
      const p = mix(mix(a,d,u),mix(b,c,u),.2 + (seed % 3) * .08);
      const q = mix(mix(a,d,.58),mix(b,c,.58),.6 + (seed % 4) * .06);
      const r = mix(mix(a,d,.84-(seed%3)*.06),mix(b,c,.84-(seed%3)*.06),.52);
      ctx.fillStyle = darker(colour, .3 + face.tone); ctx.beginPath();
      for (const [i,v] of [p,q,r].entries()) {const s=project(view,v,v.z);if(i)ctx.lineTo(s.x,s.y);else ctx.moveTo(s.x,s.y);} ctx.closePath();ctx.fill();
    }
  }
  worldPerformance.count('perimeterFaces', faces.length); worldPerformance.endStage('perimeter', started);
}
