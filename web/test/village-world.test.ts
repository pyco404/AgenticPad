import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/live", () => ({ isPlaying: () => false }));
vi.mock("../app/village/places", () => ({ PLACES: [] }));

import { worldTally, type World } from "../app/village/world";
import type { Resident } from "../app/village/residents";

const resident = (id: string, house: boolean, place: Resident["place"], standIn?: string): Resident => ({
  id, name: id, house, place, standIn, presetName: "Anchor", hall: "tavern",
  match: null, look: { unit: "warrior", colour: "blue" },
});
const world = (residents: World["residents"]): World => ({
  residents, arrivals: [], playMs: 1000, now: 2000, counters: null, online: true,
});

describe("village player counts", () => {
  it("separates house agents and excludes replay stand-ins and leaving agents", () => {
    const w = world([
      resident("player-active", false, "duel"), resident("player-idle", false, "tavern"),
      resident("house-active", true, "arena"), resident("house-idle", true, "tavern"),
      resident("replay", false, "arena", "player-active"), resident("leaving", false, "gate"),
    ]);
    w.arrivals = [false, true, true].map((exhibition, i) => ({
      match: { id: `match-${i}`, exhibition }, startedAt: 0,
    })) as World["arrivals"];
    expect(worldTally(w)).toEqual({ active: 1, idle: 1, total: 2, house: 2, done: 1 });
  });
  it("shows zero players when only house agents are present", () => {
    expect(worldTally(world([resident("house", true, "arena")]))).toEqual({ active: 0, idle: 0, total: 0, house: 1, done: 0 });
  });
  it("leaves counts unavailable until residents load", () => {
    expect(worldTally(world(null))).toBeNull();
  });
});
