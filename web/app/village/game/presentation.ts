import type { ActivityState } from "./activities";
import type { Point } from "./roads";

/** Compress the floor while upright art retains its proportions: an elevated orthographic view. */
export const FLOOR_RATIO = 0.78;
export type ViewMode = "world" | "district" | "agent";
export const DISTRICT_ZOOM = 1.05;
export const AGENT_ZOOM = 2.4;
export const MAX_ZOOM = 3.5;

/** Physical canvas pixels to world units, accounting for the navbar/page sheet. */
export function framedCentre(point: Point, dx: number, dy: number, zoom: number): Point {
  return { x: point.x + dx / zoom, y: point.y + dy / (zoom * FLOOR_RATIO) };
}

/** Frame-rate independent camera damping, including background-tab recovery. */
export function followAmount(delta: number, still: boolean): number {
  return still ? 1 : 1 - Math.exp(-Math.max(0, Math.min(delta, 100)) / 140);
}

export function viewMode(zoom: number, following: boolean): ViewMode {
  return following || zoom >= 1.8 ? "agent" : zoom >= 0.75 ? "district" : "world";
}

export type WorldView = {
  mode: ViewMode;
  following: boolean;
  selected: { id: string; name: string; house: boolean; activity: string; destination: string; activityState: ActivityState | null; x: number; y: number } | null;
  bounds: { x: number; y: number; width: number; height: number };
};
