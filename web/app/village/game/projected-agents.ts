import type { Painter } from "./hero";

const hex = (colour: number, alpha = 1) =>
  `rgba(${(colour >> 16) & 255},${(colour >> 8) & 255},${colour & 255},${alpha})`;

/**
 * Phaser's Graphics calls, drawn on a 2D canvas instead: lets a Top character paint
 * its own body and activity prop onto a projected view (Hero.paintTo).
 */
export function canvasPainter(ctx: CanvasRenderingContext2D): Painter {
  const painter: Painter = {
    fillStyle(colour, alpha = 1) { ctx.fillStyle = hex(colour, alpha); return painter; },
    fillRect(x, y, w, h) { ctx.fillRect(x, y, w, h); return painter; },
    lineStyle(width, colour, alpha = 1) { ctx.lineWidth = width; ctx.strokeStyle = hex(colour, alpha); return painter; },
    lineBetween(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); return painter; },
    strokeRect(x, y, w, h) { ctx.strokeRect(x, y, w, h); return painter; },
    strokeEllipse(x, y, w, h) { ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); return painter; },
  };
  return painter;
}
