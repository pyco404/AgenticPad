import { describe, expect, it } from "vitest";
import { drawNegotiation, exactNegotiation, FAIR_SHARE, negotiate, playNegotiation } from "../src/negotiation/engine.js";
import { NEGOTIATION_PRESETS, NEGOTIATION_PRESET_NAMES } from "../src/negotiation/presets.js";
import { BOTTOM_LINES, InvalidNegotiationPolicyError, potIn, ROUNDS, tableFrom, validateNegotiationPolicy, type Move } from "../src/negotiation/rules.js";

const { Hardliner, Bluffer, Closer, Walker } = NEGOTIATION_PRESETS;
const fair = NEGOTIATION_PRESETS["Fair Dealer"];
/** A table that does one thing everywhere it can. */
const always = (move: Move) => tableFrom(() => move);

describe("negotiation rules", () => {
  it("replays a match exactly from its seed", () => {
    for (let seed = 1; seed <= 50; seed++) expect(playNegotiation(Hardliner, Closer, { seed })).toEqual(playNegotiation(Hardliner, Closer, { seed }));
  });
  it("draws every bottom line and both first proposers", () => {
    const seen = new Set<number>(), first = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) { const d = drawNegotiation(seed); seen.add(d.bottomLines.A); seen.add(d.bottomLines.B); first.add(d.firstProposer); }
    expect([...seen].sort((a, b) => a - b)).toEqual([...BOTTOM_LINES]);
    expect(first).toEqual(new Set(["A", "B"]));
  });
  it("splits the pot as claimed when the other side accepts", () => {
    const log = negotiate({ A: always("claim70"), B: always("accept") }, { A: 10, B: 50 }, "A");
    expect(log.outcome).toEqual({ kind: "deal", round: 1, split: { A: 70, B: 30 } });
    expect(log.net).toEqual({ A: 70 - FAIR_SHARE, B: 30 - FAIR_SHARE });
  });
  it("shrinks the pot each round, so a late deal is worth less to both", () => {
    expect([1, 2, 3, 4, 5, 6].map(potIn)).toEqual([100, 90, 80, 70, 60, 50]);
    // Both counter with 50 until round 4, then accept: an even split of the round-4 pot.
    const patient = tableFrom((s) => (s === "lateEven" ? "accept" : "claim50"));
    const log = negotiate({ A: patient, B: patient }, { A: 30, B: 30 }, "A");
    expect(log.outcome).toMatchObject({ kind: "deal", round: 4 });
    expect(log.payoff.A + log.payoff.B).toBe(70);
    expect(log.net.A).toBeLessThan(0);
  });
  it("leaves each side its bottom line after a walk-away or six rounds without a deal", () => {
    const walk = negotiate({ A: always("claim70"), B: always("walk") }, { A: 40, B: 20 }, "A");
    expect(walk.outcome).toEqual({ kind: "walk", round: 1, by: "B" });
    expect(walk.payoff).toEqual({ A: 40, B: 20 });
    const stubborn = negotiate({ A: always("claim70"), B: always("claim70") }, { A: 10, B: 50 }, "B");
    expect(stubborn.outcome).toEqual({ kind: "timeout" });
    expect(stubborn.rounds).toHaveLength(ROUNDS);
    expect(stubborn.payoff).toEqual({ A: 10, B: 50 });
  });
  it("lets the strategy change the result: same opponent, same draws, different tables", () => {
    const results = new Set(NEGOTIATION_PRESET_NAMES.map((name) => negotiate({ A: NEGOTIATION_PRESETS[name], B: Hardliner }, { A: 20, B: 30 }, "B").net.A));
    expect(results.size).toBeGreaterThan(2);
  });
  it("never lets two agents create points together: the two nets add up to 0 at most", () => {
    for (const a of NEGOTIATION_PRESET_NAMES) for (const b of NEGOTIATION_PRESET_NAMES)
      for (const bottomA of BOTTOM_LINES) for (const bottomB of BOTTOM_LINES) for (const first of ["A", "B"] as const) {
        const { net } = negotiate({ A: NEGOTIATION_PRESETS[a], B: NEGOTIATION_PRESETS[b] }, { A: bottomA, B: bottomB }, first);
        expect(net.A + net.B).toBeLessThanOrEqual(0);
        expect(Math.abs(net.A)).toBeLessThanOrEqual(40);
      }
  });
  it("reads an opening walk or accept as the most modest claim, and refuses a table with a missing move", () => {
    expect(validateNegotiationPolicy(always("walk")).open["30"]).toBe("claim50");
    expect(() => validateNegotiationPolicy({ ...always("accept"), lateEven: { "10": "fold" } })).toThrow(InvalidNegotiationPolicyError);
  });
});

describe("negotiation presets", () => {
  const net = (a: keyof typeof NEGOTIATION_PRESETS, b: keyof typeof NEGOTIATION_PRESETS) => exactNegotiation(NEGOTIATION_PRESETS[a], NEGOTIATION_PRESETS[b]);
  const average = (a: keyof typeof NEGOTIATION_PRESETS) => NEGOTIATION_PRESET_NAMES.reduce((s, b) => s + net(a, b), 0) / NEGOTIATION_PRESET_NAMES.length;
  const wins = (a: keyof typeof NEGOTIATION_PRESETS) => NEGOTIATION_PRESET_NAMES.filter((b) => net(a, b) - net(b, a) > 0.5).length;
  it("has no style that is best at everything: the one that wins most fights does not earn the most", () => {
    const byAverage = [...NEGOTIATION_PRESET_NAMES].sort((a, b) => average(b) - average(a));
    const mostWins = Math.max(...NEGOTIATION_PRESET_NAMES.map(wins));
    expect(wins(byAverage[0]!)).toBeLessThan(mostWins);
  });
  it("keeps the styles' average results within a few chips of each other", () => {
    const averages = NEGOTIATION_PRESET_NAMES.map(average);
    expect(Math.max(...averages) - Math.min(...averages)).toBeLessThan(8);
  });
  it("punishes two hardliners meeting: neither gives way, and both lose", () => {
    expect(net("Hardliner", "Hardliner")).toBeLessThan(-10);
    expect(net("Fair Dealer", "Fair Dealer")).toBeGreaterThan(net("Hardliner", "Hardliner"));
  });
  it("tables are exact: an expected result is an average over all fifty draws", () => {
    expect(exactNegotiation(Bluffer, Walker)).toBeCloseTo(exactNegotiation(Bluffer, Walker), 12);
    expect(Number.isInteger(exactNegotiation(fair, fair) * 50)).toBe(true);
    expect(exactNegotiation(Closer, Closer)).toBeLessThanOrEqual(0);
  });
});
