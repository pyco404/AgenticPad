import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Imports the village for /village from an Agent Quest checkout
 * (https://github.com/FulAppiOS/Agent-Quest, MIT): its shipped map, and only
 * the pixel art that map, the heroes and the eight buildings draw. Everything
 * lands in web/public/village; nothing here runs at request time.
 *
 *   npx tsx scripts/village-import.ts <agent-quest-dir> <manifest.json>
 *
 * The manifest is Agent Quest's asset list, which its server builds in code
 * rather than keeping on disk. From the checkout's server/ directory:
 *
 *   echo "import { buildAssetManifest } from './map/asset-manifest';
 *   await Bun.write('../manifest.json', JSON.stringify(buildAssetManifest()));" > src/gen.ts
 *   bun src/gen.ts && rm src/gen.ts
 *
 * The map is baked into the one shape the village loader reads, keeping what
 * Agent Quest actually draws rather than what its map file says. Its trees
 * `tree-1..3` are single frames cut from the tree atlas at boot, so a frame
 * index on one is ignored there; here each becomes the atlas frame it shows.
 * A frame index on a plain image is ignored the same way, and is dropped.
 * Three keys the map names are never loaded by Agent Quest, and are left out.
 */

type Manifest = {
  tilesets: { key: string; path: string; tileWidth: number; tileHeight: number }[];
  decorations: {
    key: string;
    path: string;
    frameWidth?: number;
    frameHeight?: number;
    animations?: { name: string; start: number; end: number; frameRate?: number; repeat?: number }[];
  }[];
};
type Point = { x: number; y: number };
type AqMap = {
  world: { width: number; height: number };
  baseTileset: string;
  terrain: Record<string, { tile: { set: string; frame: number } }>;
  decorations: { textureKey: string; frame?: number; x: number; y: number; scale: number; depth?: number; animated?: boolean; animation?: string }[];
  paths: { points: Point[]; width: number; style: string }[];
  buildings: { id: string; x: number; y: number }[];
  spawn?: Point;
  settings: { heroScale: number };
};

const [aqArg, manifestArg] = process.argv.slice(2);
if (!aqArg || !manifestArg) {
  console.error("usage: npx tsx scripts/village-import.ts <agent-quest-dir> <manifest.json>");
  process.exit(1);
}
const aqDir = aqArg;
const manifestPath = manifestArg;

const PACK = "client/public/assets/themes/tiny-swords-cc0";
const OUT = join(import.meta.dirname, "../web/public/village");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const map = JSON.parse(readFileSync(join(aqDir, "server/data/maps/template.json"), "utf8")) as AqMap;

// Pack paths in the manifest are web paths under the theme, some URL-encoded ("Gold%20Mine").
const packPath = (web: string) => decodeURIComponent(web).replace(/^\/assets\/themes\/tiny-swords-cc0\//, "");

type Texture = { key: string; path: string; frameWidth?: number; frameHeight?: number };
const textures = new Map<string, Texture>();
const files = new Map<string, string>(); // published path -> source path
function pack(rel: string): string {
  files.set(`tiny-swords/${rel}`, join(aqDir, PACK, rel));
  return `tiny-swords/${rel}`;
}

// Heroes: the three units in the pack's four colours. Only the name and
// frame layout matter here; the scene knows which rows are idle and run.
const HERO_UNITS = ["Warrior", "Archer", "Pawn"];
const HERO_COLOURS = ["Blue", "Yellow", "Red", "Purple"];
for (const unit of HERO_UNITS) {
  for (const colour of HERO_COLOURS) {
    // The pack's own spelling, kept so an update diffs cleanly.
    const file = unit === "Archer" && colour === "Purple" ? "Archer_Purlple" : `${unit}_${colour}`;
    const path = pack(`Factions/Knights/Troops/${unit}/${colour}/${file}.png`);
    textures.set(`hero-${unit.toLowerCase()}-${colour.toLowerCase()}`, {
      key: `hero-${unit.toLowerCase()}-${colour.toLowerCase()}`,
      path,
      frameWidth: 192,
      frameHeight: 192,
    });
  }
}

// Buildings: Agent Quest's own art, not the pack's, under its MIT licence (buildings/LICENSE.txt).
const BUILDING_FILES: Record<string, string> = {
  castle: "Castle", library: "Library", forge: "Forge", tavern: "Tavern",
  chapel: "Chapel", watchtower: "Tower", arena: "Arena", alchemist: "Alchemist",
};
for (const [id, name] of Object.entries(BUILDING_FILES)) {
  files.set(`buildings/${name}.png`, join(aqDir, PACK, `BuildingsCustom/${name}.png`));
  textures.set(`building-${id}`, { key: `building-${id}`, path: `buildings/${name}.png` });
}

// Tilesets for the ground.
for (const set of new Set([map.baseTileset, ...Object.values(map.terrain).map((c) => c.tile.set)])) {
  const t = manifest.tilesets.find((s) => s.key === set);
  if (!t) throw new Error(`tileset ${set} is not in the manifest`);
  textures.set(set, { key: set, path: pack(packPath(t.path)), frameWidth: t.tileWidth, frameHeight: t.tileHeight });
}

// Decorations, as Agent Quest draws them.
const TREE_ATLAS = "resources-trees-tree";
const NOT_LOADED = new Set(["water-rock-02", "prop-woodresource", "shadow"]);
const animations: { key: string; texture: string; start: number; end: number; frameRate: number; repeat: number }[] = [];
const decorations: { k: string; f?: number; x: number; y: number; s: number; d?: number; a?: string }[] = [];
const round = (n: number) => Math.round(n * 10) / 10;
for (const d of map.decorations) {
  if (NOT_LOADED.has(d.textureKey)) continue;
  const tree = /^tree-(\d)$/.exec(d.textureKey);
  const key = tree ? TREE_ATLAS : d.textureKey;
  const m = manifest.decorations.find((x) => x.key === key);
  if (!m) throw new Error(`decoration ${key} is not in the manifest`);
  const sheet = m.frameWidth !== undefined && m.frameHeight !== undefined;
  if (!textures.has(key)) {
    textures.set(key, { key, path: pack(packPath(m.path)), ...(sheet ? { frameWidth: m.frameWidth, frameHeight: m.frameHeight } : {}) });
    for (const a of m.animations ?? []) {
      animations.push({ key: `${key}:${a.name}`, texture: key, start: a.start, end: a.end, frameRate: a.frameRate ?? 10, repeat: a.repeat ?? -1 });
    }
  }
  const frame = tree ? Number(tree[1]) - 1 : sheet ? d.frame : undefined;
  const anim = d.animated ? `${key}:${d.animation ?? "idle"}` : undefined;
  decorations.push({
    k: key,
    ...(frame !== undefined ? { f: frame } : {}),
    x: round(d.x),
    y: round(d.y),
    s: d.scale,
    ...(d.depth !== undefined ? { d: d.depth } : {}),
    ...(anim && animations.some((a) => a.key === anim) ? { a: anim } : {}),
  });
}

const village = {
  source: "Adapted from Agent Quest's shipped map (template.json), https://github.com/FulAppiOS/Agent-Quest",
  world: map.world,
  base: map.baseTileset,
  // [column, row, tileset, frame]
  terrain: Object.entries(map.terrain).map(([cell, { tile }]) => {
    const [col, row] = cell.split(",").map(Number);
    return [col, row, tile.set, tile.frame];
  }),
  paths: map.paths.map((p) => ({ style: p.style, width: p.width, points: p.points.map((q) => [round(q.x), round(q.y)]) })),
  decorations,
  buildings: map.buildings.map((b) => ({ id: b.id, x: round(b.x), y: round(b.y) })),
  spawn: map.spawn ? { x: round(map.spawn.x), y: round(map.spawn.y) } : { x: 1400, y: 1130 },
  heroScale: map.settings.heroScale,
  textures: [...textures.values()],
  animations,
};

rmSync(OUT, { recursive: true, force: true });
for (const [to, from] of files) {
  mkdirSync(dirname(join(OUT, to)), { recursive: true });
  copyFileSync(from, join(OUT, to));
}
copyFileSync(join(aqDir, PACK, "LICENSE.txt"), join(OUT, "tiny-swords/LICENSE.txt"));
copyFileSync(join(aqDir, "LICENSE"), join(OUT, "buildings/LICENSE.txt"));
writeFileSync(join(OUT, "map.json"), JSON.stringify(village));
console.log(`${files.size} images, ${textures.size} textures, ${decorations.length} decorations -> ${OUT}`);
