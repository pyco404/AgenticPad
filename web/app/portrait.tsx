"use client";

import { useLayoutEffect, useRef } from "react";
import { API } from "@/lib/api";

/**
 * How many pixels across a portrait is drawn at: the village's pixel art, not
 * a smooth vector. The small drawing (silhouette, colours and eyes) for 32 px
 * and under, since the full one's detail turns to noise that small.
 */
const GRID_SMALL = 20;
const GRID_LARGE = 40;

/** Each drawing's pixels, once per page: every row of a ladder showing the same agent shares one. */
const drawn = new Map<string, Promise<ImageData | null>>();
/** The ones already done, so a row that mounts again draws in the same frame rather than flashing empty. */
const ready = new Map<string, ImageData>();

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * The stored drawing, rasterised onto a grid and snapped to its own colours:
 * every pixel is one of the portrait's flat fills or fully clear, so edges are
 * hard steps rather than a blur. The stored SVG is untouched - this is only
 * how it is shown.
 */
function pixelate(url: string, grid: number): Promise<ImageData | null> {
  const key = `${url}@${grid}`;
  let job = drawn.get(key);
  if (!job) {
    job = (async () => {
      const svg = await (await fetch(url)).text();
      const colours = [...new Set(svg.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [])].map(hex);
      const blob = URL.createObjectURL(new Blob([svg.replace(/shape-rendering="[^"]*"/, 'shape-rendering="crispEdges"')], { type: "image/svg+xml" }));
      try {
        const img = new Image();
        img.src = blob;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = grid;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(img, 0, 0, grid, grid);
        const data = g.getImageData(0, 0, grid, grid);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3]! < 128) {
            px[i + 3] = 0;
            continue;
          }
          let best = 0;
          let bestD = Infinity;
          colours.forEach(([r, gr, b], j) => {
            const d = (px[i]! - r) ** 2 + (px[i + 1]! - gr) ** 2 + (px[i + 2]! - b) ** 2;
            if (d < bestD) [best, bestD] = [j, d];
          });
          const c = colours[best];
          if (c) [px[i], px[i + 1], px[i + 2]] = c;
          px[i + 3] = 255;
        }
        ready.set(key, data);
        return data;
      } finally {
        URL.revokeObjectURL(blob);
      }
    })().catch(() => {
      drawn.delete(key);
      return null;
    });
    drawn.set(key, job);
  }
  return job;
}

/**
 * An agent's face, served by the API as an SVG and drawn here as pixel art.
 * Decorative: the name beside it says who it is.
 */
export function Portrait({ id, size, className = "" }: { id: string; size: number; className?: string }) {
  const small = size <= 32;
  const grid = small ? GRID_SMALL : GRID_LARGE;
  const url = `${API}/agents/${id}/portrait.svg${small ? "?size=small" : ""}`;
  const canvas = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const done = ready.get(`${url}@${grid}`);
    if (done) {
      canvas.current?.getContext("2d")?.putImageData(done, 0, 0);
      return;
    }
    let gone = false;
    pixelate(url, grid).then((data) => {
      const g = canvas.current?.getContext("2d");
      if (!gone && data && g) g.putImageData(data, 0, 0);
    });
    return () => {
      gone = true;
    };
  }, [url, grid]);

  return (
    <canvas
      ref={canvas}
      width={grid}
      height={grid}
      aria-hidden
      className={`shrink-0 [image-rendering:pixelated] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
