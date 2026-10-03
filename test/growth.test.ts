import { describe, expect, it } from "vitest";
import { canopy, felled, nextPlot, openPlots, overlaps, plotClearing, PLOTS } from "../web/app/village/game/growth.js";
import { inTown, nearRoad, SITES } from "../web/app/village/game/town.js";

// The village grows with its holders (docs/holder-agents.md, The village).
// Presentation only: these check the plan is sound, not anything that plays.

const WORLD = { width: 2800, height: 1800 };
/** The lake: below this, west of the east shore. */
const inLake = (p: { x: number; y: number }) => p.y > 1470 && p.x < 2140;

describe("the village's growth", () => {
  it("opens nothing with no holders, and more with every threshold, in order", () => {
    expect(openPlots(0)).toEqual([]);
    expect(openPlots(1).map((p) => p.id)).toEqual(["west-1"]);
    let last = 0;
    for (const n of [1, 3, 5, 10, 20, 50, 100, 1000]) {
      const open = openPlots(n).length;
      expect(open).toBeGreaterThanOrEqual(last);
      last = open;
    }
    expect(openPlots(1_000_000)).toHaveLength(PLOTS.length);
    expect(nextPlot(1)?.at).toBe(3);
    expect(nextPlot(1_000_000)).toBeNull();
  });

  it("lists plots in the order they open, each with its own id", () => {
    expect(PLOTS.map((p) => p.at)).toEqual([...PLOTS.map((p) => p.at)].sort((a, b) => a - b));
    expect(new Set(PLOTS.map((p) => p.id)).size).toBe(PLOTS.length);
  });

  it("builds out in the forest round the town, on land, off the roads, clear of the buildings and of each other", () => {
    const sites = Object.entries(SITES).map(([id, s]) => ({ id, box: { x0: s.x - 120, y0: s.y - 260, x1: s.x + 120, y1: s.y + 60 } }));
    for (const plot of PLOTS) {
      const box = plotClearing(plot, 0);
      for (const p of plot.pieces) {
        expect(p.x, plot.id).toBeGreaterThan(60);
        expect(p.x, plot.id).toBeLessThan(WORLD.width - 60);
        expect(p.y, plot.id).toBeGreaterThan(100);
        expect(p.y, plot.id).toBeLessThan(WORLD.height - 60);
        expect(inLake(p), plot.id).toBe(false);
        expect(inTown(p), `${plot.id} is outside the town`).toBe(false);
        expect(nearRoad(p, 30), `${plot.id} is off the roads`).toBe(false);
      }
      for (const s of sites) expect(overlaps(box, s.box), `${plot.id} against ${s.id}`).toBe(false);
      for (const other of PLOTS) {
        if (other.id !== plot.id) expect(overlaps(box, plotClearing(other, 0)), `${plot.id} against ${other.id}`).toBe(false);
      }
    }
  });

  it("takes down the trees whose canopy reaches a plot as it opens, and no others", () => {
    const plot = PLOTS[0]!;
    const door = plot.door;
    const trees = [
      { x: door.x, y: door.y, s: 0.6 }, // on the plot
      { x: door.x + 900, y: door.y, s: 0.6 }, // far away
    ];
    expect(felled(trees, [plot])).toEqual([0]);
    expect(felled(trees, [])).toEqual([]);
    expect(overlaps(canopy(trees[1]!), plotClearing(plot))).toBe(false);
  });
});
