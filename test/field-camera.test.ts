import { describe, expect, it, vi } from "vitest";
import { agentBox, inside, screenPoint, worldPicker } from "../web/lib/world/picking";
import { pictureObject, worldObject, type ArtFrame } from "../web/lib/world/model";
import { CAMERA_ANGLES, project } from "../web/lib/world/projection";
import { projectedObjectFaces } from "../web/lib/world/object-geometry";
import { localSize, objectVertex } from "../web/lib/world/object-appearance";

const camera = { x: 0, y: 0, scale: 1 };
const art = (key: string): ArtFrame => ({ image: key, x: 0, y: 0, width: 100, height: 100 });

describe("one Field camera's interactions", () => {
  it("picks the same fixed building at high, low and rotated angles", () => {
    const house = pictureObject("site:hall", { key: "hall", frame: 0 }, { x: -150, y: 240 }, 120, 160);
    house.type = "building";
    const before = structuredClone(house);
    for (const angle of [CAMERA_ANGLES.isometric, { yaw: 2.37, tilt: 0.27 }, { yaw: -1.8, tilt: Math.PI / 2 }]) {
      const centre = project(angle, house), cam = { ...centre, scale: 1.7 };
      const pick = worldPicker(angle, [house], cam, 800, 600, (ref) => art(ref.key), () => true);
      const face = projectedObjectFaces(angle, house).at(-1)!;
      const faceCentre = face.points.reduce((p, v) => ({ x: p.x + v.x / face.points.length, y: p.y + v.y / face.points.length }), { x: 0, y: 0 });
      const at = { x: 400 + (faceCentre.x - cam.x) * cam.scale, y: 300 + (faceCentre.y - cam.y) * cam.scale };
      expect(pick(at)).toEqual({ kind: "building", id: "hall" });
      expect(pick({ x: at.x + 500, y: at.y })).toBeNull();
    }
    expect(house).toEqual(before);
  });

  it("lets solid foreground foliage block a building while geometric gaps remain pickable", () => {
    const hall = pictureObject("site:hall", { key: "hall", frame: 0 }, { x: 0, y: 0 }, 100, 300);
    hall.type = "building";
    const tree = pictureObject("tree", { key: "tree", frame: 0 }, { x: 0, y: 100 }, 192, 192);
    tree.type = "tree";
    const angle = { yaw: 0, tilt: 0.5 };
    const resolve = (ref: { key: string }) => art(ref.key);
    const sample = (f: ArtFrame) => { expect(f.image).not.toBe('resources-trees-tree'); return true; };
    const background = worldPicker(angle, [hall], camera, 200, 200, resolve, sample);
    const foreground = worldPicker(angle, [tree, hall], camera, 200, 200, resolve, sample);
    let blocked = 0, gaps = 0;
    for (let x = 55; x <= 145; x += 5) for (let y = 45; y <= 100; y += 5) {
      const at = { x, y };
      if (background(at)?.id !== 'hall') continue;
      if (foreground(at) === null) blocked++; else gaps++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(gaps).toBeGreaterThan(0);
  });

  it("uses flipped sprite pixels and keeps flat dressing non-interactive", () => {
    const hall = pictureObject("site:hall", { key: "hall", frame: 0, flipX: true }, { x: 0, y: 0 }, 100, 100);
    hall.type = "building";
    const flat = pictureObject("yard", { key: "yard", frame: 0 }, { x: 0, y: 0 }, 100, 100, true);
    const angle = { yaw: 0, tilt: .5 }, { width, depth, height } = localSize(hall);
    const sample = vi.fn((_frame: ArtFrame, u: number) => u < .5);
    const pick = worldPicker(angle, [hall, flat], camera, 200, 200, (ref) => art(ref.key), sample);
    for (const x of [-.25, .25]) {
      const v = objectVertex(hall, width * x, depth / 2 + 2, height * .45);
      expect(pick(screenPoint(angle, camera, 200, 200, v, v.z))).toEqual({ kind: "building", id: "hall" });
      expect(sample.mock.calls.at(-1)![1]).toBeCloseTo(.5 - x);
    }
    // Transparent facade pixels still have the building's actual wall behind them.
    expect(worldPicker("top", [flat], camera, 200, 200)({ x: 100, y: 80 })).toBeNull();
  });

  it("picks the procedural arena at an arbitrary angle without a sprite", () => {
    const arena = { ...worldObject("site:arena", "arena", 0, 0, 200, 120, 80), shape: "ellipse" as const };
    const angle = { yaw: 1.1, tilt: 0.45 };
    const pick = worldPicker(angle, [arena], camera, 400, 300);
    expect(pick(screenPoint(angle, camera, 400, 300, arena, 40))).toEqual({ kind: "building", id: "arena" });
    expect(pick({ x: 399, y: 299 })).toBeNull();
  });

  it("keeps small live characters tappable at overview zoom and scales up with them", () => {
    const foot = { x: 80, y: 130 }, far = agentBox(foot, 0.035), near = agentBox(foot, 1);
    expect(far.width).toBeGreaterThanOrEqual(12);
    expect(far.height).toBeGreaterThanOrEqual(16);
    expect(near.width).toBeGreaterThan(far.width);
    expect(inside({ x: 80, y: 120 }, far)).toBe(true);
    expect(inside({ x: 10, y: 120 }, far)).toBe(false);
  });
});
