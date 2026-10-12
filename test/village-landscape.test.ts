import { describe, expect, it } from "vitest";
import { MOUNTAINS, MOUNTAIN_BOXES, OCEAN, ROUGH_SEA, oceanTerrain, roughWavePosition, SEA_ANIMALS, seaAnimalPosition } from "../web/app/village/game/landscape.js";
import { CENTRE, lakeTerrain, OUTER, SPOKES, WORLD } from "../web/app/village/game/world.js";
import { Ground } from "../web/app/village/game/ground.js";
import type { VillageMap } from "../web/app/village/game/map.js";
import { nearRoad } from "../web/app/village/game/town.js";
import { RIVER_BANKS, RIVER_BRIDGES, RIVER_SHORES, riverTerrain, waterTerrain } from "../web/app/village/game/river.js";
import { NEW_TOWN, plotClearing, overlaps } from "../web/app/village/game/growth.js";

it("keeps the river wet, crosses on dry bridges, and keeps future housing off its banks", () => {
  const ground = new Ground({
    world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
    base: "terrain-color1", terrain: riverTerrain(), paths: [], decorations: [], buildings: [],
    spawn: CENTRE, heroScale: 1, textures: [], animations: [],
  }, []);
  expect(ground.water.length).toBeGreaterThan(100);
  expect(RIVER_BRIDGES.length).toBeGreaterThan(0);
  for (const bridge of RIVER_BRIDGES) {
    expect(ground.inWater(bridge)).toBe(false);
    expect(ground.walkable(bridge)).toBe(true);
  }
  const goal = ground.nearestDry({ x: 2850, y: 1150 });
  const route = ground.route({ x: 2000, y: 1150 }, goal);
  expect(route.at(-1)).toEqual(goal);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16);
    for (let step = 0; step <= steps; step++) expect(ground.walkable({
      x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps,
    })).toBe(true);
  }
  for (const plot of NEW_TOWN.plots) expect(RIVER_BANKS.some((bank) => overlaps(plotClearing(plot, 0), bank))).toBe(false);
});

it("connects the upper lake to the river with continuous water and no grass bank through the mouth", () => {
  const terrain = waterTerrain();
  const ground = new Ground({
    world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
    base: "terrain-color1", terrain, paths: [], decorations: [], buildings: [],
    spawn: CENTRE, heroScale: 1, textures: [], animations: [],
  }, []);
  const start = { x: Math.floor(ROUGH_SEA.x / 64) * 64 + 32, y: Math.floor(ROUGH_SEA.y / 64) * 64 + 32 };
  const goal = { x: 2400, y: start.y };
  const wet = new Set(ground.water.map((p) => `${p.x},${p.y}`));
  const reached = new Set([`${start.x},${start.y}`]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[64, 0], [-64, 0], [0, 64], [0, -64]]) {
    const p = { x: queue[i]!.x + dx!, y: queue[i]!.y + dy! }, key = `${p.x},${p.y}`;
    if (wet.has(key) && !reached.has(key)) { reached.add(key); queue.push(p); }
  }
  expect(reached.has(`${goal.x},${goal.y}`)).toBe(true);
  for (let x = 1952; x <= 2400; x += 64) expect(ground.inWater({ x, y: start.y })).toBe(true);
  expect(RIVER_SHORES.some((p) => p.x > 2000 && p.x < 2350 && Math.abs(p.y - start.y) < 40)).toBe(false);
  // No legacy shoreline land overlay may silently make a connected-looking water tile walkable.
  expect(ground.walkable({ x: 2208, y: start.y })).toBe(false);
});

describe("village ocean and mountains", () => {
  const terrain = oceanTerrain();
  const land = new Set(terrain.filter(([, , texture]) => texture !== "terrain-water").map(([c, r]) => `${c},${r}`));
  const wet = new Set(terrain.filter(([c, r, texture]) => texture === "terrain-water" && !land.has(`${c},${r}`)).map(([c, r]) => `${c},${r}`));

  it("can route agents to dry destinations at all four far corners without crossing water or mountains", () => {
    const map: VillageMap = {
      world: { x0: WORLD.x0, y0: WORLD.y0, width: WORLD.x1 - WORLD.x0, height: WORLD.y1 - WORLD.y0 },
      base: "terrain-grass", terrain: [...lakeTerrain(), ...waterTerrain()], paths: [], decorations: [], buildings: [],
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
    for (let i = 0; i < SEA_ANIMALS; i++) for (let seconds = 0; seconds < 500; seconds += 0.7) {
      const p = seaAnimalPosition(i, seconds);
      expect(wet.has(`${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`)).toBe(true);
      expect(Number.isFinite(p.heading)).toBe(true);
    }
  });
  it("keeps every animal swimming forward, turning smoothly, at its own changing pace", () => {
    for (let i = 0; i < SEA_ANIMALS; i++) {
      const speeds: number[] = [];
      for (let seconds = 0; seconds < 200; seconds += 0.2) {
        const a = seaAnimalPosition(i, seconds), b = seaAnimalPosition(i, seconds + 0.1);
        const speed = Math.hypot(b.x - a.x, b.y - a.y) / 0.1;
        speeds.push(speed);
        expect(speed).toBeGreaterThan(0.5);
        // Head first: it faces the way it moves, and never spins round between frames.
        const moving = Math.atan2(b.y - a.y, b.x - a.x), facing = Math.abs(Math.atan2(Math.sin(moving - a.heading), Math.cos(moving - a.heading)));
        expect(facing).toBeLessThan(0.5);
        expect(Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)))).toBeLessThan(0.25);
        expect(a.submerged).toBeGreaterThanOrEqual(0); expect(a.submerged).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...speeds) / Math.min(...speeds)).toBeGreaterThan(1.5);
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
