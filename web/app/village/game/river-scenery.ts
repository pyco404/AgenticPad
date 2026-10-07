import { groundDepth } from "./depth";
import type * as Phaser from 'phaser';
import { RIVER_BRIDGES, RIVER_ROWS, RIVER_SHORES } from './river';
import { ROUGH_SEA } from './landscape';

export function drawRiver(scene: Phaser.Scene, still: boolean): void {
  const banks = scene.add.graphics().setDepth(groundDepth(-775));
  for (const edge of RIVER_SHORES) {
    const { x, y, dx, dy, col, row } = edge;
    const natural = Math.abs(y - ROUGH_SEA.y) < ROUGH_SEA.ry + 64;
    const horizontal = dy !== 0;
    banks.fillStyle(natural ? 0x4e7242 : 0x5c6656).fillRect(x - (horizontal ? 32 : 3), y - (horizontal ? 3 : 32), horizontal ? 64 : 6, horizontal ? 6 : 64);
    // Broken stones instead of an uninterrupted retaining wall around the lake mouth.
    for (let k = 0; k < 4; k++) {
      if (natural && (col + row + k) % 3 !== 0) continue;
      const along = -26 + k * 16;
      const rx = x + (horizontal ? along : dx * 3), ry = y + (horizontal ? dy * 3 : along);
      banks.fillStyle(k % 2 ? 0x797e6d : 0x91917c).fillRect(rx - 5, ry - 3, 10, 7);
      banks.fillStyle(0xb3b091).fillRect(rx - 3, ry - 3, 5, 2);
    }
    const at = { x: x + dx * 16, y: y + dy * 16 };
    // Reeds sit on the land side of the real shoreline, away from bridge approaches.
    if (!RIVER_BRIDGES.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < 130) && (row + col) % 3 === 0) {
      banks.fillStyle(0x385e41).fillRect(at.x - 3, at.y - 15, 3, 18).fillRect(at.x + 3, at.y - 21, 3, 24);
      banks.fillStyle(0xb6a267).fillRect(at.x - 3, at.y - 18, 3, 6).fillRect(at.x + 3, at.y - 24, 3, 6);
    }
  }
  // Connected crossing tiles form one bridge, preserving the exact dry footprint used by navigation.
  const pending = new Map(RIVER_BRIDGES.map((p) => [`${p.x},${p.y}`, p]));
  while (pending.size) {
    const first = pending.values().next().value!;
    const group = [first]; pending.delete(`${first.x},${first.y}`);
    for (let i = 0; i < group.length; i++) {
      const p = group[i]!;
      for (const [dx, dy] of [[64, 0], [-64, 0], [0, 64], [0, -64]]) {
        const key = `${p.x + dx!},${p.y + dy!}`, next = pending.get(key);
        if (next) { group.push(next); pending.delete(key); }
      }
    }
    const deck = scene.add.graphics().setDepth(groundDepth(-401));
    const faces = scene.add.graphics().setDepth(Math.max(...group.map((p) => p.y)) + 32);
    for (const p of group) {
      deck.fillStyle(0x243f44, 0.3).fillRect(p.x - 30, p.y - 20, 68, 68);
      deck.fillStyle(0x676f67).fillRect(p.x - 32, p.y - 32, 64, 64);
      for (let y = -30; y < 32; y += 8) for (let x = -32; x < 32; x += 12) {
        deck.fillStyle(0xb2b3a2).fillRect(p.x + x + (y % 16 ? 3 : 0), p.y + y, 10, 6);
      }
      if (!group.some((q) => q.x === p.x && q.y === p.y + 64)) {
        faces.fillStyle(0x454f4c).fillRect(p.x - 32, p.y + 32, 64, 14);
        for (let x = -30; x < 32; x += 16) {
          faces.fillStyle(0x747d73).fillRect(p.x + x, p.y + 33, 13, 5);
          faces.fillStyle(0x59665f).fillRect(p.x + x + 2, p.y + 40, 12, 4);
        }
        faces.fillStyle(0xc5c5ad).fillRect(p.x - 32, p.y + 30, 64, 3);
      }
    }
    // Low corner parapets leave the travelling surface and road entrances open.
    const left = Math.min(...group.map((p) => p.x)) - 30, right = Math.max(...group.map((p) => p.x)) + 30;
    const y = Math.min(...group.map((p) => p.y)) - 30;
    for (const x of [left, right]) {
      faces.fillStyle(0x4d5a55).fillRect(x - 4, y - 16, 8, 20);
      faces.fillStyle(0xc4c3a9).fillRect(x - 5, y - 18, 10, 4);
    }
  }
  const bridgeTiles = new Set(RIVER_BRIDGES.map((p) => `${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`));
  const waves = scene.add.graphics().setDepth(groundDepth(-790));
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
