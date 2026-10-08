import { describe, expect, it } from "vitest";
import { agentBox, inside, screenPoint, worldPicker } from "../web/lib/world/picking";
import { pictureObject, worldObject, type ArtFrame } from "../web/lib/world/model";
import { CAMERA_ANGLES, project } from "../web/lib/world/projection";

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
      const foot = screenPoint(angle, cam, 800, 600, house.metadata!.topAnchor!);
      expect(pick({ x: foot.x, y: foot.y - 40 })).toEqual({ kind: "building", id: "hall" });
      expect(pick({ x: foot.x + 500, y: foot.y })).toBeNull();
    }
    expect(house).toEqual(before);
  });

  it("lets foreground scenery block a building while transparent pixels pass through", () => {
    const hall = pictureObject("site:hall", { key: "hall", frame: 0 }, { x: 0, y: 0 }, 100, 300);
    hall.type = "building";
    const tree = pictureObject("tree", { key: "tree", frame: 0 }, { x: 0, y: 100 }, 100, 300);
    tree.type = "tree";
    const angle = { yaw: 0, tilt: 0.5 }, at = { x: 100, y: 50 };
    const resolve = (ref: { key: string }) => art(ref.key);
    expect(worldPicker(angle, [tree, hall], camera, 200, 200, resolve, () => true)(at)).toBeNull();
    expect(worldPicker(angle, [tree, hall], camera, 200, 200, resolve, (f) => f.image !== "tree")(at)).toEqual({ kind: "building", id: "hall" });
  });

  it("uses flipped sprite pixels and keeps flat dressing non-interactive", () => {
    const hall = pictureObject("site:hall", { key: "hall", frame: 0, flipX: true }, { x: 0, y: 0 }, 100, 100);
    hall.type = "building";
    const flat = pictureObject("yard", { key: "yard", frame: 0 }, { x: 0, y: 0 }, 100, 100, true);
    const pick = worldPicker("top", [hall, flat], camera, 200, 200, (ref) => art(ref.key), (_frame, u) => u < 0.5);
    expect(pick({ x: 125, y: 50 })).toEqual({ kind: "building", id: "hall" });
    expect(pick({ x: 75, y: 50 })).toBeNull();
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
