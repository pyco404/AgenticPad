import { describe, expect, it } from "vitest";
import { conviction, points, position, power, shares, filledShares, weight } from "../src/score.js";

// The holder score's arithmetic (docs/holder-agents.md, Scoring), checked
// against the figures the design doc quotes.

describe("points", () => {
  it("caps a win against any one opponent at 40, counts a loss in full, and floors the day at zero", () => {
    expect(points([30, 20])).toBe(50);
    expect(points([95])).toBe(40);
    expect(points([95, -30])).toBe(10);
    expect(points([-12])).toBe(0);
    expect(points([])).toBe(0);
  });
});

describe("power and weight", () => {
  it("runs conviction from 0 to 1 over 180 days, and stops there", () => {
    expect(conviction(0)).toBe(0);
    expect(conviction(90)).toBe(0.5);
    expect(conviction(400)).toBe(1);
  });

  it("gives four times the holding twice the position, capped at 1% of supply", () => {
    expect(position(0)).toBe(0);
    expect(position(0.0025)).toBeCloseTo(0.5);
    expect(position(0.01)).toBe(1);
    expect(position(0.5)).toBe(1);
  });

  it("matches the design doc's example table", () => {
    // [days held, share of supply, weight the doc quotes]
    const table: [number, number, number][] = [
      [0, 0, 1.0], // A: new today, minimum
      [30, 0, 1.43], // B
      [90, 0, 2.28], // C
      [180, 0, 3.55], // D
      [0, 0.01, 1.45], // E: a whale who arrived today
      [180, 0.01, 4.0], // F: the cap
    ];
    for (const [days, share, quoted] of table) {
      expect(weight(power({ convictionDays: days, shareOfSupply: share }))).toBeCloseTo(quoted, 2);
    }
  });

  it("keeps the weight between x1 and x4", () => {
    expect(weight(-1)).toBe(1);
    expect(weight(2)).toBe(4);
  });
});

describe("shares", () => {
  it("pays in proportion to score, holds every agent to 10%, and hands the rest to nobody", () => {
    const rows = [{ score: 900 }, { score: 50 }, { score: 50 }];
    const out = shares(rows);
    expect(out[0]).toBe(0.1);
    expect(out[1]).toBe(0.05);
    expect(out[2]).toBe(0.05);
    // What the cap held back stays in the wallet.
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(0.2);
  });

  it("pays nothing when nobody scored", () => {
    expect(shares([{ score: 0 }, { score: 0 }])).toEqual([0, 0]);
  });
});

describe("filled payout shares", () => {
  const rows = (...scores: number[]) => scores.map((score) => ({ score }));
  it("pays out in full: what the cap holds back goes to the others by score", () => {
    const out = filledShares(rows(415, 367, 351, 258, 247, 77, 71, 69, 67, 55, 20), 0.2);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(out[0]).toBe(0.2);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.2);
    // Below the cap, still proportional to score.
    expect(out[5]! / out[10]!).toBeCloseTo(77 / 20, 9);
  });
  it("is proportional to score when nobody reaches the cap", () => {
    expect(filledShares(rows(3, 1), 1)).toEqual([0.75, 0.25]);
  });
  it("leaves the rest in the wallet only when there are too few winners for the cap", () => {
    expect(filledShares(rows(10, 1, 1), 0.1)).toEqual([0.1, 0.1, 0.1]);
    expect(filledShares(rows(0, 5), 0.5)).toEqual([0, 0.5]);
  });
});
