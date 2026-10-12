import { describe, expect, it } from 'vitest';
import { terrainEdge } from '../web/lib/world/terrain-edge';
import { WORLD } from '../web/lib/world/world';

describe('terrain perimeter', () => {
  it('keeps the exact playable boundary flat and leaves the input bounds unchanged', () => {
    const before = { ...WORLD }, mesh = terrainEdge(WORLD, 120);
    expect(WORLD).toEqual(before);
    for (const p of mesh.rings[0]!) {
      expect(p.z).toBe(0);
      expect(p.x === WORLD.x0 || p.x === WORLD.x1 || p.y === WORLD.y0 || p.y === WORLD.y1).toBe(true);
    }
    expect(mesh.rings[0]).toContainEqual({ x: WORLD.x0, y: WORLD.y0, z: 0 });
    expect(mesh).toBe(terrainEdge({ ...WORLD }, 120));
  });
  it('has bounded erosion, rounded lower corners, variable depth and occasional rock', () => {
    const mesh = terrainEdge(WORLD, 120), depths = new Set(mesh.rings[4]!.map(p => Math.round(p.z)));
    expect(depths.size).toBeGreaterThan(10);
    for (const ring of mesh.rings.slice(1)) for (const p of ring) {
      expect(p.z).toBeLessThan(0); expect(p.z).toBeGreaterThan(-140);
      expect(p.x).toBeGreaterThan(WORLD.x0 - 55); expect(p.x).toBeLessThan(WORLD.x1 + 55);
      expect(p.y).toBeGreaterThan(WORLD.y0 - 55); expect(p.y).toBeLessThan(WORLD.y1 + 55);
    }
    const lowerCorner = mesh.rings[4]![0]!;
    expect(lowerCorner.x).toBeGreaterThan(WORLD.x0 + 20);
    expect(lowerCorner.y).toBeGreaterThan(WORLD.y0 + 20);
    const rock = mesh.faces.filter(f => f.material === 'rock').length;
    expect(rock).toBeGreaterThan(0); expect(rock).toBeLessThan(mesh.faces.length / 3);
    expect(new Set(mesh.faces.map(f => f.material))).toEqual(new Set(['turf', 'soil', 'earth', 'sediment', 'rock']));
    expect(mesh.faces.length).toBeLessThan(1600);
  });
  it('joins neighbouring segments and strata without open seams or degenerate faces', () => {
    const mesh = terrainEdge(WORLD, 120), edges = new Map<string, number>();
    const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
    for (const face of mesh.faces) {
      expect(Math.hypot(face.normal.x, face.normal.y, face.normal.z)).toBeCloseTo(1, 8);
      for (let i = 0; i < 3; i++) {
        const edge = [key(face.points[i]!), key(face.points[(i + 1) % 3]!)].sort().join('/');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    // Only the top and bottom rims are open; the existing ground surface caps the top.
    expect([...edges.values()].filter(n => n === 1)).toHaveLength(mesh.segments * 2);
    expect([...edges.values()].every(n => n === 1 || n === 2)).toBe(true);
  });
});
