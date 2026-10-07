import { inMatch, type Resident } from "./residents";

/** Town routines include house residents; match/replay actors never inflate these counts. */
export function townActivityTally(residents: readonly Resident[]) {
  const counts = { farming: 0, gathering: 0, delivery: 0, exploration: 0, sparring: 0, resting: 0 };
  for (const r of residents) {
    const state = r.worldActivity?.state;
    if (!state || r.standIn || r.place === "gate" || inMatch(r.place)) continue;
    if (state.phase === "resting" || state.phase === "returning" || state.activity === "idle") counts.resting++;
    else counts[state.activity]++;
  }
  return counts;
}
