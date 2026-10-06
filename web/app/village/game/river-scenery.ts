import type * as Phaser from 'phaser';
import { RIVER_BRIDGES, RIVER_ROWS } from './river';

export function drawRiver(scene: Phaser.Scene, still: boolean): void {
  const bridges = scene.add.graphics().setDepth(-401);
  for (const p of RIVER_BRIDGES) {
    bridges.fillStyle(0x686d62).fillRect(p.x - 32, p.y - 32, 64, 64);
    for (let y = -30; y < 32; y += 8) for (let x = -32; x < 32; x += 12) {
      bridges.fillStyle(0xb2b3a2).fillRect(p.x + x + (y % 16 ? 3 : 0), p.y + y, 10, 6);
    }
  }
  const bridgeTiles = new Set(RIVER_BRIDGES.map((p) => `${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`));
  const waves = scene.add.graphics().setDepth(-790);
  const paint = (time: number) => {
    waves.clear().lineStyle(2, 0x96ccdf, 0.42);
    for (const { row, left, right } of RIVER_ROWS) {
      const col = left + ((row % 3 + 3) % 3);
      if (col > right || bridgeTiles.has(`${col},${row}`)) continue;
      const x = col * 64 + 16, y = row * 64 + 12 + time % 30;
      waves.lineBetween(x, y, x + 18, y);
      waves.lineBetween(x + 24, y + 16, x + 35, y + 16);
    }
  };
  paint(0);
  if (!still) scene.events.on('update', (time: number) => paint(time / 70));
}
