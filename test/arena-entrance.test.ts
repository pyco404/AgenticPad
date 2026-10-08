import { describe, expect, it } from "vitest";
import { arenaSolid, COLOSSEUM } from "../web/lib/world/arena-geometry";
import { worldObject } from "../web/lib/world/model";
import { CAMERA_ANGLES, type FieldView } from "../web/lib/world/projection";
import { directionalVisibility } from "../web/lib/world/visibility";

const arena = { ...worldObject("site:arena", "arena", COLOSSEUM.x, COLOSSEUM.y, COLOSSEUM.rx * 2, COLOSSEUM.ry * 2, COLOSSEUM.wallHeight), shape: "ellipse" as const };

describe("usable arena entrances", () => {
  it("keeps walkers visible through the main entrance from either face and isometric", () => {
    for (const view of ["front", "back", "isometric"] satisfies FieldView[]) {
      for (const projection of [view, CAMERA_ANGLES[view]]) {
        const visible = directionalVisibility(projection, [arena]);
        for (let y = 925; y <= 1010; y += 5) {
          const agent = { x: 1400, y };
          expect(arenaSolid(agent)).toBe(false);
          expect(visible(agent, 19), `${view}: walker at ${y}`).toBe(true);
        }
      }
    }
  });

  it("opens the service entrance without making the surrounding stands transparent", () => {
    const visible = directionalVisibility("right", [arena]);
    for (let x = 1640; x <= 1810; x += 5) {
      expect(arenaSolid({ x, y: 775 })).toBe(false);
      expect(visible({ x, y: 775 }, 19)).toBe(true);
    }
    expect(directionalVisibility("front", [arena])({ x: 1260, y: 910 }, 19)).toBe(false);
    expect(visible({ x: 1720, y: 870 }, 19)).toBe(false);
  });
});
