import type { WorldModel, WorldObject } from "../../../lib/world/model";
import { PIECES } from "../../../lib/world/pieces";
import { PIECE_ART } from "../../../lib/world/growth";
import { referenceArt } from "../../../lib/world/reference-art";
import { warm, warmMap } from "./palette";

export type SpriteMaterial = { image: HTMLImageElement; width: number; height: number };
export type ProjectedMaterials = { grass?: CanvasPattern; water?: CanvasPattern; sprites: Map<string, SpriteMaterial> };

/** Existing Top artwork only; missing/failed images keep the procedural material fallback. */
export function loadProjectedMaterials(world: WorldModel, ready: () => void): { materials: ProjectedMaterials; dispose: () => void } {
  const materials: ProjectedMaterials = { sprites: new Map() }, images: HTMLImageElement[] = [];
  let disposed = false;
  const load = (src: string, done: (image: HTMLImageElement) => void) => {
    const image = new Image(); images.push(image);
    image.onload = () => { if (!disposed) { done(image); ready(); } };
    image.src = src;
  };
  const pattern = (src: string, frame: number, key: "grass" | "water") => load(src, (image) => {
    const tile = document.createElement("canvas"); tile.width = tile.height = 64;
    const ctx = tile.getContext("2d")!, columns = Math.floor(image.width / 64);
    ctx.drawImage(image, frame % columns * 64, Math.floor(frame / columns) * 64, 64, 64, 0, 0, 64, 64);
    materials[key] = ctx.createPattern(tile, "repeat") ?? undefined;
  });
  const base = world.map.textures.find((t) => t.key === world.map.base);
  if (base) pattern(`/village/${warmMap(base.path)}`, world.map.baseFrame ?? 0, "grass");
  pattern("/village/warm/village/tiny-swords/Terrain/Water/Water.png", 0, "water");
  const needed = new Set(world.objects.filter((o) => o.type === "tree" || o.type === "building" || o.type === "prop" || o.type === "stall").map((o) => o.metadata?.texture));
  needed.add("resources-trees-tree");
  const sources = new Map<string, { src: string; width?: number; height?: number }>();
  for (const t of world.map.textures) sources.set(t.key, { src: `/village/${warmMap(t.path)}`, width: t.frameWidth, height: t.frameHeight });
  for (const [id, site] of Object.entries(world.sites)) if (id !== "arena") sources.set(`building-${id}`, {
    src: referenceArt(site.art), width: site.sheet?.width, height: site.sheet?.height,
  });
  sources.set("resources-trees-tree", { src: "/village/reference/trees.png", width: 192, height: 192 });
  for (const p of PIECES) if (p.image) sources.set(p.key, { src: warm(referenceArt(p.image)), width: p.sheet?.frameWidth, height: p.sheet?.frameHeight });
  for (const [key, p] of Object.entries(PIECE_ART)) {
    sources.set(key, { src: warm(referenceArt(p.src)), width: "frames" in p ? p.width : undefined, height: "frames" in p ? p.height : undefined });
    needed.add(key);
  }
  for (const key of needed) {
    const source = key && sources.get(key);
    if (key && source) load(source.src, (image) => materials.sprites.set(key, { image, width: source.width ?? image.width, height: source.height ?? image.height }));
  }
  return { materials, dispose: () => { disposed = true; for (const image of images) image.onload = null; } };
}

export { VILLAGE_MATERIAL, buildingMaterial } from "../../../lib/world/object-materials";
