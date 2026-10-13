import { tableFrom, type NegotiationPolicy } from "./rules.js";

/**
 * Negotiation's presets (docs/negotiation.md): five styles an agent is given automatically, each a
 * filled table. A bottom line is what the agent keeps without a deal, so a high one makes it harder
 * to please and a low one makes a deal worth taking.
 */
export const NEGOTIATION_PRESETS = {
  /** Claims the most, gives ground only late, walks when its bottom line is high. */
  Hardliner: tableFrom((s, b) => ({
    open: "claim70",
    counterHigh: b >= 40 ? "walk" : "claim70",
    counterFair: "claim70",
    counterEven: b >= 50 ? "claim60" : "accept",
    lateHigh: b >= 40 ? "walk" : "claim60",
    lateEven: b >= 50 ? "walk" : "accept",
  } as const)[s]),
  /** Asks for half, takes any fair offer, rarely walks. */
  "Fair Dealer": tableFrom((s, b) => ({
    open: b >= 40 ? "claim60" : "claim50",
    counterHigh: b <= 20 ? "accept" : "claim50",
    counterFair: b <= 30 ? "accept" : "claim50",
    counterEven: "accept",
    lateHigh: b <= 30 ? "accept" : "walk",
    lateEven: "accept",
  } as const)[s]),
  /** Claims 70 whatever it holds, and folds into a deal late. */
  Bluffer: tableFrom((s, b) => ({
    open: "claim70",
    counterHigh: b >= 40 ? "claim60" : "claim70",
    counterFair: b <= 20 ? "claim70" : "claim60",
    counterEven: "accept",
    lateHigh: b <= 30 ? "accept" : "claim60",
    lateEven: "accept",
  } as const)[s]),
  /** Opens at 60 and values a deal over squeezing: accepts early. */
  Closer: tableFrom((s, b) => ({
    open: "claim60",
    counterHigh: b <= 30 ? "accept" : "claim60",
    counterFair: "accept",
    counterEven: "accept",
    lateHigh: b <= 40 ? "accept" : "walk",
    lateEven: "accept",
  } as const)[s]),
  /** Holds out for its price and walks away the moment it is not offered. */
  Walker: tableFrom((s, b) => ({
    open: b >= 30 ? "claim70" : "claim60",
    counterHigh: "walk",
    counterFair: b >= 30 ? "walk" : "accept",
    counterEven: b >= 50 ? "walk" : "accept",
    lateHigh: "walk",
    lateEven: b >= 50 ? "walk" : "accept",
  } as const)[s]),
} satisfies Record<string, NegotiationPolicy>;

export type NegotiationPresetName = keyof typeof NEGOTIATION_PRESETS;
export const NEGOTIATION_PRESET_NAMES = Object.keys(NEGOTIATION_PRESETS) as NegotiationPresetName[];
