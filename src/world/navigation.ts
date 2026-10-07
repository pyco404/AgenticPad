import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ground } from "../../web/lib/world/ground.js";
import { Roads, type Point } from "../../web/lib/world/roads.js";
import { HIDDEN_ROADS, lots, NEW_TOWN_SITES, RESERVED, ROADS, SITES, stands, nearRoad } from "../../web/lib/world/town.js";
import { CROSSROADS, lakeTerrain, onOldGround, WORLD } from "../../web/lib/world/world.js";
import { waterTerrain, byRiver, RIVER_BANKS } from "../../web/lib/world/river.js";
import { GARDEN_PONDS } from "../../web/lib/world/landmarks.js";
import { byLandscape, LANDSCAPE_BOXES, MOUNTAIN_BOXES } from "../../web/lib/world/landscape.js";
import { chunkTrees, chunksIn } from "../../web/lib/world/forest.js";
import { NEW_TOWN, openPlots, PIECE_ART, plotClearing } from "../../web/lib/world/growth.js";
import { neighbourhoodSpots, clearRoute } from "../../web/lib/world/population.js";
import { PIECES, overRoad } from "../../web/lib/world/pieces.js";
import { DISTRICT_PIECES } from "../../web/lib/world/district-pieces.js";
import { referenceArt } from "../../web/lib/world/reference-art.js";
import { hallOf } from "../../web/lib/world/identity.js";

type Bounds = { x: number; y: number; width: number; height: number };
const publicRoot = new URL("../../web/public/", import.meta.url);
function imageSize(path: string): { width: number; height: number } {
  const data = readFileSync(new URL(path.replace(/^\//, ""), publicRoot));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
const byPond = (p: Point) => GARDEN_PONDS.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);

/** Reuse the map's pure geometry and art dimensions, without loading Phaser or browser code. */
export function worldNavigation(population: number) {
  const imported = JSON.parse(readFileSync(fileURLToPath(new URL("village/map.json", publicRoot)), "utf8")) as {
    decorations: { k: string; x: number; y: number; s: number }[]; textures: { key: string; path: string; frameWidth?: number; frameHeight?: number }[];
  };
  const buildings: Bounds[] = Object.values(SITES).filter((s) => !s.blocks).map((s) => {
    const size = s.sheet ? { width: s.sheet.width, height: s.sheet.height } : imageSize(referenceArt(s.art));
    return { x: s.x, y: s.y, width: size.width * s.scale, height: size.height * s.scale };
  });
  const props = PIECES.map((p) => {
    const texture = imported.textures.find((t) => t.key === p.key);
    const size = p.sheet ? { width: p.sheet.frameWidth, height: p.sheet.frameHeight } : texture?.frameWidth ?
      { width: texture.frameWidth, height: texture.frameHeight! } : imageSize(p.image || `/village/${texture!.path}`);
    return { x: p.x, y: p.y, width: size.width * p.scale, height: size.height * p.scale * (p.foot ?? 1) };
  });
  const district = DISTRICT_PIECES.filter((p) => !byRiver(p) && !byPond(p) && !nearRoad(p, 50) &&
    !RESERVED.some((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) &&
    !(p.x < 200 && !SITES.bazaar) && !(p.x > 2600 && !SITES.launchpad)).map((p) => {
      const piece = PIECES.find((q) => q.key === p.key)!;
      const size = imageSize(piece.image);
      return { ...p, width: size.width * p.scale, height: size.height * p.scale };
    });
  const taken = lots([...props, ...district]);
  const plots = openPlots(NEW_TOWN, population);
  const grown = plots.flatMap((plot) => plot.pieces.filter((p) => p.image !== "planter").map((p) => {
    const art = PIECE_ART[p.image];
    return { x: p.x, y: p.y + art.height * p.scale * (1 - art.foot), width: art.width * p.scale, height: art.height * p.scale };
  }));
  const scenic = waterTerrain(), covered = new Set(scenic.map(([c, r]) => `${c},${r}`));
  const ground = new Ground({ world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
    base: "terrain-grass", terrain: [...lakeTerrain().filter(([c, r]) => !covered.has(`${c},${r}`)), ...scenic],
    paths: [], decorations: [], buildings: [], spawn: { x: 1400, y: 1100 }, heroScale: 1, textures: [], animations: [] },
    [...buildings, ...PIECES.filter((p) => p.solid).map((p) => ({ x: p.x, y: p.y, ...p.solid! })), ...district.filter((p) => p.solid), ...grown],
    [...Object.values(SITES).flatMap((s) => s.blocks ?? []), ...GARDEN_PONDS, ...MOUNTAIN_BOXES], RESERVED);
  const cleared = plots.map((p) => plotClearing(p));
  const trees = imported.decorations.filter((d) => d.k.includes("tree") && stands(d, taken) && !overRoad(d, ROADS) && !byPond(d) && !byLandscape(d) && !byRiver(d) &&
    !cleared.some((b) => d.x >= b.x0 && d.x <= b.x1 && d.y >= b.y0 && d.y <= b.y1));
  ground.blockTrunks(trees);
  const fixedLots = [...NEW_TOWN_SITES].flatMap((id) => {
    const s = SITES[id]; return s ? [{ x0: s.x - 160, y0: s.y - 230, x1: s.x + 160, y1: s.y + 90 }] : [];
  });
  const rules = { inOldTown: onOldGround,
    onRoad: (p: Point, s: number) => overRoad({ k: "tree", ...p, s }, ROADS, 10) || CROSSROADS.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 110),
    taken: [...taken, ...fixedLots, ...GARDEN_PONDS, ...LANDSCAPE_BOXES, ...RIVER_BANKS], cleared };
  for (const { cx, cy } of chunksIn(WORLD)) ground.blockTrunks(chunkTrees(cx, cy, rules).filter((t) => t.k.includes("tree")));
  const roads = new Roads([...ROADS.map((p) => p.points.map(([x, y]) => ({ x, y }))), ...HIDDEN_ROADS],
    Object.values(SITES).map((s) => s.door ?? { x: s.x, y: s.y + 5 }));
  const homes = neighbourhoodSpots(plots, (p) => ground.walkable(p) && !RESERVED.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1));
  return { ground, homes,
    home: (id: string, index: number) => homes[index] ?? ground.nearestDry({ x: SITES[hallOf(id)]!.x + (index % 7 - 3) * 24, y: SITES[hallOf(id)]!.y + 90 + Math.floor(index / 7) % 5 * 24 }),
    route: (from: Point, to: Point): Point[] | null => {
      let path = roads.near(from, 110) && roads.near(to, 110) ? roads.route(from, to) : [];
      if (path.length < 2 || !clearRoute(path, (p) => ground.walkable(p))) path = ground.route(from, to);
      const end = path.at(-1);
      return path.length >= 2 && end && Math.hypot(end.x - to.x, end.y - to.y) <= 96 && clearRoute(path, (p) => ground.walkable(p)) ? path : null;
    },
  };
}
