/** A launch's stages, and what a failure at each means. Kept apart so the adapter and the mock can both read them without importing each other. */

/** The launch's stages, in order. Agents go live only after the token is verified on chain. */
export const STAGES = ["created", "feeSplit", "authorityLocked", "verified", "agentsLive"] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = "pending" | "in-progress" | "done" | "failed";

/** What a failure at each stage means for the token, in a sentence the tracker shows. */
export const FAILURE: Record<Stage, string> = {
  created: "pump.fun did not create the token. Nothing was launched.",
  feeSplit: "The fee split could not be set. The token is on pump.fun, but it is not in the game and its holders get no agents.",
  authorityLocked: "The update authority could not be locked. The token is on pump.fun, but it is not in the game and its holders get no agents.",
  verified: "The on-chain check did not match. The token is on pump.fun, but it is not in the game and its agents will not appear.",
  agentsLive: "The token is verified, but its agents could not be placed in the village yet.",
};
