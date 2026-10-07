import { describe, expect, it } from "vitest";
import { layOutNames, namesInView, shortName, type Box, type NameLabel } from "../web/app/village/game/labels.js";

// The village's names (web/app/village/game/labels.ts). Presentation only.

const box = (n: NameLabel, dy: number): Box => ({ x0: n.x - n.width / 2, y0: n.y - n.height + dy, x1: n.x + n.width / 2, y1: n.y + dy });
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const name = (id: string, x: number, y: number, forced = false): NameLabel => ({ id, x, y, width: 80, height: 14, forced });

/** Every name that shows, where it shows. */
function shown(names: NameLabel[], placed: ReturnType<typeof layOutNames>): Box[] {
  return names.flatMap((n) => {
    const p = placed.get(n.id)!;
    return p.shown ? [box(n, p.dy)] : [];
  });
}

describe("the village's names", () => {
  it("bounds collision work for 1,000 residents, preserving selected and owner labels and restoring names after panning", () => {
    const names = Array.from({ length: 1000 }, (_, i) => name(`a${i}`, i * 10, 100, i === 999));
    const first = namesInView(names, { x0: -100, y0: 0, x1: 11_000, y1: 200 }, { x: 0, y: 100 });
    expect(first).toHaveLength(150);
    expect(first).toContainEqual(names[999]);
    expect(first).toContainEqual(names[0]);
    const shifted = namesInView(names, { x0: 8500, y0: 0, x1: 11_000, y1: 200 }, { x: 9990, y: 100 });
    expect(shifted).toHaveLength(150);
    expect(shifted).not.toContainEqual(names[0]);
    expect(shifted).toContainEqual(names[998]);
  });

  it("never shows two names over each other, however many crowd one spot", () => {
    const names = Array.from({ length: 24 }, (_, i) => name(`a${i}`, 500 + (i % 5) * 9, 400 + Math.floor(i / 5) * 4));
    const out = shown(names, layOutNames(names, [], { x: 500, y: 400 }));
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i]!, out[j]!)).toBe(false);
    // Nudging up and down lets three share one spot before any is hidden.
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("nudges a name up, then down, before hiding it", () => {
    const names = [name("a", 100, 100), name("b", 100, 100), name("c", 100, 100), name("d", 100, 100)];
    const placed = layOutNames(names, [], { x: 100, y: 100 });
    expect([...placed.values()].map((p) => (p.shown ? p.dy : "hidden")).sort()).toEqual([-15, 0, 15, "hidden"].sort());
  });

  it("lets a building's name win: an agent's name moves off it or hides", () => {
    const building: Box = { x0: 0, y0: 80, x1: 300, y1: 120 };
    const names = [name("a", 150, 110)];
    const placed = layOutNames(names, [building], { x: 0, y: 0 });
    for (const b of shown(names, placed)) expect(overlaps(b, building)).toBe(false);
  });

  it("keeps the nearest the middle of the screen, and always shows a hovered or selected one", () => {
    const centre = { x: 100, y: 100 };
    // Four names over one another, one spot apart: three fit, nudged; the furthest from the middle hides.
    const names = [name("far", 130, 100), name("near", 100, 100), name("mid", 110, 100), name("next", 120, 100)];
    const placed = layOutNames(names, [], centre);
    expect(placed.get("near")!.shown).toBe(true);
    expect(placed.get("far")!.shown).toBe(false);
    // Hovered or selected, the furthest one shows, ahead of the rest.
    const picked = layOutNames([...names.slice(1), name("far", 130, 100, true)], [], centre);
    expect(picked.get("far")!.shown).toBe(true);
  });

  it("shows names without the roster's number", () => {
    expect(shortName("Pitchfork-1113")).toBe("Pitchfork");
    expect(shortName("Ash-9")).toBe("Ash");
    expect(shortName("Big-Bad Wolf")).toBe("Big-Bad Wolf");
    expect(shortName("R2-D2")).toBe("R2-D2");
  });
});
