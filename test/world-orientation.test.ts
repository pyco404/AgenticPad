import { describe, expect, it } from 'vitest';
import { pictureObject, worldObject } from '../web/lib/world/model';
import { directionalAssetAudit, objectVertex, physicalKind, visibleObjectSide } from '../web/lib/world/object-appearance';
import { fixedObjectGeometry, projectedObjectFaces } from '../web/lib/world/object-geometry';

const kinds = [
 ['House_Blue','house'],['building-library','major-building'],['growth-shop','shop'],['market-blue','market'],
 ['ac-scoreboard','sign'],['building-lookout','tower'],['ac-tent','tent'],['resources-trees-tree','tree'],
 ['ac-bench','bench'],['ac-flag','flag'],['growth-lamp','lamp'],['dress-fountain','fountain'],['building-launchpad','launch-pad'],
] as const;
const object = (key:string) => pictureObject(key.startsWith('building-') ? `site:${key.slice(9)}` : key, {key,frame:0}, {x:100,y:200}, 100,160);

describe('stationary world objects', () => {
 it.each(kinds)('%s retains its %s identity and fixed geometry through a full camera orbit', (key,kind) => {
  const o=object(key); if(kind==='tree') o.type='tree';
  expect(physicalKind(o)).toBe(kind);
  const before=structuredClone(o), mesh=structuredClone(fixedObjectGeometry(o));
  for(let i=0;i<=72;i++) for(const tilt of [.27,.52,Math.PI/2]) {
   const faces=projectedObjectFaces({yaw:i*Math.PI/36,tilt},o);
   expect(faces.length).toBeGreaterThan(0);
   expect(faces.flatMap(f=>f.points).every(p=>Number.isFinite(p.x+p.y+p.depth))).toBe(true);
   expect(fixedObjectGeometry(o)).toEqual(mesh); expect(o).toEqual(before);
  }
 });
 it('classifies growth pieces by their own art instead of the enclosing plot name', () => {
  const o=object('growth-house-a');o.id='growth:market-shop-quarter:3';
  expect(physicalKind(o)).toBe('house');
 });
 it('matches opaque frame dimensions without changing the world footprint or front threshold', () => {
  const o=object('house'), before=structuredClone(o);
  const frame={image:{},x:0,y:0,width:100,height:160,content:{x:25,y:40,width:50,height:120}};
  const faces=fixedObjectGeometry(o,frame), front=faces.find(f=>f.art)!;
  expect(front.vertices[1]!.x-front.vertices[0]!.x).toBe(50);
  expect(front.vertices[2]!.z-front.vertices[1]!.z).toBe(120);
  expect(front.vertices[0]!.y).toBe(o.y+o.depth/2+2);
  expect(o).toEqual(before);
 });
 it('selects front, rear and sides relative to fixed cardinal orientation', () => {
  const o=object('house');
  for(const [yaw,side] of [[0,'front'],[Math.PI,'back'],[-Math.PI/2,'left'],[Math.PI/2,'right']] as const) {
   expect(visibleObjectSide({yaw,tilt:.5},o)).toBe(side);
  }
  o.orientation='east';
  expect(visibleObjectSide({yaw:Math.PI/2,tilt:.5},o)).toBe('front');
  expect(visibleObjectSide({yaw:0,tilt:.5},o)).toBe('left');
  expect(objectVertex(o,0,10,20)).toEqual({x:o.x+10,y:o.y,z:20});
 });
 it('retains a discrete side within a five-degree boundary dead band', () => {
  const o=object('house');
  for(const degrees of [44,46,49,47]) expect(visibleObjectSide({yaw:degrees*Math.PI/180,tilt:.5},o,'front')).toBe('front');
  expect(visibleObjectSide({yaw:51*Math.PI/180,tilt:.5},o,'front')).toBe('right');
  for(const degrees of [46,44,41,43]) expect(visibleObjectSide({yaw:degrees*Math.PI/180,tilt:.5},o,'right')).toBe('right');
 });
 it('never mirrors or reuses a front asset on an unavailable rear or side face', () => {
  for(const [key] of kinds.filter(([,kind])=>kind!=='tree')) {
   const o=object(key), front=projectedObjectFaces({yaw:0,tilt:.5},o), rear=projectedObjectFaces({yaw:Math.PI,tilt:.5},o);
   expect(rear.some(f=>f.face.art?.key===key)).toBe(false);
   if(['house','major-building','shop','market','sign','tower','tent','launch-pad'].includes(physicalKind(o))) expect(front.some(f=>f.face.art?.key===key)).toBe(true);
   const audit=directionalAssetAudit([o])[0]!;
   expect(audit.available).toEqual(['front']);expect(audit.missing).toEqual(['back','left','right']);
  }
 });
 it('uses the same detailed vegetation art on fixed faces at every azimuth and camera tilt', () => {
  const o=object('resources-trees-tree');o.type='tree';
  const before=structuredClone(o),frame={image:{},x:0,y:0,width:192,height:192,content:{x:18,y:37,width:156,height:143}};
  const mesh=structuredClone(fixedObjectGeometry(o,frame));
  for(let i=0;i<=72;i++) for(const tilt of [.27,.52,Math.PI/2]) {
   const faces=projectedObjectFaces({yaw:i*Math.PI/36,tilt},o,frame);
   expect(faces.length).toBeGreaterThan(0);
   expect(faces.every(f=>f.face.art?.key==='resources-trees-tree')).toBe(true);
   expect(fixedObjectGeometry(o,frame)).toEqual(mesh);
  }
  expect(mesh.every(f=>f.vertices.length===4&&f.art)).toBe(true);
  expect(mesh.find(f=>f.normal.z===1)!.crop!.height).toBeLessThan(frame.content.height);
  expect(o).toEqual(before);
 });
 it('retains tree sizes and canopy variants without changing forest coordinates', () => {
  const small=object('resources-trees-tree'), large=object('resources-trees-tree');
  small.metadata!.art!.frame=1;large.metadata!.art!.frame=0;
  small.height=80;small.width=50;large.height=160;large.width=100;
  expect(fixedObjectGeometry(small).every(f=>f.art?.frame===1)).toBe(true);
  expect(fixedObjectGeometry(large).every(f=>f.art?.frame===0)).toBe(true);
  expect(Math.max(...fixedObjectGeometry(small).flatMap(f=>f.vertices.map(p=>p.z)))).toBe(80);
  expect(Math.max(...fixedObjectGeometry(large).flatMap(f=>f.vertices.map(p=>p.z)))).toBe(160);
  expect({x:small.x,y:small.y}).toEqual({x:large.x,y:large.y});
 });
 it('mounts supplied directional assets on only their own world faces', () => {
  const o=object('shop');o.directionalAssets={front:{key:'shop-front',frame:0},back:{key:'shop-service',frame:0},left:{key:'shop-left',frame:0},right:{key:'shop-right',frame:0}};
  for(const [yaw,key] of [[0,'shop-front'],[Math.PI,'shop-service'],[-Math.PI/2,'shop-left'],[Math.PI/2,'shop-right']] as const) {
   expect(projectedObjectFaces({yaw,tilt:.5},o).filter(f=>f.face.art).map(f=>f.face.art!.key)).toEqual([key]);
  }
 });
 it('keeps terrain flat and agents outside physical directional classification', () => {
  expect(physicalKind(pictureObject('yard',{key:'Yard',frame:0},{x:0,y:0},90,50,true))).toBe('terrain');
  const agent=worldObject('agent:walker','agent',0,0,20,14,38);
  expect(directionalAssetAudit([agent])).toEqual([]);
 });
});
