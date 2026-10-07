/** public/village/map.json, as scripts/village-import.ts writes it. */
export type VillageMap = {
  /** The world's size, and where its top-left corner is: the world grows round Old Town into negative coordinates (world.ts). */
  world: { width: number; height: number; x0?: number; y0?: number };
  base: string;
  /** The frame of `base` repeated under everything: plain ground, with no edge. */
  baseFrame?: number;
  /** [column, row, tileset, frame] */
  terrain: [number, number, string, number][];
  /** Road styles share their sampled center lines with navigation. */
  paths: { style: string; width: number; points: [number, number][] }[];
  /** Stone plazas, one at each crossroads of the world's roads. */
  plazas?: [number, number][];
  /** k: texture, f: frame, s: scale, d: fixed depth, a: animation to play. */
  decorations: { k: string; f?: number; x: number; y: number; s: number; d?: number; a?: string }[];
  buildings: { id: string; x: number; y: number }[];
  spawn: { x: number; y: number };
  heroScale: number;
  textures: { key: string; path: string; frameWidth?: number; frameHeight?: number }[];
  animations: { key: string; texture: string; start: number; end: number; frameRate: number; repeat: number }[];
};

