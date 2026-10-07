/** Presentation overrides keep the established building footprints and agent routes. */
const ROOT = '/village/reference';
const HALLS = new Set(['strategy-lab', 'game-hall', 'hiring-hall', 'hall-of-fame', 'treasury', 'lookout', 'rulebook-house']);
const PROPS = new Set(['office', 'house-a', 'house-b', 'shop', 'apartments', 'kiosk']);

export function referenceArt(url: string): string {
  const name = url.match(/\/modern-(.+)\.png$/)?.[1];
  if (name && HALLS.has(name)) return `${ROOT}/${name}.png`;
  return name && PROPS.has(name) ? `${ROOT}/modern-${name}.png` : url;
}
