import type { ActivityDestination, Capability } from "./activities";
import { SITES } from "./town";
import { VISITS } from "./districts";

/** Work sites reuse the existing farm beds, buildings and dry woodland/river verges. */
export const ACTIVITY_DESTINATIONS: ActivityDestination[] = [
  ...Object.entries(SITES).map(([id, site]) => {
    const visit = VISITS.find((v) => Math.abs(v.x - (site.door ?? site).x) < 1 && Math.abs(v.y - (site.door ?? site).y - 70) < 1);
    const capabilities: Capability[] = ["explore", "delivery-source", "delivery-target"];
    return { id, name: id === "arena" ? "Arena entrance" : visit?.name ?? id,
      x: (site.door ?? site).x, y: (site.door ?? site).y + (id === "arena" ? 46 : 70), capabilities, capacity: 32 };
  }),
  ...[[330, 490], [440, 505], [350, 560], [460, 575]].map(([x, y], i) => ({
    id: `north-farm-${i}`, name: "North Farm", x: x!, y: y! + 20, capabilities: ["farm", "explore"] as const, capacity: 24,
  })),
  { id: "woodland", name: "Woodland clearing", x: -450, y: 180, capabilities: ["gather", "explore"], capacity: 64 },
  { id: "north-forest", name: "North Forest", x: 760, y: -440, capabilities: ["gather", "explore"], capacity: 64 },
  { id: "western-grove", name: "Western Grove", x: -580, y: 1090, capabilities: ["gather", "explore"], capacity: 64 },
  { id: "riverside", name: "Riverside rocks", x: 2630, y: 1100, capabilities: ["gather", "explore"], capacity: 64 },
  { id: "south-grove", name: "South Grove", x: 1810, y: 2120, capabilities: ["gather", "explore"], capacity: 64 },
  { id: "terrace", name: "Terrace garden", x: 1925, y: 650, capabilities: ["explore"], capacity: 48 },
];
