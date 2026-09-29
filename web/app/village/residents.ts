/**
 * Where every agent on the field stands in the village, and what it looks
 * like there. Pure: the page feeds it the field and the matches playing out,
 * and the scene draws the result. It reads results and never makes one, so
 * nothing here can reach a match, a pairing or a balance.
 *
 * Kept free of the web app's path aliases so the root suite can test it; the
 * shapes below are the parts of FieldAgent and LiveMatch it reads.
 */

export type Band = "A" | "B" | "C";

export type FieldEntry = {
  id: string;
  name: string;
  presetName: string | null;
  band: Band;
  house: boolean;
  retiredAt: string | null;
};

export type PlayingMatch = {
  id: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  netA: number;
  netB: number;
  /** House agents playing each other: nothing was staked. */
  exhibition: boolean;
  /** When its playback started on this page's clock, and how long it runs: for the arena's running score. */
  startedAt?: number;
  playMs?: number;
  /** Its rounds, each with the rounds won by either side once that round is over. */
  play?: readonly { roundsWon: { A: number; B: number } }[];
};

/** A match's playback, for keeping score in the arena as the rounds play out. */
export type MatchClock = { startedAt: number; playMs: number; roundsWon: { A: number; B: number }[] };

/** The buildings agents stand at. The rest of the village is somewhere to go, not somewhere to be. */
export type Place = "arena" | "tavern" | "forge" | "castle" | "gate";

/** Waiting agents gather at their band's hall: the stakes rise from the tavern to the castle. */
export const BAND_HALL: Record<Band, Place> = { A: "tavern", B: "forge", C: "castle" };

export const HERO_UNITS = ["warrior", "archer", "pawn"] as const;
export const HERO_COLOURS = ["blue", "yellow", "red", "purple"] as const;
export type Look = { unit: (typeof HERO_UNITS)[number]; colour: (typeof HERO_COLOURS)[number] };

export type Resident = {
  id: string;
  name: string;
  presetName: string | null;
  band: Band;
  house: boolean;
  place: Place;
  /** The match it is playing now. `net` is this side's result, to show once the match has played out. */
  match: {
    id: string;
    seat: "A" | "B";
    opponent: { id: string; name: string };
    net: number;
    exhibition: boolean;
    clock: MatchClock | null;
  } | null;
  look: Look;
};

/** FNV-1a: the same id always hashes the same, in every browser. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A generic villager, fixed by the agent's id so it looks the same on every
 * visit. Nothing about it is the agent's character: portraits stay on the
 * agent's own pages. Players' agents are told apart by their names, which
 * always show; house agents show theirs on hover.
 */
export function lookOf(id: string): Look {
  const h = hash(id);
  return {
    unit: HERO_UNITS[h % HERO_UNITS.length] ?? "pawn",
    colour: HERO_COLOURS[Math.floor(h / HERO_UNITS.length) % HERO_COLOURS.length] ?? "blue",
  };
}

/**
 * Everyone on the field, placed. `playing` is newest first, so an agent in two
 * playbacks at once is shown in the newer. A retiring agent heads for the gate
 * whatever it was doing: the field shows it leaving for a minute, then drops it.
 */
export function placeResidents(agents: readonly FieldEntry[], playing: readonly PlayingMatch[]): Resident[] {
  const inMatch = new Map<string, NonNullable<Resident["match"]>>();
  for (const m of playing) {
    if (inMatch.has(m.a.id) || inMatch.has(m.b.id)) continue;
    const clock =
      m.startedAt !== undefined && m.playMs !== undefined && m.play
        ? { startedAt: m.startedAt, playMs: m.playMs, roundsWon: m.play.map((r) => ({ ...r.roundsWon })) }
        : null;
    inMatch.set(m.a.id, { id: m.id, seat: "A", opponent: m.b, net: m.netA, exhibition: m.exhibition, clock });
    inMatch.set(m.b.id, { id: m.id, seat: "B", opponent: m.a, net: m.netB, exhibition: m.exhibition, clock });
  }
  return agents.map((a) => {
    const match = a.retiredAt ? null : (inMatch.get(a.id) ?? null);
    return {
      id: a.id,
      name: a.name,
      presetName: a.presetName,
      band: a.band,
      house: a.house,
      place: a.retiredAt ? "gate" : match ? "arena" : BAND_HALL[a.band],
      match,
      look: lookOf(a.id),
    };
  });
}
