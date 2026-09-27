// Cases for the Rust replay's parity test: random tables and seeds, played by
// the real engine. Run from the repo root: npx tsx spikes/oracle/parity.mts
import { writeFileSync } from "node:fs";
import { playMatch } from "../../src/engine.js";
import { EDGE_KEYS, packPolicy, policyAgent, SITUATIONS, type Policy, type Situation } from "../../src/agents/policy.js";
import { mulberry32, nextUint32 } from "../../src/rng.js";
import { PRESET_NAMES } from "../../src/presets.js";
import { snapshotPreset } from "../../src/db/runner.js";
import type { Action } from "../../src/types.js";

const rng = mulberry32(2026);
const randomTable = (): Policy => {
  const p = {} as Record<Situation, Record<string, Action>>;
  for (const s of SITUATIONS)
    for (const e of EDGE_KEYS) {
      const opts: Action[] = s.startsWith("vsRaise") ? ["fold", "call"] : ["fold", "call", "raise"];
      (p[s] ??= {})[e] = opts[Math.floor(rng() * opts.length)]!;
    }
  return p as Policy;
};
const pool = [...PRESET_NAMES.map((n) => snapshotPreset(n)), ...Array.from({ length: 60 }, randomTable)];
const cases = [];
for (let i = 0; i < 20_000; i++) {
  const a = pool[Math.floor(rng() * pool.length)]!;
  const b = pool[Math.floor(rng() * pool.length)]!;
  const seed = nextUint32(rng);
  const log = playMatch(policyAgent(a), policyAgent(b), { seed });
  cases.push({ a: packPolicy(a).toString(), b: packPolicy(b).toString(), seed, netA: log.nets.A, netB: log.nets.B, rounds: log.rounds.length });
}
writeFileSync(new URL("./parity.json", import.meta.url), JSON.stringify(cases));
console.log(`wrote ${cases.length} cases`);
