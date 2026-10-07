/**
 * Where the village's names go, so no two overlap. Pure, and free of Phaser,
 * so the root suite can test it; the scene runs it every frame.
 *
 * Building names always win: they are placed first and never move. Then each
 * agent's name in turn, most important first - the hovered, selected or
 * owner's agent, then whoever is nearest the middle of the screen - tries its
 * own spot, then a nudge up, then a nudge down. A name with nowhere free is
 * hidden, and shows again on hover or tap, which puts it first. A name that
 * must show (hovered, selected, the owner's) shows even with nowhere free.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** A name as it would sit: centred on x, its bottom on y. */
export type NameLabel = { id: string; x: number; y: number; width: number; height: number; forced: boolean };

/** How far a name moved from its spot, and whether it shows. */
export type Placement = { dy: number; shown: boolean };

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Off-screen names need no collision work. Keep a bounded set of ordinary names, with selected/owner names first. */
export function namesInView(names: readonly NameLabel[], view: Box, centre: { x: number; y: number }, limit = 150): NameLabel[] {
  const visible = names.filter((n) => overlaps(view, { x0: n.x - n.width / 2, x1: n.x + n.width / 2, y0: n.y - n.height, y1: n.y }));
  const forced = visible.filter((n) => n.forced);
  const ordinary = visible.filter((n) => !n.forced).sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));
  return [...forced, ...ordinary.slice(0, Math.max(0, limit - forced.length))];
}

export function layOutNames(names: readonly NameLabel[], buildings: readonly Box[], centre: { x: number; y: number }, gap = 1): Map<string, Placement> {
  const taken: Box[] = [...buildings];
  const out = new Map<string, Placement>();
  const order = [...names].sort(
    (a, b) => Number(b.forced) - Number(a.forced) || Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y),
  );
  for (const n of order) {
    const box = (dy: number): Box => ({ x0: n.x - n.width / 2, y0: n.y - n.height + dy, x1: n.x + n.width / 2, y1: n.y + dy });
    const step = n.height + gap;
    const dy = [0, -step, step].find((d) => !taken.some((t) => overlaps(box(d), t)));
    if (dy !== undefined) {
      taken.push(box(dy));
      out.set(n.id, { dy, shown: true });
    } else if (n.forced) {
      taken.push(box(0));
      out.set(n.id, { dy: 0, shown: true });
    } else out.set(n.id, { dy: 0, shown: false });
  }
  return out;
}

/** The name the village shows: without the "-1234" the roster adds, which stays in the full name on hover and on the agent's page. */
export const shortName = (name: string) => name.replace(/-\d+$/, "");
