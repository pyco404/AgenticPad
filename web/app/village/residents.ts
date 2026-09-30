/**
 * Where every agent on the field stands in the village, and what it looks
 * like there. Pure: the page feeds it the field and the matches playing out,
 * and the scene draws the result. It reads results and never makes one, so
 * nothing here can reach a match, a pairing or a balance.
 *
 * Kept free of the web app's path aliases so the root suite can test it; the
 * shapes below are the parts of FieldAgent and LiveMatch it reads.
 */

export type FieldEntry = {
  id: string;
  name: string;
  presetName: string | null;
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
  /** Its rounds, each with the rounds won by either side once that round is over, and what happened in it. */
  play?: readonly ({ roundsWon: { A: number; B: number } } & Partial<TableRound>)[];
};

/** One round of Bluff & Fold as the arena's table shows it. Mirrors PlayRound in lib/live.ts. */
export type TableRound = {
  /** Who acted first; null when both chose at once. */
  leader: "A" | "B" | null;
  /** Each side's edge: its chance, as a share, of winning the flip. */
  edges: { A: number; B: number };
  /** The choices, in the order they were made. */
  sequence: readonly { seat: "A" | "B"; action: "fold" | "call" | "raise" }[];
  outcome: "both-folded" | "one-folded" | "flipped";
  /** The chips that changed hands. */
  bet: number;
  winner: "A" | "B" | null;
};

/**
 * A match's playback, for the arena as the rounds play out: the running score,
 * and each round's hands and choices when the stream sent them.
 */
export type MatchClock = { startedAt: number; playMs: number; roundsWon: { A: number; B: number }[]; rounds: (TableRound | null)[] };

/** A round's detail, when the stream sent all of it. */
function tableRound(r: Partial<TableRound>): TableRound | null {
  if (!r.edges || !r.sequence || !r.outcome || r.bet === undefined || r.winner === undefined) return null;
  return { leader: r.leader ?? null, edges: r.edges, sequence: r.sequence, outcome: r.outcome, bet: r.bet, winner: r.winner };
}

/** The buildings agents stand at. The rest of the village is somewhere to go, not somewhere to be. */
export type Place = "arena" | "tavern" | "forge" | "castle" | "gate";

/** The halls waiting agents gather at. Everyone plays everyone, so a hall is only where an agent waits. */
export const HALLS = ["tavern", "forge", "castle"] as const;
export type Hall = (typeof HALLS)[number];

export const HERO_UNITS = ["warrior", "archer", "pawn"] as const;
export const HERO_COLOURS = ["blue", "yellow", "red", "purple"] as const;
export type Look = { unit: (typeof HERO_UNITS)[number]; colour: (typeof HERO_COLOURS)[number] };

export type Resident = {
  id: string;
  name: string;
  presetName: string | null;
  house: boolean;
  /** The hall it waits at, fixed by its id. */
  hall: Hall;
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
 * The knight an agent is drawn as when it has no portrait, fixed by its id so
 * it looks the same on every visit. An agent with one walks the village as its
 * own character (the scene draws it). Players' agents' names always show;
 * house agents show theirs on hover.
 */
export function lookOf(id: string): Look {
  const h = hash(id);
  return {
    unit: HERO_UNITS[h % HERO_UNITS.length] ?? "pawn",
    colour: HERO_COLOURS[Math.floor(h / HERO_UNITS.length) % HERO_COLOURS.length] ?? "blue",
  };
}

/**
 * The hall an agent waits at, fixed by its id so it is always the same one, and
 * spread so the three fill about evenly. Salted, so it does not follow the look.
 */
export function hallOf(id: string): Hall {
  return HALLS[hash(`hall:${id}`) % HALLS.length] ?? "forge";
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
        ? { startedAt: m.startedAt, playMs: m.playMs, roundsWon: m.play.map((r) => ({ ...r.roundsWon })), rounds: m.play.map(tableRound) }
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
      house: a.house,
      hall: hallOf(a.id),
      place: a.retiredAt ? "gate" : match ? "arena" : hallOf(a.id),
      match,
      look: lookOf(a.id),
    };
  });
}
