"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { VillageHandle } from "./game";
import { renderProjectedWorld, type ProjectionCamera } from "./game/projected-art";
import { FIELD_VIEWS, VIEW_LABELS, project, projectedBounds, type FieldView } from "../../lib/world/projection";
import type { WorldSnapshot } from "../../lib/world/model";

const SIDES = { front: "South edge · east →", back: "North edge · west →", left: "West edge · north →", right: "East edge · south →", isometric: "Looking from the southeast", top: "Looking down" };
type Props = { view: FieldView; onView: (view: FieldView) => void; village: RefObject<VillageHandle | null>; inset: { right: number; bottom: number } };

/** Observes the existing scene; per-view cameras stay here while Top retains its own camera. */
export function FieldViews({ view, onView, village, inset }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cameras = useRef<Partial<Record<FieldView, ProjectionCamera>>>({});
  const fit = useRef<() => void>(() => {});
  const zoom = useRef<(step: number) => void>(() => {});

  useEffect(() => {
    if (view === "top") return;
    const el = canvas.current, handle = village.current;
    if (!el || !handle) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = document.createElement("canvas"), layer = still.getContext("2d")!;
    let snapshot: WorldSnapshot | null = null;
    let lastRead = -Infinity, revision = -1, dirty = true, raf = 0, width = 0, height = 0, ratio = 1;
    let camera = cameras.current[view];
    const fitWorld = () => {
      if (!snapshot) return;
      const b = projectedBounds(view, snapshot.world.bounds, -snapshot.world.slabDepth, 320);
      camera = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2,
        scale: Math.min((width - 32) / (b.x1 - b.x0), (height - 100) / (b.y1 - b.y0), 1.5) };
      cameras.current[view] = camera; dirty = true;
    };
    fit.current = fitWorld;
    const changeZoom = (factor: number, x = width / 2, y = height / 2) => {
      if (!camera) return;
      const before = camera.scale;
      camera.scale = Math.max(0.035, Math.min(3.5, camera.scale * factor));
      camera.x += (x - width / 2) * (1 / before - 1 / camera.scale);
      camera.y += (y - height / 2) * (1 / before - 1 / camera.scale);
      dirty = true;
    };
    zoom.current = (step) => changeZoom(step > 0 ? 1.25 : 0.8);
    handle.setProjectedZoom((step) => zoom.current(step));
    const resize = () => {
      const rect = el.getBoundingClientRect();
      width = rect.width; height = rect.height; ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = still.width = Math.max(1, Math.round(width * ratio));
      el.height = still.height = Math.max(1, Math.round(height * ratio));
      dirty = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, local(e)); el.setPointerCapture(e.pointerId);
      const [a, b] = [...pointers.values()]; pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const move = (e: PointerEvent) => {
      const before = pointers.get(e.pointerId);
      if (!before || !camera) return;
      const next = local(e); pointers.set(e.pointerId, next);
      const [a, b] = [...pointers.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) changeZoom(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = distance;
      } else { camera.x -= (next.x - before.x) / camera.scale; camera.y -= (next.y - before.y) / camera.scale; dirty = true; }
    };
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const rect = el.getBoundingClientRect();
      changeZoom(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.002), e.clientX - rect.left, e.clientY - rect.top);
    };
    const key = (e: KeyboardEvent) => {
      if (!camera) return;
      const step = 60 / camera.scale;
      if (e.key === "ArrowLeft") camera.x -= step;
      else if (e.key === "ArrowRight") camera.x += step;
      else if (e.key === "ArrowUp") camera.y -= step;
      else if (e.key === "ArrowDown") camera.y += step;
      else if (e.key === "+" || e.key === "=") changeZoom(1.25);
      else if (e.key === "-") changeZoom(0.8);
      else if (e.key === "0") fitWorld();
      else return;
      e.preventDefault(); dirty = true;
    };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("keydown", key);
    const frame = (now: number) => {
      const read = now - lastRead >= 100;
      if (read) { snapshot = handle.snapshot(); lastRead = now; }
      if (snapshot && width > 0 && height > 0 && (read || dirty)) {
        if (!camera) fitWorld();
        if (camera) {
          if (dirty || revision !== snapshot.revision) {
            layer.setTransform(ratio, 0, 0, ratio, 0, 0);
            renderProjectedWorld(layer, snapshot.world, view, camera, width, height);
            revision = snapshot.revision; dirty = false;
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, el.width, el.height); ctx.drawImage(still, 0, 0);
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          // Live position markers stay readable above geometry, like a map's location pins.
          for (const agent of snapshot.agents) {
            const p = project(view, agent, agent.height / 2);
            const x = width / 2 + (p.x - camera.x) * camera.scale, y = height / 2 + (p.y - camera.y) * camera.scale;
            if (x < 0 || y < 0 || x > width || y > height) continue;
            ctx.fillStyle = agent.metadata?.mine ? "#f3cf70" : "#c9e7d5";
            ctx.strokeStyle = "#243e35"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, Math.max(2, Math.min(5, 10 * camera.scale)), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          // Labels are bounded to landmarks and avoid DOM nodes for objects/agents.
          const labels = snapshot.world.objects.filter((o) => o.id.startsWith("site:") || o.type === "mountain").sort((a, b) => Number(b.type === "arena") - Number(a.type === "arena"));
          ctx.font = "11px monospace"; ctx.textAlign = "center";
          const placed: { x: number; y: number; w: number }[] = [];
          for (const o of labels) {
            const p = project(view, o, o.height + 12);
            const x = width / 2 + (p.x - camera.x) * camera.scale;
            let y = height / 2 + (p.y - camera.y) * camera.scale;
            if (x < 20 || x > width - 20 || y < 16 || y > height - 30) continue;
            const text = o.metadata?.label ?? o.id, w = ctx.measureText(text).width;
            const anchor = y;
            for (let row = 0; row < 6 && placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 8 && Math.abs(p.y - y) < 20); row++) y -= 21;
            if (y < 16 || placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 8 && Math.abs(p.y - y) < 20)) continue;
            placed.push({ x, y, w });
            if (y !== anchor) { ctx.strokeStyle = "#d7c78b88"; ctx.beginPath(); ctx.moveTo(x, anchor); ctx.lineTo(x, y); ctx.stroke(); }
            ctx.fillStyle = "#182c24e8"; ctx.fillRect(x - w / 2 - 5, y - 12, w + 10, 17);
            ctx.fillStyle = "#e8d89d"; ctx.fillText(text, x, y);
          }
          if (snapshot.forestPending) { ctx.fillStyle = "#e8d89d"; ctx.fillText("Preparing woodland…", width / 2, height - 18); }
          if (snapshot.night) { ctx.fillStyle = "#0b172645"; ctx.fillRect(0, 0, width, height); }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); handle.setProjectedZoom(null);
      if (camera) cameras.current[view] = camera;
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("wheel", wheel); el.removeEventListener("keydown", key);
    };
  }, [view, village]);

  return <>
    <div className="absolute left-1/2 top-28 z-10 flex max-w-[calc(100%-1rem)] -translate-x-1/2 gap-0.5 rounded-panel border border-hud-line bg-hud p-1 shadow-lg md:top-16" role="group" aria-label="Field view">
      {FIELD_VIEWS.map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => onView(mode)}
        className={`rounded px-2 py-2 text-[11px] focus-visible:outline-2 focus-visible:outline-accent ${view === mode ? "bg-accent text-ink" : "text-text hover:bg-white/10"}`}>{VIEW_LABELS[mode]}</button>)}
    </div>
    <canvas ref={canvas} hidden={view === "top"} tabIndex={view === "top" ? -1 : 0} aria-label={`${VIEW_LABELS[view]} of the AgenticPad field. Arrow keys pan, plus and minus zoom, zero fits the world.`}
      className="absolute left-0 top-14 cursor-grab touch-none bg-[#1b302a] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
      style={{ width: `calc(100% - ${inset.right}px)`, height: `calc(100% - ${56 + inset.bottom}px)` }} />
    {view !== "top" ? <aside className="absolute bottom-14 left-3 z-10 max-w-[min(310px,calc(100%-6rem))] rounded-panel border border-hud-line bg-hud p-3 text-[11px] text-text" style={{ bottom: inset.bottom + 52 }}>
      <p className="text-accent">{VIEW_LABELS[view]} · {SIDES[view]}</p>
      <p className="mt-1 text-muted">Same live world · drag to pan · scroll or pinch to zoom</p>
      <p className="mt-1 text-muted">Agent dots show live positions. Open agents and buildings in Top.</p>
      <button type="button" onClick={() => fit.current()} className="mt-2 rounded border border-hud-line px-2 py-1 hover:border-accent">Fit world</button>
    </aside> : null}
  </>;
}
