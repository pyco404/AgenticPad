// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import type { Resident } from "../residents";
import type { BuildingLabel } from "./building";
import type { VillageMap } from "./map";
import { VillageScene, type VillageEvents } from "./scene";

export type { BuildingLabel } from "./building";

export type VillageHandle = {
  setResidents: (residents: Resident[]) => void;
  /** `pan` brings the camera to them: for a selection made outside the canvas. */
  select: (id: string | null, pan?: boolean) => void;
  /** How much of the canvas the bar and the page panel cover, in CSS pixels. */
  setInsets: (inset: { top: number; right: number; bottom: number }) => void;
  setNotes: (notes: Record<string, { text: string; lively: boolean }>) => void;
  setNight: (on: boolean) => void;
  /** How many wallets hold an agent: the village grows with it (growth.ts). */
  setHolders: (count: number) => void;
  /** The signed-in owner's agents, marked in gold. */
  setMine: (ids: ReadonlySet<string>) => void;
  /** Pans to the owner's next agent; false when none of theirs is in the village. */
  findMine: () => boolean;
  zoom: (step: 1 | -1) => void;
  destroy: () => void;
};

/** The canvas's backing store, as a multiple of its CSS size: physical pixels, capped to keep memory bounded. */
const pixelRatio = () => Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);

/**
 * Starts the village in `container`. The only way in for the rest of the app:
 * everything Phaser stays behind this module, which the page loads on demand,
 * so the engine is never part of the server render or another page's bundle.
 *
 * The canvas is sized in physical pixels and zoomed back to CSS pixels, because
 * Phaser sizes it in CSS pixels on its own and a high-density screen then
 * shows the art blurred.
 */
export async function startVillage(
  container: HTMLElement,
  opts: { base: string; buildings: BuildingLabel[]; still: boolean; nameFont: string; events: VillageEvents },
): Promise<VillageHandle> {
  const res = await fetch(`${opts.base}/map.json`);
  if (!res.ok) throw new Error(`village map: ${res.status}`);
  const map = (await res.json()) as VillageMap;

  const scene = new VillageScene(map, opts);
  const size = () => {
    const r = pixelRatio();
    return { r, width: Math.max(1, Math.floor(container.clientWidth * r)), height: Math.max(1, Math.floor(container.clientHeight * r)) };
  };
  const initial = size();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    backgroundColor: "#141a24",
    // Nearest-neighbour everywhere: it is pixel art.
    pixelArt: true,
    banner: false,
    scene: [scene],
    scale: { mode: Phaser.Scale.NONE, width: initial.width, height: initial.height, zoom: 1 / initial.r },
    // Only what happens on the canvas itself: by default Phaser also listens on the window, so letting go of
    // a button or a page card that lies over a building would count as a tap on the building.
    input: { mouse: true, touch: true, windowEvents: false },
  });

  const resize = () => {
    const s = size();
    if (game.scale.zoom !== 1 / s.r) game.scale.setZoom(1 / s.r);
    game.scale.resize(s.width, s.height);
    // Phaser keeps the canvas's CSS size from before when the density and the size change together - a
    // phone turned desktop in the browser's device mode - and the village is drawn squashed into a corner.
    // Its on-screen size is always the container's.
    game.canvas.style.width = `${container.clientWidth}px`;
    game.canvas.style.height = `${container.clientHeight}px`;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  // A change of device can move the density without the container's size changing, or before it does.
  window.addEventListener("resize", resize);
  // A window dragged to a screen of another density changes the ratio and not the size.
  let density: MediaQueryList | null = null;
  const watchDensity = () => {
    density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener("change", onDensity, { once: true });
  };
  const onDensity = () => {
    resize();
    watchDensity();
  };
  watchDensity();

  return {
    setResidents: (r) => scene.setResidents(r),
    select: (id, pan = false) => scene.select(id, pan),
    setInsets: (inset) => scene.setInsets(inset),
    setNotes: (notes) => scene.setNotes(notes),
    setNight: (on) => scene.setNight(on),
    setHolders: (count) => scene.setHolders(count),
    setMine: (ids) => scene.setMine(ids),
    findMine: () => scene.findMine(),
    zoom: (step) => scene.zoomBy(step),
    destroy: () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      density?.removeEventListener("change", onDensity);
      game.destroy(true);
    },
  };
}
