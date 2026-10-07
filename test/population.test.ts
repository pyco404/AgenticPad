import { describe, expect, it } from "vitest";
import { agentPopulation, allocateHomes, clearRoute, neighbourhoodSpots } from "../web/app/village/game/population.js";
import { NEW_TOWN, openPlots, plotClearing } from "../web/app/village/game/growth.js";
import { Ground } from "../web/app/village/game/ground.js";
import { lakeTerrain, WORLD } from "../web/app/village/game/world.js";
import { GARDEN_PONDS } from "../web/app/village/game/landmarks.js";
import { MOUNTAIN_BOXES, oceanTerrain } from "../web/app/village/game/landscape.js";
import { riverTerrain } from "../web/app/village/game/river.js";
import { RESERVED } from "../web/app/village/game/town.js";
import { groundDepth } from "../web/app/village/game/depth.js";

describe("population-driven field neighbourhoods", () => {
  it("counts each real token agent, including one wallet's separate agents, without house residents or replays", () => {
    const residents = [
      { id: "wallet-token-a", house: false, place: "tavern" },
      { id: "wallet-token-b", house: false, place: "duel" },
      { id: "wallet-token-a", house: false, place: "tavern" },
      { id: "retired", house: false, place: "gate" },
      { id: "house", house: true, place: "forge" },
      { id: "replay", house: false, place: "arena", standIn: "wallet-token-a" },
    ];
    expect(agentPopulation(residents)).toBe(2);
    expect(agentPopulation(residents.filter((r) => r.house))).toBe(0);
    expect(openPlots(NEW_TOWN, agentPopulation(residents))).toHaveLength(2);
  });

  it("offers 1,000 separate residential spots on dry ground outside new buildings", () => {
    const plots = openPlots(NEW_TOWN, 1000);
    const ground = new Ground({
      world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
      base: "terrain-grass", terrain: [...lakeTerrain(), ...oceanTerrain(), ...riverTerrain()],
      paths: [], decorations: [], buildings: [], spawn: { x: 1400, y: 1010 }, heroScale: 1, textures: [], animations: [],
    }, [], [...GARDEN_PONDS, ...MOUNTAIN_BOXES, ...plots.map((p) => plotClearing(p, 0)), ...RESERVED]);
    const spots = neighbourhoodSpots(plots, (p) => ground.walkable(p));
    const ids = Array.from({ length: 1000 }, (_, i) => `agent-${i}`);
    const homes = allocateHomes(ids, spots, new Map());
    expect(homes.size).toBe(1000);
    expect(new Set([...homes.values()].map((p) => `${p.x},${p.y}`)).size).toBe(1000);
    for (const p of homes.values()) {
      expect(ground.walkable(p)).toBe(true);
      expect(ground.inWater(p)).toBe(false);
    }
    const xs = [...homes.values()].map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2000);
    const more = allocateHomes([...ids.slice().reverse(), "new-agent"], spots, homes);
    for (const id of ids) expect(more.get(id)).toEqual(homes.get(id));
    const fewer = allocateHomes(ids.slice(1), spots, more);
    expect(fewer.has(ids[0]!)).toBe(false);
    for (const id of ids.slice(1)) expect(fewer.get(id)).toEqual(homes.get(id));
  });

  it("rejects a street route across water or a new building even when its endpoints are dry", () => {
    const path = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    expect(clearRoute(path, () => true)).toBe(true);
    expect(clearRoute(path, (p) => p.x < 80 || p.x > 120)).toBe(false);
  });

  it("keeps grass, roads and water effects below characters at the world's northern edge", () => {
    const layers = [-1000, -800, -790, -780, -720, -710, -700, -690, -410, -401, -400, -399, -398, -397, -390];
    for (const layer of layers) expect(groundDepth(layer)).toBeLessThan(WORLD.y0 - 200);
    expect(layers.map(groundDepth)).toEqual([...layers.map(groundDepth)].sort((a, b) => a - b));
  });
});
