"use client";

import { createContext, useContext } from "react";
import { isPlaying, type Arrival, type Counters } from "@/lib/live";
import { PLACES, type PlaceInfo } from "./places";
import { inMatch, type Resident } from "./residents";

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
  /** What the Arena shows, as its sign says it (arena.ts), and whether that is live. */
  arena?: { line: string; live: boolean };
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
  // A replay's stand-ins are not agents on the field.
  const here = w.residents.filter((r) => r.place !== "gate" && !r.standIn);
  // Every match counts, in the Arena or out in the village, drawn in full or only as a marker.
  const active = here.filter((r) => inMatch(r.place)).length;
  return { active, idle: here.length - active, done: finished(w).length, total: here.length };
}

/** Whether an agent belongs to a building: everyone for the arena, and its own hall. */
function belongs(place: PlaceInfo, hall: string | undefined): boolean {
  return place.holds === "arena" || (place.holds === "hall" && place.id === hall);
}

/** One building's own numbers, for those agents live at: null for the ones that are only a way to a page. */
export function placeTally(w: World, place: PlaceInfo): Tally | null {
  if (!w.residents || !place.holds) return null;
  const hallOf = new Map(w.residents.map((r) => [r.id, r.hall]));
  const mine = w.residents.filter((r) => r.place !== "gate" && !r.standIn && belongs(place, r.hall));
  const active = mine.filter((r) => r.place === "arena").length;
  const idle = place.holds === "arena" ? 0 : mine.filter((r) => r.place === r.hall).length;
  const done = finished(w).filter((a) => belongs(place, hallOf.get(a.match.a.id)) || belongs(place, hallOf.get(a.match.b.id))).length;
  return { active, idle, done, total: place.holds === "arena" ? active : mine.length };
}

/** The recent finished matches a building's agents played. */
export function placeActivity(w: World, place: PlaceInfo, limit = 4): Arrival[] {
  const hallOf = new Map((w.residents ?? []).map((r) => [r.id, r.hall]));
  return finished(w)
    .filter((a) => !place.holds || belongs(place, hallOf.get(a.match.a.id)) || belongs(place, hallOf.get(a.match.b.id)))
    .slice(0, place.holds ? limit : 0);
}

/**
 * The line under a building's name, on the map and in the list. One rule for
 * every building: what it is, always; then, for the few with a live count,
 * the count after it, only when it is above zero - "live matches · 3 live".
 * No hall counts who waits there: agents are drawn walking the paths, not
 * standing at their halls, so a count there would contradict the picture.
 */
export function placeLine(w: World, place: PlaceInfo): { text: string; lively: boolean } {
  // The Arena always says what is on: "live: A vs B", "replay: A vs B", or that nothing has been played.
  if (place.holds === "arena" && w.arena) return { text: w.arena.line, lively: w.arena.live };
  const count = liveCount(w, place);
  return count ? { text: `${place.note} · ${count}`, lively: true } : { text: place.note, lively: false };
}

/** A building's live count, as words, or null when it has none or it is zero. */
function liveCount(w: World, place: PlaceInfo): string | null {
  const n = (v: number, one: string, many: string) => (v > 0 ? `${v.toLocaleString("en-US")} ${v === 1 ? one : many}` : null);
  if (place.holds === "arena") {
    const matches = new Set((w.residents ?? []).filter((r) => r.place === "arena").map((r) => r.match?.id)).size;
    return n(matches, "live", "live");
  }
  // The Hiring Hall counts the holders: the wallets with an agent, which is what getting one there makes you.
  if (place.id === "tavern") return n(w.counters?.holders ?? 0, "holder", "holders");
  if (place.id === "watchtower") return n(worldTally(w)?.total ?? 0, "agent", "agents");
  return null;
}

export const placeLines = (w: World) => Object.fromEntries(PLACES.map((p) => [p.id, placeLine(w, p).text]));
