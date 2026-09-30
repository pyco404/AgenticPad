/** The last stretch of a playback, after the rounds: who took the match. */
export const FINAL_MS = 1500;
/** Each round shows the hands, then the action, then the outcome, in equal thirds. */
const PHASES = ["hands", "action", "outcome"] as const;

export type Phase = (typeof PHASES)[number] | "final";

/**
 * Where a playback is `elapsed` ms in: which round, and which part of it. The
 * one clock every view of a playing match keeps to - the live feed, and the
 * village's arena - so none of them shows a round's outcome before the others.
 */
export function playhead(rounds: number, elapsed: number, playMs: number): { round: number; phase: Phase; within: number } {
  const per = (playMs - FINAL_MS) / Math.max(1, rounds);
  if (rounds === 0 || elapsed >= playMs - FINAL_MS) return { round: Math.max(0, rounds - 1), phase: "final", within: 0 };
  const round = Math.min(rounds - 1, Math.floor(Math.max(0, elapsed) / per));
  const through = Math.max(0, (elapsed - round * per) / per) * 3;
  const part = Math.min(2, Math.floor(through));
  // `within` is how far through its phase, 0 to 1: the arena's table spaces a round's choices by it.
  return { round, phase: PHASES[part]!, within: Math.min(1, through - part) };
}
