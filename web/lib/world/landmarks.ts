import type { Box } from "./world";

/** Shared scenic footprints: rendering, growth and navigation use the same ground. */
export const GARDEN_PONDS: Box[] = [
  { x0: 890, y0: 1410, x1: 1040, y1: 1520 },
  { x0: 1780, y0: 1470, x1: 1950, y1: 1590 },
  { x0: 1500, y0: -80, x1: 1670, y1: 35 },
];

/** Garden dressing is spatial data, shared by Top and the alternate elevations. */
export const GARDEN_RAILS = [[660, 285, 120], [1850, 285, 145], [1050, 1380, 150], [1570, 1400, 160], [440, 1050, 85], [2270, 1060, 90]] as const;
export const GARDEN_BENCHES = [[1160, 235], [1550, 215], [1230, 1310], [1570, 1320], [770, 1400], [2040, 1420]] as const;
export const SOLAR_LIGHTS = [{ x: 1100, y: 1192 }, { x: 1700, y: 1192 }];
