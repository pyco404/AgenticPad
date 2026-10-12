import { describe, expect, it } from 'vitest';
import { solidMesh, SOLID_MATERIALS } from '../web/lib/world/solid-models';
import { applySolidAppearance } from '../web/lib/world/solid-appearance';
import { worldObject } from '../web/lib/world/model';
import { projectedObjectFaces } from '../web/lib/world/object-geometry';
import { COLOSSEUM, ARENA_GATE_WIDTH, ARENA_SIDE_WIDTH } from '../web/lib/world/arena-geometry';

describe('landmark polish', () => {
  it('builds one closed, grounded mountain with layered slopes and snow only at the summit', () => {
    const mesh=solidMesh('mountain'), edges=new Map<string,number>(), heights=new Set<number>();
    expect(mesh).toBe(solidMesh('mountain'));expect(mesh.min[2]).toBe(0);expect(mesh.max[2]).toBe(287);
    expect(mesh.triangles).toBeLessThan(250);
    for(let t=0;t<mesh.positions.length;t+=9) {
      const points=[0,3,6].map(k=>Array.from(mesh.positions.slice(t+k,t+k+3),x=>Math.round(x*1000)).join(','));
      for(let j=0;j<3;j++){const edge=[points[j]!,points[(j+1)%3]!].sort().join('/');edges.set(edge,(edges.get(edge)??0)+1);}
      expect(Math.hypot(...mesh.normals.slice(t,t+3))).toBeCloseTo(1,5);
      for(const k of [2,5,8]) {const z=mesh.positions[t+k]!;heights.add(Math.round(z));
        if(SOLID_MATERIALS[mesh.materials[t/3]!] === 'peakSnow')expect(z).toBeGreaterThan(170);}
    }
    expect([...edges.values()].every(n=>n===2)).toBe(true);expect(heights.size).toBeGreaterThan(30);
  });
  it('uses the same fixed mountain on all sides and retains the arena geometry', () => {
    const mountain=applySolidAppearance(worldObject('mountain','mountain',-960,-104,280,168,287));
    expect(mountain.solid).toBe('mountain');
    for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
      const faces=projectedObjectFaces({yaw,tilt:.55},mountain);expect(faces.length).toBeGreaterThan(20);expect(faces.every(f=>!f.face.art)).toBe(true);
    }
    const arena=worldObject('site:arena','arena',1400,775,760,400,48),before=structuredClone(arena);
    applySolidAppearance(arena);expect(arena).toEqual(before);
    expect(COLOSSEUM).toEqual({x:1400,y:775,rx:380,ry:200,wallHeight:48});expect(ARENA_GATE_WIDTH).toBe(192);expect(ARENA_SIDE_WIDTH).toBe(128);
  });
});
