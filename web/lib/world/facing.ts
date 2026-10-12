/**
 * Which side of a character a world camera sees. A character's heading is its own, in the world
 * (Top's names: front is south, back north, left west, right east); the camera only changes which
 * side of it shows. Characters never turn to face the camera.
 */
export type Side = "front" | "back" | "left" | "right";
/** Each heading as a world direction: x grows east, y south. */
export const HEADING: Record<Side, readonly [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };
/** How far past a diagonal the camera turns before the next side shows, so a slow orbit does not flicker. */
export const DEAD_BAND = 6 * Math.PI / 180;

/** The side shown to a camera turned `yaw` about the world, held while `previous` is within the dead band. */
export function shownSide(heading: Side, yaw: number, previous: Side = heading): Side {
  const [hx, hy] = HEADING[heading], s = Math.sin(yaw), c = Math.cos(yaw);
  const toward = hx * s + hy * c, across = hx * c - hy * s;
  const score: Record<Side, number> = { front: toward, back: -toward, right: across, left: -across };
  if (score[previous] >= Math.cos(Math.PI / 4 + DEAD_BAND)) return previous;
  return (Object.keys(score) as Side[]).reduce((a, b) => score[b] > score[a] ? b : a);
}
