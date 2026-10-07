import type { Box } from "./world";

/** Shared scenic footprints: rendering, growth and navigation use the same ground. */
export const GARDEN_PONDS: Box[] = [
  { x0: 890, y0: 1410, x1: 1040, y1: 1520 },
  { x0: 1780, y0: 1470, x1: 1950, y1: 1590 },
  { x0: 1500, y0: -80, x1: 1670, y1: 35 },
];
