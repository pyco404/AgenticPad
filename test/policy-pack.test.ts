import { describe, expect, it } from "vitest";
import { EDGE_KEYS, InvalidPolicyError, packPolicy, SITUATIONS, unpackPolicy, type Policy } from "../src/agents/policy.js";
import { PRESET_NAMES } from "../src/presets.js";
import { snapshotPreset } from "../src/db/runner.js";
import type { Action } from "../src/types.js";

// The table as the settlement program records it. The program's own check,
// `strategy_valid`, reads the same layout: 30 two-bit cells, situation-major,
// with the last ten cells (facing a raise) limited to fold and call. If this
// file and that function disagree, owners commit tables the program reads as
// something else - so the layout is pinned here cell by cell, and the chain
// test round-trips a real table through the program.

const fill = (action: Action): Policy =>
  Object.fromEntries(
    SITUATIONS.map((s) => [s, Object.fromEntries(EDGE_KEYS.map((e) => [e, s.startsWith("vsRaise") && action === "raise" ? "call" : action]))]),
  ) as unknown as Policy;

describe("a strategy table, packed for the chain", () => {
  it("round-trips every preset exactly", () => {
    for (const name of PRESET_NAMES) {
      const table = snapshotPreset(name);
      expect(unpackPolicy(packPolicy(table))).toEqual(table);
    }
  });

  it("puts each cell where the program looks for it", () => {
    expect(packPolicy(fill("fold"))).toBe(0n);
    // Situation-major, edge-minor, two bits each: cell i is bits 2i and 2i+1.
    for (const [si, situation] of SITUATIONS.entries()) {
      for (const [ei, edge] of EDGE_KEYS.entries()) {
        const table = fill("fold") as Record<string, Record<string, Action>>;
        const action: Action = situation.startsWith("vsRaise") ? "call" : "raise";
        table[situation] = { ...table[situation], [edge]: action };
        const cell = BigInt(si * EDGE_KEYS.length + ei);
        expect(packPolicy(table as Policy)).toBe((action === "raise" ? 2n : 1n) << (2n * cell));
      }
    }
  });

  it("keeps the ten cells facing a raise where the program expects them: 20 to 29", () => {
    const facing = SITUATIONS.flatMap((s, si) => (s.startsWith("vsRaise") ? EDGE_KEYS.map((_, ei) => si * EDGE_KEYS.length + ei) : []));
    expect(facing).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("refuses a cell holding no action, and anything above the table", () => {
    expect(() => unpackPolicy(3n)).toThrow(InvalidPolicyError);
    expect(() => unpackPolicy(1n << 60n)).toThrow(InvalidPolicyError);
  });
});
