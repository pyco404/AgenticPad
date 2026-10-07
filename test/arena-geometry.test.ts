import { describe, expect, it } from "vitest";
import { ARENA_BLOCKS, ARENA_ENTRANCES, COLOSSEUM, COLOSSEUM_FLOOR, arenaSolid, insideOval } from "../web/app/village/game/arena-geometry.js";
import { Ground } from "../web/app/village/game/ground.js";
import { HIDDEN_ROADS, ROADS, SITES } from "../web/app/village/game/town.js";
import { clearRoute } from "../web/app/village/game/population.js";
import { Roads } from "../web/app/village/game/roads.js";
import type { VillageMap } from "../web/app/village/game/map.js";

const map: VillageMap = { world: { width: 4096, height: 3072 }, base: "grass", terrain: [], paths: [], decorations: [], buildings: [], spawn: { x: 1400, y: 1010 }, heroScale: 1, textures: [], animations: [] };
const ground = () => new Ground(map, [], ARENA_BLOCKS);

describe("oval colosseum", () => {
  it("is visibly oval with a separate oval floor and open exterior corners", () => {
    expect(COLOSSEUM.rx / COLOSSEUM.ry).toBeGreaterThan(1.7);
    expect(COLOSSEUM_FLOOR.rx / COLOSSEUM_FLOOR.ry).toBeGreaterThan(1.7);
    expect(insideOval(COLOSSEUM_FLOOR, COLOSSEUM)).toBe(true);
    const g = ground();
    // These were in the rectangular stadium's corners; they are now exterior ground.
    for (const p of [{ x: 1056, y: 608 }, { x: 1760, y: 608 }, { x: 1056, y: 960 }, { x: 1760, y: 960 }]) expect(g.walkable(p)).toBe(true);
    for (const p of [{ x: 1400, y: 600 }, { x: 1050, y: 775 }, { x: 1700, y: 880 }]) {
      expect(arenaSolid(p)).toBe(true);
      expect(g.walkable(p)).toBe(false);
    }
  });
  it("routes both entrances onto the sand and back without crossing seats", () => {
    const g = ground();
    for (const entrance of Object.values(ARENA_ENTRANCES)) {
      expect(g.walkable(entrance)).toBe(true);
      for (const goal of [COLOSSEUM_FLOOR, { x: 1364, y: 800 }, { x: 1436, y: 800 }]) {
        const route = g.route(entrance, goal);
        expect(route.at(-1)).toEqual(goal);
        expect(clearRoute(route, (p) => g.walkable(p))).toBe(true);
        expect(clearRoute(g.route(goal, entrance), (p) => g.walkable(p))).toBe(true);
      }
    }
  });
  it("keeps hidden entrance waypoints walkable and connects the new side approach", () => {
    const g = ground();
    for (const path of HIDDEN_ROADS) expect(clearRoute(path, (p) => g.walkable(p)), JSON.stringify(path)).toBe(true);
    const graph = new Roads([...ROADS.map((r) => r.points.map(([x, y]) => ({ x, y }))), ...HIDDEN_ROADS], [SITES.arena!.door!]);
    for (const source of [{ x: 1990, y: 750 }, { x: 1190, y: 1060 }]) {
      const route = graph.route(source, COLOSSEUM_FLOOR);
      expect(route.at(-1)).toEqual({ x: COLOSSEUM_FLOOR.x, y: COLOSSEUM_FLOOR.y });
      expect(clearRoute(route, (p) => g.walkable(p))).toBe(true);
    }
    // A walker going around the outside cannot take a shortcut through the bowl.
    expect(clearRoute(g.route({ x: 980, y: 775 }, { x: 1840, y: 900 }), (p) => g.walkable(p))).toBe(true);
  });
});
