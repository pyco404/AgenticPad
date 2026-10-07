import { describe, expect, it } from "vitest";
import { AGENT_ZOOM, DISTRICT_ZOOM, FLOOR_RATIO, followAmount, framedCentre, viewMode } from "../web/app/village/game/presentation.js";
import { Ground } from "../web/app/village/game/ground.js";
import { clearRoute } from "../web/app/village/game/population.js";
import type { VillageMap } from "../web/app/village/game/map.js";

const map = (terrain: VillageMap["terrain"] = []): VillageMap => ({
  world: { width: 512, height: 512 }, base: "grass", terrain, paths: [], decorations: [], buildings: [], spawn: { x: 32, y: 32 }, heroScale: 1, textures: [], animations: [],
});

describe("world presentation", () => {
  it("centres an agent in the uncovered canvas with foreshortening and physical-pixel zoom", () => {
    // 1440x1000 CSS pixels at DPR 2; right page panel 480, navbar 56, bottom 100.
    const zoom = AGENT_ZOOM * 2;
    const agent = { x: 1670, y: -500 };
    const centre = framedCentre(agent, 480, 44, zoom);
    const screen = { x: 1440 + (agent.x - centre.x) * zoom, y: 1000 + (agent.y - centre.y) * zoom * FLOOR_RATIO };
    expect(screen.x).toBeCloseTo(960); // centre of the 1920 physical pixels left uncovered
    expect(screen.y).toBeCloseTo(956);
    expect(DISTRICT_ZOOM).toBeLessThan(AGENT_ZOOM);
  });
  it("damps follow movement consistently at different frame rates and honours reduced motion", () => {
    const at60 = followAmount(1000 / 60, false);
    const at30 = followAmount(1000 / 30, false);
    expect(1 - (1 - at60) ** 2).toBeCloseTo(at30);
    expect(followAmount(16, true)).toBe(1);
    expect(followAmount(0, false)).toBe(0);
    expect(followAmount(30_000, false)).toBeLessThan(1);
    expect(viewMode(0.4, false)).toBe("world");
    expect(viewMode(DISTRICT_ZOOM, false)).toBe("district");
    expect(viewMode(AGENT_ZOOM, false)).toBe("agent");
    expect(viewMode(0.5, true)).toBe("agent");
  });
});

describe("safe autonomous navigation", () => {
  it("stays on its own bank if no bridge connects two dry destinations", () => {
    const terrain = Array.from({ length: 8 }, (_, row) => [3, row, "terrain-water", 0] as VillageMap["terrain"][number]);
    const ground = new Ground(map(terrain), []);
    expect(ground.route({ x: 96, y: 160 }, { x: 352, y: 160 })).toEqual([{ x: 96, y: 160 }]);
  });
  it("crosses the dry bridge and never walks through adjacent water", () => {
    const terrain = Array.from({ length: 8 }, (_, row) => [3, row, "terrain-water", 0] as VillageMap["terrain"][number]);
    terrain.push([3, 5, "terrain-color1", 11]);
    const ground = new Ground(map(terrain), []);
    const route = ground.route({ x: 96, y: 160 }, { x: 352, y: 160 });
    expect(route.at(-1)).toEqual({ x: 352, y: 160 });
    expect(route.some((p) => p.y >= 320)).toBe(true);
    expect(clearRoute(route, (p) => ground.walkable(p))).toBe(true);
  });
  it("routes around trunks and selects a dry endpoint when a destination becomes blocked", () => {
    const ground = new Ground(map(), []);
    ground.blockTrunks([{ x: 224, y: 224 }]);
    const route = ground.route({ x: 96, y: 224 }, { x: 416, y: 224 });
    expect(clearRoute(route, (p) => ground.walkable(p))).toBe(true);
    expect(route.length).toBeGreaterThan(2);
    const blocked = ground.route({ x: 96, y: 224 }, { x: 224, y: 224 });
    expect(ground.walkable(blocked.at(-1)!)).toBe(true);
    expect(blocked.at(-1)).not.toEqual({ x: 224, y: 224 });
  });
});
