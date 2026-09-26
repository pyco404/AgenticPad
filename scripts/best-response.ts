/**
 * How much can one table take from another, if the matchmaker is hostile?
 *
 * The question behind settler hardening: a stolen key that controls pairing
 * (but, with tables committed on chain, cannot change a table or a result)
 * can still pair a victim against an agent built to beat that victim's table.
 * That is winning at the game rather than forging it, and its size is the
 * best response's edge - which this measures, exactly, per match.
 *
 * The search is hill-climbing over the attacker's 30 cells with exact expected
 * values and random restarts. It is a lower bound on the true best response:
 * the table space (3^20 * 2^10, about 3.6e12) is too large to enumerate. The
 * restart count is reported alongside how many restarts reached the best
 * value, which is the evidence for how close the bound is.
 *
 *   npx tsx scripts/best-response.ts [restarts] [randomVictims]
 */
import { seatAveragedNet } from "../src/exact.js";
import { policyAgent, SITUATIONS, EDGE_KEYS, type Policy, type Situation } from "../src/agents/policy.js";
import { PRESETS, PRESET_NAMES } from "../src/presets.js";
import { mulberry32, type Rng } from "../src/rng.js";
import type { Action, Agent } from "../src/types.js";

const RESTARTS = Number(process.argv[2] ?? 60);
const RANDOM_VICTIMS = Number(process.argv[3] ?? 40);

type Cell = { situation: Situation; edge: string; options: readonly Action[] };
const CELLS: Cell[] = SITUATIONS.flatMap((situation) =>
  EDGE_KEYS.map((edge) => ({
    situation,
    edge,
    // Facing a raise there is no re-raise.
    options: situation.startsWith("vsRaise") ? (["fold", "call"] as const) : (["fold", "call", "raise"] as const),
  })),
);

function randomPolicy(rng: Rng): Policy {
  const p = {} as Record<Situation, Record<string, Action>>;
  for (const c of CELLS) (p[c.situation] ??= {})[c.edge] = c.options[Math.floor(rng() * c.options.length)]!;
  return p as Policy;
}

const clone = (p: Policy): Policy =>
  Object.fromEntries(SITUATIONS.map((s) => [s, { ...p[s] }])) as unknown as Policy;

/** Seat-averaged exact net of `table` against `victim`, per match, band B chips. */
const edgeOf = (table: Policy, victim: Agent) => seatAveragedNet(policyAgent(table), victim);

/** One hill-climb from a random start: change one cell at a time while it helps. */
function climb(victim: Agent, rng: Rng): { table: Policy; ev: number } {
  let table = randomPolicy(rng);
  let ev = edgeOf(table, victim);
  for (let improved = true; improved; ) {
    improved = false;
    const order = [...CELLS].sort(() => rng() - 0.5);
    for (const c of order) {
      for (const option of c.options) {
        if (table[c.situation][c.edge] === option) continue;
        const next = clone(table);
        (next[c.situation] as Record<string, Action>)[c.edge] = option;
        const nextEv = edgeOf(next, victim);
        if (nextEv > ev + 1e-9) {
          table = next;
          ev = nextEv;
          improved = true;
        }
      }
    }
  }
  return { table, ev };
}

function bestResponse(victim: Agent, seed: number) {
  const rng = mulberry32(seed);
  let best = { table: randomPolicy(rng), ev: -Infinity };
  const found: number[] = [];
  for (let i = 0; i < RESTARTS; i++) {
    const r = climb(victim, rng);
    found.push(r.ev);
    if (r.ev > best.ev) best = r;
  }
  const hits = found.filter((v) => v > best.ev - 1e-6).length;
  return { ...best, hits };
}

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(3);

// A single evaluation's cost, so the run's length is predictable.
{
  const t = performance.now();
  for (let i = 0; i < 20; i++) edgeOf(randomPolicy(mulberry32(i)), PRESETS.Anchor);
  console.log(`one exact evaluation: ${((performance.now() - t) / 20).toFixed(2)} ms`);
}

console.log(`\nband B stakes (ante 4 / bet 10 / raised 20); a match moves at most 40.`);
console.log(`best response found with ${RESTARTS} restarts per victim; "hits" = restarts that reached it.\n`);

// Context: how the presets do against each other, i.e. what ordinary play looks like.
console.log("presets against each other (row's net per match, seat-averaged):");
for (const a of PRESET_NAMES) {
  console.log(`  ${a.padEnd(7)} ` + PRESET_NAMES.map((b) => `${b}: ${fmt(seatAveragedNet(PRESETS[a], PRESETS[b]))}`).join("  "));
}

console.log("\nbest response against each preset:");
const presetResults: number[] = [];
for (const name of PRESET_NAMES) {
  const t = performance.now();
  const r = bestResponse(PRESETS[name], 1_000 + name.length);
  presetResults.push(r.ev);
  console.log(`  vs ${name.padEnd(7)} ${fmt(r.ev)} chips/match   (${r.hits}/${RESTARTS} hits, ${((performance.now() - t) / 1000).toFixed(1)}s)`);
}

console.log(`\nbest response against ${RANDOM_VICTIMS} random tables (a stand-in for arbitrary written strategies):`);
const rng = mulberry32(7);
const randomResults: number[] = [];
for (let i = 0; i < RANDOM_VICTIMS; i++) {
  const victim = policyAgent(randomPolicy(rng));
  randomResults.push(bestResponse(victim, 5_000 + i).ev);
}
randomResults.sort((a, b) => a - b);
const q = (p: number) => randomResults[Math.min(randomResults.length - 1, Math.floor(p * randomResults.length))]!;
console.log(`  min ${fmt(q(0))}  median ${fmt(q(0.5))}  p90 ${fmt(q(0.9))}  max ${fmt(randomResults.at(-1)!)}`);

console.log(`\nworst case against a preset: ${fmt(Math.max(...presetResults))} chips/match of a possible 40.`);
