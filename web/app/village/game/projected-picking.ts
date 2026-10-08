import type { ArtFrame, ArtRef, WorldObject } from "../../../lib/world/model";
import type { Projection } from "../../../lib/world/projection";
import { worldPicker as geometryPicker } from "../../../lib/world/picking";
import type { ProjectionCamera } from "./projected-art";
export { agentBox, inside } from "../../../lib/world/picking";
export type { ScreenBox, WorldTarget } from "../../../lib/world/picking";

const masks = new WeakMap<object, Map<string, Uint8ClampedArray>>();
/** Cache alpha once per loaded frame, so transparent sprite margins are empty space. */
function opaque(frame: ArtFrame, u: number, v: number): boolean {
  const image = frame.image as CanvasImageSource;
  let frames = masks.get(image);
  if (!frames) { frames = new Map(); masks.set(image, frames); }
  const key = `${frame.x},${frame.y},${frame.width},${frame.height}`;
  let pixels = frames.get(key);
  if (!pixels) {
    const canvas = document.createElement("canvas"); canvas.width = frame.width; canvas.height = frame.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    pixels = ctx.getImageData(0, 0, frame.width, frame.height).data; frames.set(key, pixels);
  }
  const x = Math.max(0, Math.min(frame.width - 1, Math.floor(u * frame.width)));
  const y = Math.max(0, Math.min(frame.height - 1, Math.floor(v * frame.height)));
  return pixels[(y * frame.width + x) * 4 + 3]! > 20;
}

/** Add browser pixel masks to the DOM-free camera picking geometry. */
export function worldPicker(view: Projection, objects: readonly WorldObject[], camera: ProjectionCamera, width: number, height: number,
  art?: (ref: ArtRef) => ArtFrame | null) {
  return geometryPicker(view, objects, camera, width, height, art, opaque);
}
