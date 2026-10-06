// Mechanical atlas extraction only; the source artwork was generated with image_gen.
const sharp = require('../web/node_modules/sharp/dist/index.cjs');
const path = require('node:path');
const out = path.join(__dirname, '../web/public/village/reference');
const source = path.join(out, 'source-atlas.png');
const names = ['strategy-lab', 'game-hall', 'hiring-hall', 'hall-of-fame', 'treasury', 'lookout', 'rulebook-house', 'oak', 'birch'];

async function main() {
  const { width, height } = await sharp(source).metadata();
  for (let i = 0; i < names.length; i++) {
    const x0 = Math.round((i % 3) * width / 3), y0 = Math.round(Math.floor(i / 3) * height / 3);
    const x1 = Math.round((i % 3 + 1) * width / 3), y1 = Math.round((Math.floor(i / 3) + 1) * height / 3);
    const crop = await sharp(source).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    // Preserve alpha and use nearest-neighbour sampling for the small game sprites.
    const size = i < 7 ? { width: 128, height: 144 } : { width: 156, height: 166 };
    const trimmed = await sharp(crop).trim({ threshold: 10 }).png().toBuffer();
    await sharp(trimmed).resize({ ...size, fit: 'contain', position: 'bottom', background: '#00000000', kernel: 'nearest' }).png().toFile(path.join(out, `${names[i]}.png`));
  }
  // Retain the existing tree frame geometry/origin so depth, clearing and routes agree.
  const layers = [];
  for (let i = 0; i < 4; i++) layers.push({ input: path.join(out, i % 2 ? 'birch.png' : 'oak.png'), left: i * 192 + 18, top: 14 });
  await sharp({ create: { width: 768, height: 192, channels: 4, background: '#00000000' } }).composite(layers).png().toFile(path.join(out, 'trees.png'));
  const props = path.join(out, 'props-atlas.png');
  const meta = await sharp(props).metadata();
  const propNames = ['cottage-gold', 'cottage-red', 'cottage-green', 'smithy', 'market-blue', 'market-red'];
  for (let i = 0; i < propNames.length; i++) {
    const left = Math.round(i % 3 * meta.width / 3), top = Math.round(Math.floor(i / 3) * meta.height / 2);
    const width = Math.round((i % 3 + 1) * meta.width / 3) - left;
    const height = Math.round((Math.floor(i / 3) + 1) * meta.height / 2) - top;
    const cell = await sharp(props).extract({ left, top, width, height }).png().toBuffer();
    const trimmed = await sharp(cell).trim({ threshold: 10 }).png().toBuffer();
    await sharp(trimmed).resize({ width: 128, height: 144, fit: 'contain', position: 'bottom', background: '#00000000', kernel: 'nearest' }).png().toFile(path.join(out, `${propNames[i]}.png`));
  }
  for (const [name, from, width, height] of [
    ['modern-office', 'smithy', 56, 74], ['modern-house-a', 'cottage-gold', 54, 50],
    ['modern-house-b', 'cottage-red', 54, 50], ['modern-shop', 'market-blue', 58, 54],
    ['modern-apartments', 'cottage-green', 60, 86], ['modern-kiosk', 'market-red', 38, 42],
  ]) {
    await sharp(path.join(out, `${from}.png`)).trim().resize({ width, height, fit: 'contain', position: 'bottom', background: '#00000000', kernel: 'nearest' }).png().toFile(path.join(out, `${name}.png`));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
