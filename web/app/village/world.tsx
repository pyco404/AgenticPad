"use client";

import { createContext, useContext } from "react";
import { isPlaying, type Arrival, type Counters } from "@/lib/live";
import { PLACES, type PlaceInfo } from "./places";
import { BAND_HALL, type Resident } from "./residents";

/**
 * Everything the HUD reads about the world, worked out once in the frame:
 * who is where, the matches the live stream has brought, and whether it is
 * connected. Read with useWorld.
 */
export type World = {
  residents: Resident[] | null;
  /** Newest first: the recent matches the stream has brought this page. */
  arrivals: Arrival[];
  playMs: number;
  now: number;
  counters: Counters | null;
  online: boolean | null;
};

const Context = createContext<World>({ residents: null, arrivals: [], playMs: 0, now: 0, counters: null, online: null });
export const WorldProvider = Context.Provider;
export const useWorld = () => useContext(Context);

export type Tally = { active: number; idle: number; done: number; total: number };

/** Matches in the stream's recent window that have finished playing out. */
export const finished = (w: World) => w.arrivals.filter((a) => !isPlaying(a, w.playMs, w.now));

/** The whole village: in the arena, waiting, recent matches finished, everyone on the field. */
export function worldTally(w: World): Tally | null {
  if (!w.residents) return null;
  const here = w.residents.filter((r) => r.place !== "gate");
  const active = here.filter((r) => r.place === "arena").length;
  return { active, idle: here.length - active, done: finished(w).length, total: here.length };
}

/** Whether an agent belongs to a building: everyone for the arena, a band for its hall. */
function belongs(place: PlaceInfo, band: string | undefined): boolean {
  return place.holds === "arena" || (place.holds !== null && place.holds === band);
}

/** One building's own numbers, for those agents live at: null for the ones that are only a way to a page. */
export function placeTally(w: World, place: PlaceInfo): Tally | null {
  if (!w.residents || !place.holds) return null;
  const bandOf = new Map(w.residents.map((r) => [r.id, r.band]));
  const mine = w.residents.filter((r) => r.place !== "gate" && belongs(place, r.band));
  const active = mine.filter((r) => r.place === "arena").length;
  const idle = place.holds === "arena" ? 0 : mine.filter((r) => r.place === BAND_HALL[r.band]).length;
  const done = finished(w).filter((a) => belongs(place, bandOf.get(a.match.a.id)) || belongs(place, bandOf.get(a.match.b.id))).length;
  return { active, idle, done, total: place.holds === "arena" ? active : mine.length };
}

/** The recent finished matches a building's agents played. */
export function placeActivity(w: World, place: PlaceInfo, limit = 4): Arrival[] {
  const bandOf = new Map((w.residents ?? []).map((r) => [r.id, r.band]));
  return finished(w)
    .filter((a) => !place.holds || belongs(place, bandOf.get(a.match.a.id)) || belongs(place, bandOf.get(a.match.b.id)))
    .slice(0, place.holds ? limit : 0);
}

/**
 * The line under a building's name, on the map and in the list: how many are
 * there for the buildings agents live at, where it leads for the rest.
 */
export function placeLine(w: World, place: PlaceInfo): { text: string; lively: boolean } {
  const t = placeTally(w, place);
  if (place.holds === "arena") {
    const matches = new Set((w.residents ?? []).filter((r) => r.place === "arena").map((r) => r.match?.id)).size;
    return { text: t ? `${matches} live` : "live matches", lively: matches > 0 };
  }
  if (t) return { text: `${t.idle} waiting`, lively: t.idle > 0 };
  // The Treasury shows the money: every chip staked in a real match, from the live stream's counters.
  if (place.id === "chapel" && w.counters) {
    return { text: `${w.counters.totalStaked.toLocaleString("en-US")} chips staked`, lively: w.counters.totalStaked > 0 };
  }
  if (place.id === "watchtower") {
    const all = worldTally(w);
    return { text: all ? `${all.total} on the field` : place.note, lively: false };
  }
  return { text: place.note, lively: false };
}

export const placeLines = (w: World) => Object.fromEntries(PLACES.map((p) => [p.id, placeLine(w, p).text]));
