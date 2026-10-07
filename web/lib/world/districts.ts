import { LAUNCH_SITE, SITES } from "./town";
import type { Point } from "./roads";

/** Shared by the scenery, destination routines and minimap. No match or wallet state lives here. */
export const DISTRICTS = [
  { id: "central", name: "Central Town", x: 1400, y: 1050, rx: 430, ry: 350, colour: "#87956b", terrain: "stone" },
  { id: "market", name: "Market", x: -60, y: 1170, rx: 330, ry: 300, colour: "#b39c72", terrain: "earth" },
  { id: "launch", name: "Launch", x: LAUNCH_SITE.x, y: LAUNCH_SITE.y, rx: 350, ry: 320, colour: "#86978b", terrain: "stone" },
  { id: "strategy", name: "Strategy", x: 600, y: 700, rx: 350, ry: 310, colour: "#829355", terrain: "garden" },
  { id: "legacy", name: "Legacy", x: 1730, y: 390, rx: 510, ry: 280, colour: "#9f9e82", terrain: "stone" },
  { id: "residential", name: "Homes", x: 730, y: 1420, rx: 380, ry: 300, colour: "#83945c", terrain: "garden" },
  { id: "farms", name: "Farmland", x: 380, y: 520, rx: 230, ry: 180, colour: "#a18a61", terrain: "earth" },
  { id: "woodland", name: "Woodland", x: -650, y: -250, rx: 620, ry: 650, colour: "#4d684e", terrain: "forest" },
  { id: "riverside", name: "Riverside", x: 2580, y: 770, rx: 250, ry: 300, colour: "#a3a486", terrain: "rock" },
] as const;

export const districtAt = (p: Point) => DISTRICTS.find((d) => ((p.x - d.x) / d.rx) ** 2 + ((p.y - d.y) / d.ry) ** 2 < 1)?.name ?? "Outer World";

export type Visit = Point & { name: string; rest: boolean };
/** Visits stop outside doors; collision checks choose the nearest safe forecourt. */
export const VISITS: Visit[] = [
  ...Object.entries(SITES).filter(([id]) => id !== "arena").map(([id, site]) => ({
    x: (site.door ?? site).x, y: (site.door ?? site).y + 70,
    name: ({ tavern: "Hiring Hall", castle: "Strategy Lab", forge: "Game Hall", library: "Hall of Fame", chapel: "Treasury", watchtower: "Lookout", alchemist: "Rulebook House", board: "Notice Board", bazaar: "Bazaar", launchpad: "Launch Pad" } as Record<string, string>)[id] ?? id, rest: false,
  })),
  { x: 1290, y: 1470, name: "Market stalls", rest: false },
  { x: 1430, y: 1244, name: "Plaza benches", rest: true },
  { x: 1925, y: 650, name: "Terrace garden", rest: true },
  { x: 1400, y: 1020, name: "Arena entrance", rest: false },
];
