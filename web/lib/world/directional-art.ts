import type { ArtRef, Structure } from './model';
import type { ObjectSide } from './object-appearance';
import VIEWS from './directional-views.json';

/**
 * Structures whose back, left and right views exist, by the front picture they were made from, and
 * how each stands (scripts/village-directional-art.cjs builds both from that picture's own pixels).
 * A structure missing here keeps its own fixed geometry with only its front art.
 */
const MANIFEST = VIEWS as Record<string, Structure & { name: string }>;

const SIDES = ['back', 'left', 'right'] as const;
const viewKey = (key: string, side: ObjectSide) => `${key}--${side}`;
/** Each texture's structure, as its views were queued for loading. */
const byTexture = new Map<string, Structure>();

/** The derived views to load for a texture whose front picture is `front`. */
export function directionalSources(key: string, front: string): { key: string; url: string }[] {
  const entry = MANIFEST[front];
  if (!entry) return [];
  const { name, ...structure } = entry;
  byTexture.set(key, structure);
  return SIDES.map((side) => ({ key: viewKey(key, side), url: `/village/reference/directional/${name}-${side}.png` }));
}

/**
 * All four sides of a structure drawn from `front`, and how it stands. A mirrored structure is the
 * mirror image of the whole object, so its left face shows the original right view mirrored, and
 * the other way round.
 */
export function directionalSet(front: ArtRef, has: (key: string) => boolean): { assets: Partial<Record<ObjectSide, ArtRef>>; structure?: Structure } {
  const structure = byTexture.get(front.key);
  if (!structure || !SIDES.every((side) => has(viewKey(front.key, side)))) return { assets: { front } };
  const view = (side: ObjectSide): ArtRef => ({ key: viewKey(front.key, side), frame: 0, flipX: front.flipX ?? false });
  return { structure, assets: { front, back: view('back'), left: view(front.flipX ? 'right' : 'left'), right: view(front.flipX ? 'left' : 'right') } };
}
