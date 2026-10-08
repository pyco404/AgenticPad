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

/** Timber, plaster and thatch sampled from the reference cottages and landmark sprites. */
export const VILLAGE_MATERIAL = {
  plaster: "#d6bd88", plasterShade: "#947b50", timber: "#694022", outline: "#36281e",
  stone: "#9d9d86", stoneLight: "#e1d5af", stoneShade: "#6d7666",
  goldRoof: "#d59b31", thatchLight: "#f4cb65", redRoof: "#a4452d", redLight: "#d77943",
  greenRoof: "#386b49", greenLight: "#80a264", window: "#234743", glass: "#7bacaa", glow: "#efb34d",
  wood: "#915631", woodLight: "#c28a4a", woodDark: "#38281f",
  crest: "#169459", crestDark: "#075138", gold: "#e6ac32", goldLight: "#ffe298",
};

export function buildingMaterial(o: WorldObject): { wall: string; roof: string; roofLight: string } {
  const key = `${o.id} ${o.metadata?.texture ?? ""}`;
  const red = /forge|library|game-hall|hall-of-fame|house-b|red|apartments/.test(key);
  const green = /office|shop|purple|green/.test(key);
  return { wall: VILLAGE_MATERIAL.plaster, roof: red ? VILLAGE_MATERIAL.redRoof : green ? VILLAGE_MATERIAL.greenRoof : VILLAGE_MATERIAL.goldRoof,
    roofLight: red ? VILLAGE_MATERIAL.redLight : green ? VILLAGE_MATERIAL.greenLight : VILLAGE_MATERIAL.thatchLight };
}
