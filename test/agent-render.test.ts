import { describe, expect, it } from "vitest";
import { agentInViewport, agentScale } from "../web/lib/world/agent-render";
import { project } from "../web/lib/world/projection";

describe("projected agent viewport", () => {
  it("retains the entire upright sprite, including its head below the bottom edge", () => {
    for (const zoom of [0.035, 0.1, 0.5, 1.2, 3.5]) {
      const k = agentScale(zoom);
      expect(agentInViewport(400, 600 + 90 * k, zoom, 800, 600)).toBe(true);
      expect(agentInViewport(-50 * k, 300, zoom, 800, 600)).toBe(true);
      expect(agentInViewport(400, -20 * k, zoom, 800, 600)).toBe(true);
      expect(agentInViewport(400, 1100, zoom, 800, 600)).toBe(false);
    }
  });

  it("uses a wider exit boundary to avoid repeated edge toggles", () => {
    let retained = false;
    const states = [-130, -90, -100, -95, -110, -90, -170].map((x) => retained = agentInViewport(x, 200, 0.5, 800, 600, retained));
    expect(states).toEqual([false, true, true, true, true, true, false]);
  });

  it.each([100, 1000])("never culls an onscreen agent among %i moving agents at any camera angle", (count) => {
    for (const zoom of [0.035, 0.3, 1, 3.5]) for (const tilt of [Math.PI / 12, Math.asin(1 / Math.sqrt(3)), Math.PI / 2]) {
      for (let tick = 0; tick < 24; tick++) {
        const view = { yaw: tick * Math.PI / 12, tilt };
        for (let i = 0; i < count; i++) {
          const p = project(view, { x: (i % 40 - 20) * 35 + tick * 4, y: (Math.floor(i / 40) - 12) * 35 });
          const x = 400 + p.x * zoom, y = 300 + p.y * zoom;
          if (x >= 0 && x <= 800 && y >= 0 && y <= 600) expect(agentInViewport(x, y, zoom, 800, 600)).toBe(true);
        }
      }
    }
  });
});
