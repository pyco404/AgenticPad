import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apart, BARE_MS, duelPhase, LINGER_MS, meetingSpot, pathSpots, RING_CAP, ringsInFull } from "../web/app/village/game/duels.js";
import { nearRoad, ROADS } from "../web/app/village/game/town.js";

// Matches where agents meet (web/app/village/game/duels.ts). Presentation only.

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
const spots = pathSpots(ROADS);
/** Open ground off the paths, as the scene's ground offers it: a grid over the world's dry land. */
const clearings = Array.from({ length: 40 * 22 }, (_, i) => ({ x: 64 + (i % 40) * 66, y: 96 + Math.floor(i / 40) * 62 })).filter((p) => p.y < 1440);

/** Every .ts file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("matches where agents meet", () => {
  it("is presentation only: nothing the server runs - matchmaker, runner, scoring, ledger - imports the village", () => {
    const root = new URL("../src", import.meta.url).pathname;
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*(village|web\/app)[^"']*["']/);
    }
  });

  it("meets on the paths, near the point between the two sides", () => {
    const a = { x: 900, y: 1150 };
    const b = { x: 1300, y: 1150 };
    const spot = meetingSpot(a, b, spots, [])!;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(nearRoad(spot, 0)).toBe(true);
    expect(dist(spot, midpoint)).toBeCloseTo(Math.min(...spots.map((p) => dist(p, midpoint))), 6);
  });

  it("puts two simultaneous matches at two different spots, far enough apart that their rings and scores never touch", () => {
    const first = meetingSpot({ x: 900, y: 1150 }, { x: 1300, y: 1150 }, spots, [])!;
    const second = meetingSpot({ x: 950, y: 1150 }, { x: 1250, y: 1150 }, spots, [first])!;
    expect(apart(first, second)).toBe(true);
    // Forty at once: the paths fill, then the clearings, and every ring stays clear of every other.
    const taken: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const a = { x: 300 + ((i * 197) % 2200), y: 300 + ((i * 131) % 1100) };
      taken.push(meetingSpot(a, { x: a.x + 80, y: a.y }, spots, taken, () => true, undefined, clearings)!);
    }
    const clashes = taken.flatMap((p, i) => taken.slice(i + 1).filter((q) => !apart(p, q))).length;
    expect(clashes).toBe(0);
  });

  it("never meets where the ground is not open", () => {
    const blocked = (p: { x: number; y: number }) => !(p.x > 1000 && p.x < 1200);
    const spot = meetingSpot({ x: 1050, y: 1150 }, { x: 1150, y: 1150 }, spots, [], blocked)!;
    expect(spot.x <= 1000 || spot.x >= 1200).toBe(true);
    expect(meetingSpot({ x: 0, y: 0 }, { x: 1, y: 1 }, spots, [], () => false)).toBeNull();
  });

  it("draws at most twelve rings in full with forty matches on, the nearest the middle of the screen", () => {
    const rings: { id: string; x: number; y: number }[] = [];
    let taken: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const a = { x: 300 + ((i * 197) % 2200), y: 300 + ((i * 131) % 1100) };
      const spot = meetingSpot(a, { x: a.x + 80, y: a.y }, spots, taken)!;
      taken = [...taken, spot];
      rings.push({ id: `m${i}`, ...spot });
    }
    const centre = { x: 1400, y: 860 };
    const full = ringsInFull(rings, centre);
    expect(full.size).toBe(RING_CAP);
    const furthestShown = Math.max(...rings.filter((r) => full.has(r.id)).map((r) => dist(r, centre)));
    const nearestHidden = Math.min(...rings.filter((r) => !full.has(r.id)).map((r) => dist(r, centre)));
    expect(furthestShown).toBeLessThanOrEqual(nearestHidden);
    // Every one of the forty still has its spot: drawn as a marker, and counted.
    expect(rings).toHaveLength(40);
  });

  it("never makes a match wait: the replay runs in full from when both sides arrive, however late", () => {
    const playMs = 12_000;
    // Still walking: nothing plays, whatever the server has finished.
    expect(duelPhase(1_000_000, null, playMs)).toBe("walking");
    // They arrive long after the server's result: the whole replay still plays out from then.
    const metAt = 500_000;
    expect(duelPhase(metAt + 1, metAt, playMs)).toBe("playing");
    expect(duelPhase(metAt + playMs + LINGER_MS - 1, metAt, playMs)).toBe("playing");
    expect(duelPhase(metAt + playMs + LINGER_MS, metAt, playMs)).toBe("done");
    // A match with no rounds to show still stands them together a moment.
    expect(duelPhase(metAt + BARE_MS + LINGER_MS - 1, metAt, null)).toBe("playing");
  });
});
