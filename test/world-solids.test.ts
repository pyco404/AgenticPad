import { describe, expect, it } from "vitest";
import { SOLID_DECALS, SOLID_MATERIALS, solidMesh, type SolidKind } from "../web/lib/world/solid-models";
import { shownSide } from "../web/lib/world/facing";
import { MAX_TILT } from "../web/lib/world/projection";

const KINDS: SolidKind[] = ["cottage", "hall", "stall", "board"];

describe("solid prototype models", () => {
  it("are built once and shared, so turning the camera never rebuilds them", () => {
    for (const kind of KINDS) expect(solidMesh(kind)).toBe(solidMesh(kind));
  });
  it("are whole triangles with unit normals, known materials and finite texel coordinates", () => {
    for (const kind of KINDS) {
      const m = solidMesh(kind), n = m.positions.length / 3;
      expect(m.positions.length % 9).toBe(0);
      expect(m.triangles).toBeGreaterThan(50);
      for (let i = 0; i < n; i++) {
        expect(Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!)).toBeCloseTo(1, 5);
        const material = SOLID_MATERIALS[m.materials[i]!];
        expect(material).toBeDefined();
        const [u, v] = [m.uvs[i * 2]!, m.uvs[i * 2 + 1]!];
        expect(Number.isFinite(u) && Number.isFinite(v)).toBe(true);
        if (SOLID_DECALS.has(material!)) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
    }
  });
  it("stand on the ground: nothing below it, and a real front, back and both sides", () => {
    for (const kind of KINDS) {
      const m = solidMesh(kind);
      expect(m.min[2]).toBeCloseTo(0, 6);
      const facing = (x: number, y: number) => { let k = 0; for (let i = 0; i < m.normals.length; i += 3) if (m.normals[i]! * x + m.normals[i + 1]! * y > 0.9) k++; return k; };
      for (const [x, y] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) expect(facing(x!, y!)).toBeGreaterThan(5);
    }
  });
  it("give a board real thickness and a different back from its front", () => {
    const m = solidMesh("board");
    const materialsFacing = (y: number) => new Set(Array.from({ length: m.materials.length }, (_, i) => i).filter((i) => m.normals[i * 3 + 1]! * y > 0.9).map((i) => SOLID_MATERIALS[m.materials[i]!]));
    expect(materialsFacing(1).has("boardDisplay")).toBe(true);
    expect(materialsFacing(-1).has("boardDisplay")).toBe(false);
    expect(m.max[1] - m.min[1]).toBeGreaterThan(5);
  });
});

describe("character facing", () => {
  it("keeps its own heading while the camera goes round it", () => {
    // A character facing south, seen from the south, east, north and west.
    expect(shownSide("front", 0)).toBe("front");
    expect(shownSide("front", Math.PI / 2)).toBe("left");
    expect(shownSide("front", Math.PI)).toBe("back");
    expect(shownSide("front", -Math.PI / 2)).toBe("right");
  });
  it("holds a side a few degrees past each diagonal, so a slow orbit does not flicker", () => {
    const past = Math.PI / 4 + 3 * Math.PI / 180;
    expect(shownSide("front", past, "front")).toBe("front");
    expect(shownSide("front", past, "left")).toBe("left");
    expect(shownSide("front", Math.PI / 4 + 10 * Math.PI / 180, "front")).toBe("left");
  });
});

describe("camera height", () => {
  it("stops short of looking straight down, where upright scenery reads as bars", () => {
    expect(MAX_TILT).toBeLessThanOrEqual(55 * Math.PI / 180 + 1e-9);
  });
});
