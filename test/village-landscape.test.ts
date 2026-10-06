import { describe, expect, it } from "vitest";
import { MOUNTAINS, MOUNTAIN_BOXES, OCEAN, oceanTerrain, roughWavePosition, seaAnimalPosition } from "../web/app/village/game/landscape.js";
import { CENTRE, lakeTerrain, OUTER, SPOKES, WORLD } from "../web/app/village/game/world.js";
import { Ground } from "../web/app/village/game/ground.js";
import type { VillageMap } from "../web/app/village/game/map.js";
import { nearRoad } from "../web/app/village/game/town.js";

describe("village ocean and mountains", () => {
  const terrain = oceanTerrain();
  const land = new Set(terrain.filter(([, , texture]) => texture !== "terrain-water").map(([c, r]) => `${c},${r}`));
  const wet = new Set(terrain.filter(([c, r, texture]) => texture === "terrain-water" && !land.has(`${c},${r}`)).map(([c, r]) => `${c},${r}`));

  it("can route agents to dry destinations at all four far corners without crossing water or mountains", () => {
    const map: VillageMap = {
      world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
      base: "terrain-grass", terrain: [...lakeTerrain(), ...terrain], paths: [], decorations: [], buildings: [],
      spawn: CENTRE, heroScale: 1, textures: [], animations: [],
    };
    const ground = new Ground(map, [], MOUNTAIN_BOXES);
    for (const x of [WORLD.x0 + 192, WORLD.x1 - 192]) for (const y of [WORLD.y0 + 192, WORLD.y1 - 192]) {
      const goal = ground.anywhere.reduce((best, p) => Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best);
      expect(Math.abs(goal.x - OUTER.cx)).toBeGreaterThan(OUTER.hw + 800);
      const route = ground.route(CENTRE, goal);
      expect(route.at(-1)).toEqual(goal);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1]!, b = route[i]!;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16);
        for (let step = 0; step <= steps; step++) expect(ground.walkable({ x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps })).toBe(true);
      }
    }
  });

  it("places the western ocean within the world and clear of existing roads", () => {
    expect(OCEAN.x).toBeLessThan(0);
    expect(wet.size).toBeGreaterThan(100);
    for (const key of wet) {
      const [c, r] = key.split(",").map(Number);
      const p = { x: c! * 64 + 32, y: r! * 64 + 32 };
      expect(p.x).toBeGreaterThan(WORLD.x0);
      expect(p.x).toBeLessThan(WORLD.x1);
      expect(p.y).toBeGreaterThan(WORLD.y0);
      expect(p.y).toBeLessThan(WORLD.y1);
      expect(nearRoad(p, 40)).toBe(false);
    }
  });
  it("keeps all animal paths over navigational water throughout their cycles", () => {
    for (let i = 0; i < 9; i++) for (let seconds = 0; seconds < 500; seconds += 0.7) {
      const p = seaAnimalPosition(i, seconds);
      expect(wet.has(`${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`)).toBe(true);
      expect(Number.isFinite(p.heading)).toBe(true);
    }
  });
  it("keeps mountain footprints within the world and away from roads", () => {
    const junction = SPOKES.find((s) => s.id === "north-west")!.outer;
    for (const mountain of MOUNTAINS) {
      expect(mountain.x).toBeLessThan(junction.x);
      expect(mountain.y).toBeGreaterThan(junction.y);
    }
    for (const b of MOUNTAIN_BOXES) {
      expect(b.x0).toBeGreaterThan(WORLD.x0);
      expect(b.x1).toBeLessThan(WORLD.x1);
      expect(b.y0).toBeGreaterThan(WORLD.y0);
      expect(b.y1).toBeLessThan(WORLD.y1);
      for (let x = b.x0; x <= b.x1; x += 32) for (let y = b.y0; y <= b.y1; y += 32) expect(nearRoad({ x, y }, 30)).toBe(false);
    }
  });
  it("keeps fast flowing currents inside water and changes their position over time", () => {
    expect(roughWavePosition(3, 1).x).not.toBe(roughWavePosition(3, 0).x);
    for (let i = 0; i < 96; i++) for (let seconds = 0; seconds < 200; seconds += 3.1) {
      const p = roughWavePosition(i, seconds);
      expect(wet.has(`${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`)).toBe(true);
    }
  });
});
