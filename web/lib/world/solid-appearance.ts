import type { WorldObject } from './model';
import { physicalKind } from './object-appearance';
import { TREE_KINDS, type SolidKind } from './solid-models';

/** One replacement policy for captured scenery, map objects and growth plots. */
export const SOLID_FAMILIES: Readonly<Record<string, { kind: SolidKind; width: number; landmark?: boolean }>> = {
  'dress-house-yellow': { kind: 'cottage', width: 70.4 }, 'dress-house-blue': { kind: 'cottage', width: 70.4 },
  'dress-house-red': { kind: 'redCottage', width: 70.4 }, 'dress-house-purple': { kind: 'townhouse', width: 70.4 },
  'village-smithy': { kind: 'workshop', width: 102.4 },
  'market-blue': { kind: 'stall', width: 128 }, 'market-red': { kind: 'redStall', width: 128 },
  'growth-house-a': { kind: 'cottage', width: 70.4 }, 'growth-house-b': { kind: 'redCottage', width: 70.4 },
  'growth-apartments': { kind: 'townhouse', width: 70.4 }, 'growth-office': { kind: 'workshop', width: 102.4 },
  'growth-shop': { kind: 'stall', width: 128 }, 'growth-kiosk': { kind: 'redStall', width: 128 },
  'growth-House_Blue': { kind: 'cottage', width: 70.4 }, 'growth-House_Yellow': { kind: 'cottage', width: 70.4 },
  'growth-House_Red': { kind: 'redCottage', width: 70.4 }, 'growth-House_Purple': { kind: 'townhouse', width: 70.4 },
  'building-tavern': { kind: 'cottage', width: 70.4 }, 'building-castle': { kind: 'cottage', width: 70.4 },
  'building-alchemist': { kind: 'cottage', width: 70.4 },
  'building-forge': { kind: 'redCottage', width: 70.4 }, 'building-chapel': { kind: 'hall', width: 124 },
  'building-watchtower': { kind: 'tower', width: 102.4 }, 'building-bazaar': { kind: 'bazaar', width: 260 },
  'ac-tent': { kind: 'tent', width: 80 },
  'ac-hiring-board': { kind: 'hiringBoard', width: 132 }, 'ac-strategy-board': { kind: 'strategyBoard', width: 132 },
  'ac-scoreboard': { kind: 'scoreBoard', width: 132 },
  'deco-16': { kind: 'waypost', width: 60 }, 'deco-17': { kind: 'waypost', width: 60 },
  'deco-02': { kind: 'mushroom', width: 32 }, 'deco-03': { kind: 'mushroom', width: 32 },
  'building-library': { kind: 'hall', width: 0, landmark: true }, 'building-board': { kind: 'board', width: 0, landmark: true },
};

export function appearanceSeed(id: string): number {
  let seed = 2166136261;
  for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function applySolidAppearance(o: WorldObject, enabled = true): WorldObject {
  if (!enabled || o.solid || o.type === 'arena' || o.metadata?.flat) return o;
  const kind = physicalKind(o), art = o.metadata?.art;
  const key = art?.key ?? o.metadata?.texture ?? '';
  if (kind === 'tree' || kind === 'shrub') {
    o.solid = kind === 'tree' ? TREE_KINDS[appearanceSeed(o.id) % TREE_KINDS.length]! : 'shrub';
    return o;
  }
  if (kind === 'mountain') {
    o.solid = 'mountain'; o.solidVariant = { size: o.width / 280, mirror: false, tone: 0, plants: 0 };
    return o;
  }
  let family = SOLID_FAMILIES[key];
  // Retire remaining stock house/hut/mine fronts as well as future house keys. No complete
  // building picture is ever pasted on these meshes; only material/decorative crops are used.
  if (!family && /gold.?mine|hut|shed/i.test(key)) family = { kind: 'shed', width: 70 };
  if (!family && kind === 'tower') family = { kind: 'tower', width: 102.4 };
  if (!family && (kind === 'house' || kind === 'major-building')) family = { kind: 'cottage', width: 70.4 };
  if (!family && (kind === 'shop' || kind === 'market')) family = { kind: 'stall', width: 128 };
  if (!family && kind === 'tent') family = { kind: 'tent', width: 80 };
  if (!family) return o;
  const foot = o.metadata?.topAnchor ?? o;
  // Retain the established variants of already working buildings.
  const seed = Math.abs(Math.round(foot.x) * 73856093 ^ Math.round(foot.y) * 19349663) >>> 0;
  o.solid = family.kind;
  o.solidVariant = { size: family.landmark ? 1 : o.width / family.width,
    mirror: art?.flipX ? true : !family.landmark && (seed & 1) === 1,
    tone: family.landmark ? 0 : ((seed >> 1) & 1) as 0 | 1,
    plants: family.landmark ? 0 : ((seed >> 2) & 1) as 0 | 1 };
  return o;
}
