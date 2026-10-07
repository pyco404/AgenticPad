import { activityHash as hash } from "../../src/world/activities";

export const HALLS = ["tavern", "forge", "castle"] as const;
export type Hall = (typeof HALLS)[number];

/**
 * The hall an agent waits at, fixed by its id so it is always the same one, and
 * spread so the three fill about evenly. Salted, so it does not follow the look.
 */
export function hallOf(id: string): Hall {
  return HALLS[hash(`hall:${id}`) % HALLS.length] ?? "forge";
}

