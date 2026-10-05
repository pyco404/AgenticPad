import { describe, expect, it } from "vitest";
import {
  ARENA_MIN_MS,
  ARENA_WEIGHTS,
  arenaLine,
  arenaScore,
  arrive,
  emptyArena,
  finish,
  RIVALRY_MEETINGS,
  tick,
  type ArenaMatch,
} from "../web/app/village/arena.js";

// What the Arena shows (web/app/village/arena.ts). Presentation only.

/** A match between two agents, `wonA` rounds to `wonB`. */
const match = (id: string, a: string, b: string, wonA = 3, wonB = 2): ArenaMatch => ({
  id,
  a: { id: a, name: `Agent ${a}` },
  b: { id: b, name: `Agent ${b}` },
  netA: wonA > wonB ? 10 : wonA < wonB ? -10 : 0,
  netB: wonA > wonB ? -10 : wonA < wonB ? 10 : 0,
  exhibition: false,
  play: [{ roundsWon: { A: wonA, B: wonB } }],
});
const ranks = new Map([
  ["top1", 1],
  ["top2", 2],
  ["mid", 30],
  ["low", 48],
]);

describe("the Arena", () => {
  it("scores two highly ranked agents above lower-ranked ones, and one star alone for nothing", () => {
    const top = arenaScore(match("m", "top1", "top2"), ranks, 1);
    const lower = arenaScore(match("n", "mid", "low"), ranks, 1);
    const lopsided = arenaScore(match("o", "top1", "unranked"), ranks, 1);
    expect(top).toBeGreaterThan(lower);
    expect(lower).toBeGreaterThan(lopsided);
    expect(lopsided).toBeCloseTo(arenaScore(match("p", "x", "y"), ranks, 1));
  });

  it("scores a close match above a whitewash, and a rivalry with a bonus", () => {
    expect(arenaScore(match("m", "x", "y", 3, 3), ranks, 1)).toBeGreaterThan(arenaScore(match("n", "x", "y", 5, 0), ranks, 1));
    const once = arenaScore(match("m", "x", "y"), ranks, RIVALRY_MEETINGS - 1);
    expect(arenaScore(match("m", "x", "y"), ranks, RIVALRY_MEETINGS)).toBeCloseTo(once + ARENA_WEIGHTS.rivalry);
  });

  it("picks the higher-ranked pairing of two that arrive together", () => {
    let s = emptyArena();
    s = arrive(s, match("low", "mid", "low"), ranks, 0);
    s = arrive(s, match("top", "top1", "top2"), ranks, 0);
    // The first went straight on; the better one waits its turn and is next.
    expect(s.show?.match.id).toBe("low");
    s = finish(s, "low", 5_000);
    expect(s.show).toMatchObject({ kind: "live", match: { id: "top" } });
  });

  it("keeps a match on for at least ARENA_MIN_MS before a better one takes over", () => {
    let s = arrive(emptyArena(), match("m", "mid", "low"), ranks, 0);
    s = arrive(s, match("better", "top1", "top2"), ranks, 1_000);
    expect(s.show?.match.id).toBe("m");
    s = tick(s, ARENA_MIN_MS - 1);
    expect(s.show?.match.id).toBe("m");
    s = tick(s, ARENA_MIN_MS);
    expect(s.show?.match.id).toBe("better");
  });

  it("never lets a lower-scoring match take over, however long the one showing has been on", () => {
    let s = arrive(emptyArena(), match("best", "top1", "top2"), ranks, 0);
    s = arrive(s, match("worse", "mid", "low"), ranks, 1_000);
    s = tick(s, ARENA_MIN_MS * 3);
    expect(s.show?.match.id).toBe("best");
  });

  it("replays the best match of the day when nothing is live, labelled as a replay", () => {
    let s = arrive(emptyArena(), match("good", "top1", "top2"), ranks, 0);
    s = finish(s, "good", 20_000);
    s = arrive(s, match("dull", "x", "y", 5, 0), ranks, 21_000);
    s = finish(s, "dull", 120_000);
    expect(s.show).toMatchObject({ kind: "replay", match: { id: "good" } });
    expect(arenaLine(s.show)).toBe("replay: Agent top1 vs Agent top2");
  });

  it("puts a new match on over a replay once the replay has been on ARENA_MIN_MS", () => {
    let s = arrive(emptyArena(), match("good", "top1", "top2"), ranks, 0);
    s = finish(s, "good", 20_000);
    expect(s.show?.kind).toBe("replay");
    s = arrive(s, match("new", "x", "y"), ranks, 21_000);
    expect(s.show?.kind).toBe("replay");
    s = tick(s, 20_000 + ARENA_MIN_MS);
    expect(s.show).toMatchObject({ kind: "live", match: { id: "new" } });
    expect(arenaLine(s.show)).toBe("live: Agent x vs Agent y");
  });

  it("replays what this browser kept from before when a page opens with nothing live", () => {
    const kept = finish(arrive(emptyArena(), match("good", "top1", "top2"), ranks, 0), "good", 1_000);
    const reopened = tick({ ...emptyArena(), best: kept.best }, 60_000);
    expect(reopened.show).toMatchObject({ kind: "replay", match: { id: "good" } });
  });

  it("says so plainly when there has been no match in a day", () => {
    expect(arenaLine(emptyArena().show)).toBe("no matches yet");
    let s = arrive(emptyArena(), match("m", "x", "y"), ranks, 0);
    s = finish(s, "m", 25 * 60 * 60 * 1000);
    expect(s.show).toBeNull();
  });

  it("counts meetings this season, and starts again in a new one", () => {
    let s = emptyArena();
    for (let i = 0; i < RIVALRY_MEETINGS; i++) s = arrive(s, match(`m${i}`, "x", "y"), ranks, i, "s1");
    expect(s.meetings["x|y"]).toBe(RIVALRY_MEETINGS);
    s = arrive(s, match("n", "y", "x"), ranks, 10, "s2");
    expect(s.meetings).toEqual({ "x|y": 1 });
  });
});
