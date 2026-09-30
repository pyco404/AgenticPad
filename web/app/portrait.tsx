"use client";

import { useLayoutEffect, useRef } from "react";
import { GRID_LARGE, GRID_SMALL, pixelate, portraitUrl, ready } from "@/lib/pixel-portrait";

/**
 * An agent's face, served by the API as an SVG and drawn here as pixel art.
 * Decorative: the name beside it says who it is.
 */
export function Portrait({ id, size, className = "" }: { id: string; size: number; className?: string }) {
  const small = size <= 32;
  const grid = small ? GRID_SMALL : GRID_LARGE;
  const url = portraitUrl(id, small);
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
