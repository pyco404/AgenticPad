import { describe, expect, it } from "vitest";
import { GARDEN_PONDS } from "../web/app/village/game/landmarks.js";
import { chunksIn, chunkTrees, type ForestRules } from "../web/app/village/game/forest.js";
import { canopy, felled, NEW_TOWN, NEW_TOWN_FIXED, nextPlot, openPlots, overlaps, plotClearing, thresholds } from "../web/app/village/game/growth.js";
import { BAZAAR_SITE, LAUNCH_SITE, nearRoad, SITES } from "../web/app/village/game/town.js";
import { fromEdge, inNewTown, INNER, onOldGround, OUTER, WORLD_ROADS } from "../web/app/village/game/world.js";

// The village grows with its holders (docs/holder-agents.md, The village).
// Presentation only: these check the plan is sound, not anything that plays.

const plots = NEW_TOWN.plots;
/** The forest's rules with the given plots open, as the scene sets them. */
const rules = (open: number): ForestRules => ({
  inOldTown: (p) => onOldGround(p),
  onRoad: (p) => nearRoad(p, 20),
  taken: [],
  cleared: openPlots(NEW_TOWN, open).map((p) => plotClearing(p)),
});
/** Every tree over New Town's band, at a holder count. */
const bandTrees = (open: number) =>
  chunksIn({ x0: OUTER.cx - OUTER.hw, y0: OUTER.cy - OUTER.hh, x1: OUTER.cx + OUTER.hw, y1: OUTER.cy + OUTER.hh }).flatMap(({ cx, cy }) => chunkTrees(cx, cy, rules(open)));

describe("New Town's growth", () => {
  it("opens nothing with no holders, then a plot at a time, and more with every count", () => {
    expect(openPlots(NEW_TOWN, 0)).toEqual([]);
    expect(openPlots(NEW_TOWN, 1)).toHaveLength(1);
    let last = 0;
    for (let n = 0; n <= 20_000; n += n < 100 ? 1 : 37) {
      const open = openPlots(NEW_TOWN, n).length;
      expect(open).toBeGreaterThanOrEqual(last);
      last = open;
    }
    expect(openPlots(NEW_TOWN, 1_000_000)).toHaveLength(plots.length);
    expect(nextPlot(NEW_TOWN, 0)?.at).toBe(1);
    expect(nextPlot(NEW_TOWN, 1_000_000)).toBeNull();
  });

  it("never closes an open plot: what is open at a count is open at every count above it, and the same every time", () => {
    for (const n of [1, 5, 30, 200, 1_500]) {
      const here = openPlots(NEW_TOWN, n).map((p) => p.id);
      expect(openPlots(NEW_TOWN, n).map((p) => p.id)).toEqual(here);
      for (const m of [n, n + 1, n * 2, n * 10]) expect(openPlots(NEW_TOWN, m).map((p) => p.id)).toEqual(expect.arrayContaining(here));
    }
  });

  it("lists plots in the order they open, each with its own id, enough of them for a growing town", () => {
    expect(plots.map((p) => p.at)).toEqual([...plots.map((p) => p.at)].sort((a, b) => a - b));
    expect(new Set(plots.map((p) => p.id)).size).toBe(plots.length);
    expect(plots.length).toBeGreaterThan(50);
    expect(thresholds(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("builds only in New Town, off every road, clear of every building and of each other", () => {
    const sites = Object.entries(SITES).map(([id, s]) => ({ id, box: { x0: s.x - 110, y0: s.y - 220, x1: s.x + 110, y1: s.y + 30 } }));
    for (const plot of plots) {
      const box = plotClearing(plot, 0);
      for (const pond of GARDEN_PONDS) expect(overlaps(box, pond), `${plot.id} against pond`).toBe(false);
      for (const p of plot.pieces) expect(inNewTown(p, 40), plot.id).toBe(true);
      for (const corner of [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x0, y: box.y1 }, { x: box.x1, y: box.y1 }]) {
        expect(nearRoad(corner, 0), `${plot.id} is off the roads`).toBe(false);
      }
      for (const s of sites) expect(overlaps(box, s.box), `${plot.id} against ${s.id}`).toBe(false);
      for (const f of NEW_TOWN_FIXED) expect(overlaps(box, { x0: f.at.x - 120, y0: f.at.y - 200, x1: f.at.x + 120, y1: f.at.y + 40 }), `${plot.id} against ${f.id}`).toBe(false);
      for (const other of plots) if (other.id !== plot.id) expect(overlaps(box, plotClearing(other, 0)), `${plot.id} against ${other.id}`).toBe(false);
    }
  });

  it("sets the Launch Pad and the bazaar in New Town, on opposite sides, off the roads", () => {
    for (const s of [LAUNCH_SITE, BAZAAR_SITE]) {
      expect(inNewTown(s, 60)).toBe(true);
      expect(nearRoad({ x: s.x, y: s.y - 60 }, 0)).toBe(false);
    }
    expect(Math.sign(LAUNCH_SITE.x - INNER.cx)).toBe(-Math.sign(BAZAAR_SITE.x - INNER.cx));
    expect(fromEdge(INNER, LAUNCH_SITE)).toBeGreaterThan(0);
  });

  it("keeps the Launch Pad's whole platform clear of the country lane, including its widened kerb", () => {
    // Testing only the rocket's centre missed its base overlapping the road.
    const halfWidth = 64 * LAUNCH_SITE.scale / 2;
    for (const x of [LAUNCH_SITE.x - halfWidth, LAUNCH_SITE.x, LAUNCH_SITE.x + halfWidth]) {
      for (const y of [LAUNCH_SITE.y - 20, LAUNCH_SITE.y]) {
        for (const road of WORLD_ROADS) for (let i = 1; i < road.points.length; i++) {
          const [ax, ay] = road.points[i - 1]!, [bx, by] = road.points[i]!;
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          expect(Math.hypot(x - ax - t * dx, y - ay - t * dy)).toBeGreaterThan(road.width / 2 + 6);
        }
      }
    }
  });

  it("takes down the trees whose canopy reaches a plot as it opens, and no others", () => {
    const plot = plots[0]!;
    const door = plot.door;
    const trees = [
      { x: door.x, y: door.y, s: 0.6 }, // on the plot
      { x: door.x + 900, y: door.y, s: 0.6 }, // far away
    ];
    expect(felled(trees, [plot])).toEqual([0]);
    expect(felled(trees, [])).toEqual([]);
    expect(overlaps(canopy(trees[1]!), plotClearing(plot))).toBe(false);
  });

  it("never grows a felled tree back: the forest over New Town only ever loses trees as plots open", () => {
    let standing = new Set(bandTrees(0).map((t) => t.id));
    expect(standing.size).toBeGreaterThan(0);
    for (const n of [1, 10, 60, 400, 5_000, 1_000_000]) {
      const now = new Set(bandTrees(n).map((t) => t.id));
      for (const id of now) expect(standing.has(id), `${id} grew back at ${n}`).toBe(true);
      // And none stands on an open plot.
      for (const t of bandTrees(n)) for (const p of openPlots(NEW_TOWN, n)) expect(overlaps(canopy(t), plotClearing(p))).toBe(false);
      standing = now;
    }
  });
});
