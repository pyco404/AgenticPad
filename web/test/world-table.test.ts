import { describe, expect, it, vi } from 'vitest';
import { project } from '../lib/world/projection';
import { CardTable } from '../app/village/game/table';

vi.mock('../app/village/game/text', () => ({ MONO: 'monospace', crispText: vi.fn() }));

describe('physical match table projection', () => {
  it('keeps the table in the same world position through a full orbit, even when players swap screen sides', () => {
    const graphics = { clear() { return this; }, fillStyle() { return this; }, fillRect() { return this; }, setDepth() { return this; } };
    const scene = { add: { graphics: () => graphics } } as unknown as ConstructorParameters<typeof CardTable>[0];
    const table = new CardTable(scene, true);
    const a = { x: 180, y: 300 }, b = { x: 220, y: 300 };
    table.place(a, b, 1);
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
    let expected: string[] | undefined;
    for (let i = 0; i <= 72; i++) {
      const view = { yaw: i * Math.PI / 36, tilt: .5 }, world: number[][] = [];
      table.paintTo(ctx, project(view, a), project(view, b), 1, (p, z) => {
        world.push([p.x, p.y, z]); return project(view, p, z);
      });
      expect(world.length).toBeGreaterThan(20);
      expect(world.some(p => p[2] === 18.4)).toBe(true);
      expect(world.every(p => p[0]! >= 170 && p[0]! <= 230 && p[1]! >= 288 && p[1]! <= 312)).toBe(true);
      const vertices = [...new Set(world.map(p => JSON.stringify(p)))].sort();
      if (expected) expect(vertices).toEqual(expected); else expected = vertices;
    }
  });
});
