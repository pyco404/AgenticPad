import type { WorldObject } from "./model";

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
  const key = o.metadata?.art?.key ?? o.metadata?.texture ?? o.id;
  const red = /forge|library|game-hall|hall-of-fame|house-b|red|apartments/.test(key);
  const green = /office|shop|purple|green/.test(key);
  return { wall: VILLAGE_MATERIAL.plaster, roof: red ? VILLAGE_MATERIAL.redRoof : green ? VILLAGE_MATERIAL.greenRoof : VILLAGE_MATERIAL.goldRoof,
    roofLight: red ? VILLAGE_MATERIAL.redLight : green ? VILLAGE_MATERIAL.greenLight : VILLAGE_MATERIAL.thatchLight };
}
