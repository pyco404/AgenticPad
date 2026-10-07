"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { VillageHandle } from "./game";
import type { WorldView } from "./game/presentation";
import { DISTRICTS, districtAt } from "./game/districts";
import { waterTerrain } from "./game/river";
import { LAUNCH_SITE, ROADS, SITES } from "./game/town";
import { lakeTerrain, WORLD } from "./game/world";
import { TERRAIN } from "./game/palette";

const W = 184, H = 144;
const point = (x: number, y: number) => ({ x: (x - WORLD.x0) / (WORLD.x1 - WORLD.x0) * W, y: (y - WORLD.y0) / (WORLD.y1 - WORLD.y0) * H });

/** One small canvas, updated at five Hz, independent of the number of residents. */
export function WorldLens({ view, village, inset, hidden, observing }: {
  view: WorldView | null; village: React.RefObject<VillageHandle | null>;
  inset: { right: number; bottom: number }; hidden: boolean;
  observing: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!view || !canvas.current) return;
    if (!base.current) {
      const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
      const c = bg.getContext("2d")!; c.imageSmoothingEnabled = false;
      c.fillStyle = "#4b6546"; c.fillRect(0, 0, W, H);
      for (const d of DISTRICTS) {
        if ((d.id === "launch" && !SITES.launchpad) || (d.id === "market" && !SITES.bazaar)) continue;
        const p = point(d.x, d.y); c.fillStyle = d.colour;
        c.fillRect(Math.round(p.x - d.rx / 70), Math.round(p.y - d.ry / 70), Math.round(d.rx / 35), Math.round(d.ry / 35));
      }
      c.fillStyle = "#3389a5";
      const water = waterTerrain();
      const shore = new Set(water.filter(([, , texture]) => !texture.includes("water")).map(([col, row]) => `${col},${row}`));
      for (const [col, row, texture] of water) {
        if (!texture.includes("water") || shore.has(`${col},${row}`)) continue;
        const a = point(col * 64, row * 64), b = point((col + 1) * 64, (row + 1) * 64);
        c.fillRect(Math.floor(a.x), Math.floor(a.y), Math.ceil(b.x - a.x), Math.ceil(b.y - a.y));
      }
      for (const [col, row, texture] of lakeTerrain()) if (texture.includes("water")) {
        const p = point(col * 64, row * 64); c.fillRect(p.x, p.y, 2, 2);
      }
      c.strokeStyle = TERRAIN.paved.base; c.lineWidth = 1;
      for (const road of ROADS) {
        c.beginPath(); road.points.forEach(([x, y], i) => { const p = point(x, y); if (!i) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y); }); c.stroke();
      }
      for (const [id, site] of Object.entries(SITES)) {
        const p = point(site.x, site.y); c.fillStyle = id === "arena" ? "#efd282" : id === "launchpad" ? "#73d8cd" : "#d3c7a5";
        c.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, id === "arena" ? 6 : 4, 4);
      }
      c.font = "7px monospace"; c.fillStyle = "#f5ecd6";
      for (const [text, x, y] of [["ARENA", 1400, 800], ["LAUNCH", LAUNCH_SITE.x, LAUNCH_SITE.y], ["MARKET", -60, 1170], ["LEGACY", 1730, 390]] as const) {
        if (text === "LAUNCH" && !SITES.launchpad || text === "MARKET" && !SITES.bazaar) continue;
        const p = point(x, y); c.fillText(text, p.x - 12, p.y - 6);
      }
      base.current = bg;
    }
    const c = canvas.current.getContext("2d")!; c.imageSmoothingEnabled = false;
    c.drawImage(base.current, 0, 0);
    const a = point(view.bounds.x, view.bounds.y), b = point(view.bounds.x + view.bounds.width, view.bounds.y + view.bounds.height);
    c.strokeStyle = "#f4e1b4"; c.lineWidth = 1; c.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    if (view.selected) { const p = point(view.selected.x, view.selected.y); c.fillStyle = "#ffffff"; c.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5); c.fillStyle = "#e8b84b"; c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3); }
  }, [view]);
  if (!view || hidden) return null;
  return (
    <aside className="pointer-events-auto absolute bottom-14 left-3 z-10 max-w-[196px] rounded-panel border border-hud-line bg-hud p-1.5 text-[11px] text-text shadow-[0_4px_16px_rgb(0_0_0/0.35)] md:bottom-14" style={{ bottom: inset.bottom + 52 }} aria-label="World camera">
      <div className="flex gap-1" aria-label="Camera views">
        <Link href="/field" onClick={() => village.current?.view("world")} className={`rounded px-2 py-1 hover:text-accent ${!observing && view.mode === "world" ? "bg-accent/10 text-accent" : "text-muted"}`}>Field</Link>
        {!observing ? <button type="button" aria-pressed={view.mode === "district"} onClick={() => village.current?.view("district")} className={`rounded px-2 py-1 hover:text-accent ${view.mode === "district" ? "bg-accent/10 text-accent" : "text-muted"}`}>District</button> : null}
        <Link href="/agent" className={`rounded px-2 py-1 hover:text-accent ${observing ? "bg-accent/10 text-accent" : "text-muted"}`}>Agent</Link>
      </div>
      {observing || view.mode !== "world" ? <>
        <button type="button" disabled={observing} className={`mt-1 block ${observing ? "cursor-default" : "cursor-crosshair"}`} title={observing ? "Your agent in the world" : "Explore a place on the minimap"} aria-label={observing ? "Agent minimap" : "Explore the world using the minimap"} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          village.current?.lookAt({ x: WORLD.x0 + (e.clientX - r.left) / r.width * (WORLD.x1 - WORLD.x0), y: WORLD.y0 + (e.clientY - r.top) / r.height * (WORLD.y1 - WORLD.y0) });
        }}><canvas ref={canvas} width={W} height={H} className="h-[108px] w-[138px] [image-rendering:pixelated] sm:h-[144px] sm:w-[184px]" /></button>
        {!observing && view.selected ? <div className="mt-1.5 max-w-[184px] border-t border-hud-line pt-1">
          <Link className="block truncate text-accent hover:text-text" href={`/a/${view.selected.id}`}>{view.selected.name}{view.selected.house ? " · House" : ""}</Link>
          <p className="text-muted">{view.following ? "Following" : districtAt(view.selected)} · {view.selected.activity}</p>
          <p className="truncate" title={view.selected.destination}>To: {view.selected.destination}</p>
        </div> : observing ? <p className="mt-1 text-muted">{view.selected ? districtAt(view.selected) : "Locating your agent…"}</p> : <p className="mt-1 text-muted">Tap an agent to follow</p>}
      </> : null}
    </aside>
  );
}
