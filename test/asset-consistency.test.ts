import { describe, expect, it } from 'vitest';
import { applySolidAppearance, SOLID_FAMILIES } from '../web/lib/world/solid-appearance';
import { TREE_KINDS, SOLID_MATERIALS, SOLID_DECALS, solidMesh } from '../web/lib/world/solid-models';
import { pictureObject, treeObject, plotObjects } from '../web/lib/world/model';
import { NEW_TOWN } from '../web/lib/world/growth';
import { fixedObjectGeometry, projectedObjectFaces } from '../web/lib/world/object-geometry';
import { PIECES } from '../web/lib/world/pieces';
import { SITES } from '../web/lib/world/town';
import { physicalKind } from '../web/lib/world/object-appearance';
import { worldPicker, screenPoint } from '../web/lib/world/picking';

describe('one solid environment', () => {
  it('replaces every residential/growth/landmark house and hut with a complete model', () => {
    const keys = [...Object.keys(SOLID_FAMILIES), ...PIECES.map(p => p.key),
      ...Object.keys(SITES).filter(k => k !== 'arena').map(k => `building-${k}`),
      'old-small-house', 'old-hut', 'wooden-shed', 'resources-gold-mine-goldmine-active'];
    for (const key of keys) {
      const o = pictureObject(key, { key, frame: 0 }, { x: 100, y: 200 }, 128, 160);
      applySolidAppearance(o);
      if (['house', 'major-building', 'market', 'shop', 'tower', 'tent'].includes(physicalKind(o)) || /hut|shed|gold.?mine/.test(key)) {
        expect(o.solid, key).toBeDefined();
        expect(fixedObjectGeometry(o).every(f => !f.art), key).toBe(true);
      }
    }
    for (const plot of NEW_TOWN.plots) for (const o of plotObjects(plot)) {
      if (['house', 'shop', 'market'].includes(physicalKind(o))) expect(o.solid, o.id).toBeDefined();
    }
  });
  it('keeps working structures and the arena unchanged', () => {
    const o = pictureObject('new-house', { key: 'growth-house-a', frame: 0 }, { x: 20, y: 30 }, 70.4, 100);
    applySolidAppearance(o); const before = structuredClone(o);
    applySolidAppearance(o); expect(o).toEqual(before);
    const { solid: _solid, ...base } = o;
    const arena = { ...base, id: 'arena', type: 'arena' as const };
    const initial = structuredClone(arena); applySolidAppearance(arena); expect(arena).toEqual(initial);
    expect(SOLID_FAMILIES['building-library']).toEqual({ kind: 'hall', width: 0, landmark: true });
    expect(SOLID_FAMILIES['market-blue']).toEqual({ kind: 'stall', width: 128 });
  });
  it('has seven distinct reusable tree meshes with textured trunks and closed canopy surfaces', () => {
    const bounds = new Set<string>();
    for (const kind of TREE_KINDS) {
      const mesh = solidMesh(kind), materials = new Set(Array.from(mesh.materials, i => SOLID_MATERIALS[i]!));
      expect(mesh).toBe(solidMesh(kind));
      expect(mesh.min[2]).toBe(0);
      expect(mesh.triangles).toBeLessThan(1200);
      expect(materials.has('bark')).toBe(true);
      expect(materials.has('leaves')).toBe(true);
      expect([...materials].some(m => SOLID_DECALS.has(m))).toBe(false);
      bounds.add(JSON.stringify([mesh.min, mesh.max]));
      for (let i = 0; i < mesh.normals.length; i += 3) expect(Math.hypot(...mesh.normals.slice(i, i + 3))).toBeCloseTo(1, 5);
      // Leaf faces form closed components: every quantized edge has two incident triangles.
      const edges = new Map<string, number>();
      for (let t = 0; t < mesh.positions.length; t += 9) {
        if (!SOLID_MATERIALS[mesh.materials[t / 3]!]!.startsWith('leaves')) continue;
        const points = [0, 3, 6].map(k => Array.from(mesh.positions.slice(t + k, t + k + 3), x => Math.round(x * 1000)).join(','));
        for (let j = 0; j < 3; j++) {
          const edge = [points[j]!, points[(j + 1) % 3]!].sort().join('/');
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every(count => count === 2), `${kind}: open canopy`).toBe(true);
    }
    expect(bounds.size).toBe(7);
  });
  it('uses deterministic tree families in both the forest and captured scenery', () => {
    const families = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const data = { id: `${i}`, k: 'resources-trees-tree', f: i % 4, x: i * 50, y: 20, s: .55 };
      const tree = treeObject(data); families.add(tree.solid!);
      expect(tree.solid).toBe(treeObject(data).solid);
      expect(tree.metadata?.topAnchor).toEqual({ x: data.x, y: data.y });
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const faces = projectedObjectFaces({ yaw, tilt: .55 }, tree);
        expect(faces.length).toBeGreaterThan(0);
        expect(faces.every(f => !f.face.art)).toBe(true);
      }
    }
    expect(families.size).toBe(7);
  });
  it('picks translated and scaled shared meshes at the same locations as their rendered faces', () => {
    const objects = [treeObject({ id: 'pick', k: 'resources-trees-tree', f: 0, x: 320, y: 210, s: .45 }),
      applySolidAppearance(pictureObject('site:home', { key: 'growth-house-a', frame: 0 }, { x: 220, y: 300 }, 100, 160))];
    for (const source of objects) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const o = { ...source, id: 'site:home', type: 'building' as const, elevation: 17 };
      const view = { yaw, tilt: .55 }, camera = { x: 0, y: 0, scale: .7 };
      const picker = worldPicker(view, [o], camera, 1200, 900);
      const faces = projectedObjectFaces(view, o);
      // Interior triangle points must stay clickable after removing the instance transform.
      for (const face of faces.filter((_, i) => i % 23 === 0)) {
        const centre = face.points.reduce((p, v) => ({ x: p.x + v.x / 3, y: p.y + v.y / 3 }), { x: 0, y: 0 });
        const p = { x: 600 + (centre.x - camera.x) * camera.scale, y: 450 + (centre.y - camera.y) * camera.scale };
        expect(picker(p), `${o.solid}/${yaw}`).toEqual({ kind: 'building', id: 'home' });
      }
      expect(picker(screenPoint(view, camera, 1200, 900, { x: o.x + 2000, y: o.y + 2000 }))).toBeNull();
    }
  });
});
