import { WORLD } from "./world";

/** Flat terrain layers stay below the feet of actors anywhere in the world, including its negative-y north. */
export const groundDepth = (layer: number): number => WORLD.y0 - 1000 + layer;
