/**
 * What the Arena shows: always exactly one match, chosen from the matches the
 * village has been sent. Every match is scored as it arrives; the best new
 * one is played live by its own two agents, and when nothing new has come the
 * best of the last day is replayed by stand-ins.
 *
 * Presentation only. The matches it chooses from have already been played:
 * nothing here is read by the matchmaker, the runner, scoring or the ledger
 * (test/duels.test.ts checks that nothing in src/ imports the village), and no
 * match ever waits for the Arena. Pure and free of the web app's aliases, so
 * the root suite can test it.
 */

import type { PlayingMatch } from "./residents";

/**
 * How a match is scored for the Arena, out of about 1.2:
 *
 * - `rank` (up to 0.6): the two sides' ladder ranks, as the geometric mean of
 *   each side's standing, so it takes two highly ranked agents to score high -
 *   one star against an unranked agent scores nothing. The biggest weight:
 *   the Arena is where the best meet.
 * - `close` (up to 0.4): how near the final result was, by rounds won - a
 *   level match scores it all, a whitewash none. A tight match is worth
 *   watching between anyone.
 * - `rivalry` (0.2, all or nothing): the same two have met RIVALRY_MEETINGS
 *   times or more this season. A bonus, not a rule: it lifts a rematch over an
 *   equal match between strangers, and never over a much better one.
 */
export const ARENA_WEIGHTS = { rank: 0.6, close: 0.4, rivalry: 0.2 } as const;
/** Ranks below this count for nothing; rank 1 counts in full, and each place below it a little less. */
export const RANK_DEPTH = 50;
/** How many meetings this season make a rivalry. */
export const RIVALRY_MEETINGS = 3;
/** The least a match is shown before anything may take its place: the Arena never flickers between matches. */
export const ARENA_MIN_MS = 30_000;
/** A match is new - a candidate to be played live - for this long after it arrives. */
export const FRESH_MS = 60_000;
/** Replays are chosen from this far back. */
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A match still showing after this has stuck - its sides never got in - and is let go. */
export const STUCK_MS = 120_000;
/** How many of the best matches are kept to replay. */
export const REPLAY_KEEP = 12;

/** A match as the Arena keeps it: what is needed to play it out again. */
export type ArenaMatch = Pick<PlayingMatch, "id" | "a" | "b" | "netA" | "netB" | "exhibition" | "play">;
export type Scored = { match: ArenaMatch; score: number; at: number };
/** What the Arena shows, and since when. A live match is played by its own agents; a replay by stand-ins. */
export type ArenaShow = Scored & { kind: "live" | "replay"; since: number };

export type ArenaState = {
  show: ArenaShow | null;
  /** New matches not yet shown, best first. */
  fresh: Scored[];
  /** The best matches of the last REPLAY_WINDOW_MS, best first, to replay. */
  best: Scored[];
  /** Meetings this season, by pair (pairKey), as far as this page has seen them. */
  meetings: Record<string, number>;
  /** The season the meetings are counted in. */
  season: string | null;
};

export const emptyArena = (): ArenaState => ({ show: null, fresh: [], best: [], meetings: {}, season: null });

/** The same key for a pair whichever side is A. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** One side's standing, from 1 for the top of the ladder down to 0 past RANK_DEPTH or unranked. */
const standing = (rank: number | undefined) => (rank === undefined || rank < 1 ? 0 : Math.max(0, 1 - (rank - 1) / RANK_DEPTH));

/** How near the result was: 1 for level on rounds, 0 when one side took them all. Unknown counts as middling. */
function closeness(m: ArenaMatch): number {
  const last = m.play?.[m.play.length - 1]?.roundsWon;
  if (!last) return m.netA === 0 ? 1 : 0.5;
  const total = last.A + last.B;
  return total === 0 ? 1 : 1 - Math.abs(last.A - last.B) / total;
}

/** A match's score for the Arena (ARENA_WEIGHTS). `ranks` is the ladder, agent id to rank from 1. */
export function arenaScore(m: ArenaMatch, ranks: ReadonlyMap<string, number>, meetings: number): number {
  const rank = Math.sqrt(standing(ranks.get(m.a.id)) * standing(ranks.get(m.b.id)));
  return ARENA_WEIGHTS.rank * rank + ARENA_WEIGHTS.close * closeness(m) + (meetings >= RIVALRY_MEETINGS ? ARENA_WEIGHTS.rivalry : 0);
}

const byScore = (x: Scored, y: Scored) => y.score - x.score || y.at - x.at;

/**
 * A match has arrived. It is counted as a meeting, scored, and kept; it goes
 * straight on if the Arena is empty or showing a replay, and takes over a live
 * match only when it scores higher and that one has been on ARENA_MIN_MS.
 */
export function arrive(state: ArenaState, match: ArenaMatch, ranks: ReadonlyMap<string, number>, now: number, season: string | null = state.season): ArenaState {
  if (state.show?.match.id === match.id || state.fresh.some((s) => s.match.id === match.id)) return state;
  const meetings = season === state.season ? { ...state.meetings } : {};
  const key = pairKey(match.a.id, match.b.id);
  meetings[key] = (meetings[key] ?? 0) + 1;
  const scored: Scored = { match, score: arenaScore(match, ranks, meetings[key]!), at: now };
  const best = [...state.best.filter((s) => s.match.id !== match.id && now - s.at < REPLAY_WINDOW_MS), scored].sort(byScore).slice(0, REPLAY_KEEP);
  const fresh = [...state.fresh.filter((s) => now - s.at < FRESH_MS), scored].sort(byScore);
  return settle({ ...state, meetings, season, best, fresh }, now);
}

/** Time has passed: a better new match may now take over (ARENA_MIN_MS), and stale ones stop being new. */
export function tick(state: ArenaState, now: number): ArenaState {
  if (state.show && now - state.show.since > STUCK_MS) return finish(state, state.show.match.id, now);
  // Empty - a fresh page with only what this browser kept from before: the best of the day, replayed.
  if (!state.show && state.fresh.length === 0) {
    const replay = state.best.find((s) => now - s.at < REPLAY_WINDOW_MS);
    return replay ? { ...state, show: { ...replay, kind: "replay", since: now } } : state;
  }
  const fresh = state.fresh.filter((s) => now - s.at < FRESH_MS);
  return settle(fresh.length === state.fresh.length ? state : { ...state, fresh }, now);
}

/**
 * The match showing has played out: the best new one goes on live, or with
 * nothing new, the best of the last day is replayed - another one than this if
 * there is one. With no match at all in that time, the Arena is empty.
 */
export function finish(state: ArenaState, matchId: string, now: number): ArenaState {
  if (state.show?.match.id !== matchId) return state;
  const fresh = state.fresh.filter((s) => now - s.at < FRESH_MS);
  const [next, ...rest] = fresh;
  if (next) return { ...state, fresh: rest, show: { ...next, kind: "live", since: now } };
  const recent = state.best.filter((s) => now - s.at < REPLAY_WINDOW_MS);
  const replay = recent.find((s) => s.match.id !== matchId) ?? recent[0];
  return { ...state, fresh, best: recent, show: replay ? { ...replay, kind: "replay", since: now } : null };
}

/** Whether the Arena should move on to the best new match now. */
function settle(state: ArenaState, now: number): ArenaState {
  const [next, ...rest] = state.fresh;
  if (!next) return state;
  const show = state.show;
  const takes =
    show === null ||
    (now - show.since >= ARENA_MIN_MS && (show.kind === "replay" || next.score > show.score));
  return takes ? { ...state, fresh: rest, show: { ...next, kind: "live", since: now } } : state;
}

/** What the Arena's sign says: what is on, or that nothing has been played. */
export function arenaLine(show: ArenaShow | null): string {
  if (!show) return "no matches yet";
  return `${show.kind}: ${show.match.a.name} vs ${show.match.b.name}`;
}
