import type { ArtRef, WorldObject } from './model';
import { cameraAngle, type Projection } from './projection';

export type ObjectSide = 'front' | 'back' | 'left' | 'right';
export type PhysicalKind = 'house' | 'major-building' | 'shop' | 'market' | 'sign' | 'tower' | 'tent' | 'tree' | 'bench' | 'flag' | 'lamp' | 'fountain' | 'launch-pad' | 'fence' | 'chest' | 'statue' | 'fire' | 'rock' | 'shrub' | 'animal' | 'table' | 'miscellaneous' | 'mountain' | 'bridge' | 'arena' | 'terrain';
export const ORIENTATION_YAW = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };
export const SIDE_YAW: Record<ObjectSide, number> = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };

/** Semantic identity, independent of camera position. More specific props win over building names. */
export function physicalKind(o: WorldObject): PhysicalKind {
  if (o.appearance) return o.appearance;
  const key = (o.metadata?.art?.key ?? o.metadata?.texture ?? o.id).toLowerCase();
  if (o.type === 'arena' || o.type === 'tree' || o.type === 'bridge' || o.type === 'mountain') return o.type;
  if (o.category === 'surface' || o.metadata?.flat) return 'terrain';
  if (/^deco-(09|11|08)$/.test(key)) return 'shrub';
  if (/^deco-(16|17)$/.test(key)) return 'sign';
  if (/^deco-(05|06)$/.test(key)) return 'rock';
  if (/launchpad|launch-pad/.test(key)) return 'launch-pad';
  if (/lookout|tower/.test(key)) return 'tower';
  if (/scoreboard|notice|board|sign/.test(key)) return 'sign';
  if (/bazaar|market|stall/.test(key)) return 'market';
  if (/tent/.test(key)) return 'tent';
  if (/shop|kiosk|smithy/.test(key)) return 'shop';
  if (/bench/.test(key)) return 'bench';
  if (/flag|banner/.test(key)) return 'flag';
  if (/lamp|lantern|solar/.test(key)) return 'lamp';
  if (/fountain/.test(key)) return 'fountain';
  if (/fence|rail/.test(key)) return 'fence';
  if (/chest|crate|barrel/.test(key)) return 'chest';
  if (/statue|trophy/.test(key)) return 'statue';
  if (/fire|torch/.test(key)) return 'fire';
  if (/rock|gold|coins|log|pumpkin/.test(key)) return 'rock';
  if (/bush|planter/.test(key)) return 'shrub';
  if (/sheep|animal/.test(key)) return 'animal';
  if (/table/.test(key)) return 'table';
  if (/wild-mountain/.test(key)) return 'mountain';
  if (/site:(castle|forge|library|chapel|tavern)|building-(castle|forge|library|chapel|tavern)|hall|treasury|strategy-lab/.test(key)) return 'major-building';
  if (/house|villa|office|apartments|building/.test(key) || o.type === 'building') return 'house';
  return 'miscellaneous';
}

/** The front is tied to the object's orientation, never to the camera. */
export function sideFacing(view: Projection, o: WorldObject, side: ObjectSide): number {
  return Math.cos(cameraAngle(view).yaw - ORIENTATION_YAW[o.orientation] - SIDE_YAW[side]);
}

/** Optional discrete assets can use this dead band; geometry itself changes continuously. */
export function visibleObjectSide(view: Projection, o: WorldObject, previous?: ObjectSide): ObjectSide {
  const sides: ObjectSide[] = ['front', 'right', 'back', 'left'];
  const best = sides.reduce((a, b) => sideFacing(view, o, a) >= sideFacing(view, o, b) ? a : b);
  if (previous && sideFacing(view, o, previous) >= Math.cos(Math.PI / 4 + Math.PI / 36)) return previous;
  return best;
}

export function directionalArt(o: WorldObject, side: ObjectSide): ArtRef | undefined {
  return o.directionalAssets?.[side] ?? (side === 'front' ? o.metadata?.art ?? (o.metadata?.texture ? { key: o.metadata.texture, frame: o.metadata.frame ?? 0 } : undefined) : undefined);
}

/** Fixed local x/right, y/front, z/up axes. Existing footprint dimensions stay in world space. */
export function objectVertex(o: WorldObject, x: number, y: number, z: number) {
  const yaw = ORIENTATION_YAW[o.orientation], c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: o.x + x * c + y * s, y: o.y - x * s + y * c, z: o.elevation + z };
}
export function localSize(o: WorldObject) {
  const turned = o.orientation === 'east' || o.orientation === 'west';
  return { width: turned ? o.depth : o.width, depth: turned ? o.width : o.depth, height: o.height };
}

export function directionalAssetAudit(objects: readonly WorldObject[]) {
  return objects.filter(o => o.category !== 'agent' && o.category !== 'movement' && physicalKind(o) !== 'terrain').map(o => ({
    id: o.id, label: o.metadata?.label, texture: o.metadata?.art?.key ?? o.metadata?.texture,
    kind: physicalKind(o), orientation: o.orientation,
    model: o.solid,
    available: (['front', 'back', 'left', 'right'] as ObjectSide[]).filter(side => o.solid || directionalArt(o, side)),
    missing: (['front', 'back', 'left', 'right'] as ObjectSide[]).filter(side => !o.solid && !directionalArt(o, side)),
    fallback: o.solid ? 'shared solid geometry' : physicalKind(o) === 'miscellaneous' && !/stump|dummy/.test(o.metadata?.art?.key ?? o.metadata?.texture ?? o.id) ? 'fixed front plane and neutral support; needs a bespoke volume' : 'object-specific fixed geometry',
  }));
}
