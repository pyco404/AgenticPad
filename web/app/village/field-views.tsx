"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { VillageHandle } from "./game";
import { renderProjectedWorld, type ProjectionCamera } from "./game/projected-art";
import { CAMERA_ANGLES, FIELD_VIEWS, VIEW_LABELS, cameraAngle, dragCamera, easeCamera, frameProjection, project, unprojectGround, yawDelta, type FieldView } from "../../lib/world/projection";
import { VOID, nightOf } from "./game/palette";
import { loadProjectedMaterials } from "./game/projected-materials";
import { canvasPainter } from "./game/projected-agents";
import type { WorldSnapshot } from "../../lib/world/model";
import { directionalVisibility } from "../../lib/world/visibility";

type Props = { view: FieldView; onView: (view: FieldView) => void; village: RefObject<VillageHandle | null>; topSurface: RefObject<HTMLDivElement | null>; inset: { right: number; bottom: number } };
type Pointer = { x: number; y: number; startX: number; startY: number; allowed: boolean; dragging: boolean; pan: boolean };
const DRAG = 8;

/** One orbit controller observes the live scene; no projection owns another world. */
export function FieldViews({ view, onView, village, topSurface, inset }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [orbit, setOrbit] = useState(false);
  const choose = useRef<(view: FieldView) => void>(() => {});
  const fit = useRef<(whole?: boolean) => void>(() => {});
  const callback = useRef(onView); callback.current = onView;
  const initial = useRef(view);

  useEffect(() => {
    const el = canvas.current, handle = village.current, top = topSurface.current;
    if (!el || !handle || !top) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = document.createElement("canvas"), layer = still.getContext("2d")!;
    let snapshot: WorldSnapshot | null = null, camera: ProjectionCamera | null = null;
    let active = initial.current !== "top", angle = { ...cameraAngle(initial.current) }, target = { ...angle };
    let focus: { x: number; y: number } | null = null, zoomFactor = 1, whole = false;
    let lastRead = -Infinity, lastDraw = -Infinity, lastFrame = 0, revision = -1, dirty = true, raf = 0, width = 0, height = 0, ratio = 1;
    let artwork: ReturnType<typeof loadProjectedMaterials> | null = null;
    let agentVisible: ReturnType<typeof directionalVisibility> | null = null;
    const worldCentre = () => {
      const b = snapshot!.world.bounds;
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    };
    const baseCamera = () => frameProjection(angle, snapshot!.world.bounds, width, height, snapshot!.world.slabDepth, whole ? "overview" : "immersive");
    const resize = () => {
      // Stay laid out while hidden so the first Top drag has valid dimensions.
      const rect = el.getBoundingClientRect();
      width = rect.width; height = rect.height; ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = still.width = Math.max(1, Math.round(width * ratio));
      el.height = still.height = Math.max(1, Math.round(height * ratio)); dirty = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const changeZoom = (factor: number, x = width / 2, y = height / 2) => {
      if (!camera || !focus) return;
      const before = camera.scale, next = Math.max(0.035, Math.min(3.5, before * factor));
      zoomFactor *= next / before;
      const delta = unprojectGround(angle, { x: (x - width / 2) * (1 / before - 1 / next), y: (y - height / 2) * (1 / before - 1 / next) });
      focus.x += delta.x; focus.y += delta.y; camera.scale = next; dirty = true;
    };
    const activate = (mode: FieldView) => {
      active = true; handle.setProjectedZoom((step) => changeZoom(step > 0 ? 1.25 : 0.8)); callback.current(mode); dirty = true;
    };
    handle.setRotationEnabled(true);
    if (active) activate(initial.current);
    choose.current = (mode) => {
      setOrbit(false);
      if (mode === "top") {
        active = false; camera = null; angle = { ...CAMERA_ANGLES.top }; target = { ...angle };
        handle.setProjectedZoom(null); callback.current(mode); return;
      }
      snapshot ??= handle.snapshot();
      if (!snapshot) return;
      focus = worldCentre(); zoomFactor = 1; whole = false; target = { ...CAMERA_ANGLES[mode] };
      activate(mode);
    };
    fit.current = (overview = false) => {
      if (!snapshot) return;
      focus = worldCentre(); zoomFactor = 1; whole = overview; dirty = true;
    };
    const pointers = new Map<number, Pointer>();
    const capture = top.parentElement!;
    let pinch = 0;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const fromTop = !active, next = local(e), rect = top.getBoundingClientRect();
      const allowed = !fromTop || e.shiftKey || e.button === 1 || handle.canRotateAt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      pointers.set(e.pointerId, { ...next, startX: next.x, startY: next.y, allowed, dragging: false, pan: e.shiftKey || e.button === 1 });
      const [a, b] = [...pointers.values()]; pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      if (!fromTop) el.focus({ preventScroll: true });
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const next = local(e), dx = next.x - p.x, dy = next.y - p.y;
      p.x = next.x; p.y = next.y;
      const [a, b] = [...pointers.values()];
      if (a && b) {
        // Top retains Phaser's pinch; two fingers in orbit zoom without turning.
        if (active) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0) changeZoom(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
          pinch = distance;
        }
        for (const pointer of pointers.values()) pointer.dragging = true;
        return;
      }
      if (!p.allowed) return;
      if (!p.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) < DRAG) return;
      if (!p.dragging) {
        p.dragging = true; capture.setPointerCapture(e.pointerId);
        if (!active) {
          snapshot = handle.snapshot();
          if (!snapshot) return;
          const r = el.getBoundingClientRect(), t = top.getBoundingClientRect();
          const before = handle.rotationCamera({ x: r.left - t.left + width / 2, y: r.top - t.top + height / 2 });
          angle = { yaw: 0, tilt: before.tilt }; target = { ...angle }; focus = { x: before.x, y: before.y };
          zoomFactor = before.scale / baseCamera().scale;
          camera = { ...project(angle, focus), scale: before.scale };
          activate("isometric");
        }
        setOrbit(true);
      }
      if (!camera || !focus) return;
      e.preventDefault();
      if (p.pan) {
        const delta = unprojectGround(angle, { x: -dx / camera.scale, y: -dy / camera.scale });
        focus.x += delta.x; focus.y += delta.y;
      } else target = dragCamera(target, dx, dy);
      dirty = true;
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId); pinch = 0;
      if (capture.hasPointerCapture(e.pointerId)) capture.releasePointerCapture(e.pointerId);
      // Keep the exact chosen angle rather than snapping on release.
    };
    const blur = () => { for (const id of [...pointers.keys()]) up({ pointerId: id } as PointerEvent); };
    // Touch starts with implicit capture on the canvas. Its lost-capture event bubbles
    // when we transfer capture to the persistent parent; that transfer is not a release.
    const lost = (e: PointerEvent) => { if (e.target === capture) up(e); };
    const wheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault(); const rect = el.getBoundingClientRect();
      changeZoom(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.002), e.clientX - rect.left, e.clientY - rect.top);
    };
    const key = (e: KeyboardEvent) => {
      if (!active || !camera || !focus) return;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -60;
      else if (e.key === "ArrowRight") dx = 60;
      else if (e.key === "ArrowUp") dy = -60;
      else if (e.key === "ArrowDown") dy = 60;
      else if (e.key === "+" || e.key === "=") changeZoom(1.25);
      else if (e.key === "-") changeZoom(0.8);
      else if (e.key === "0") fit.current();
      else return;
      const delta = unprojectGround(angle, { x: dx / camera.scale, y: dy / camera.scale });
      focus.x += delta.x; focus.y += delta.y; e.preventDefault(); dirty = true;
    };
    // Gestures start only on world surfaces; UI controls never enter this controller.
    top.addEventListener("pointerdown", down); el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    capture.addEventListener("lostpointercapture", lost); window.addEventListener("blur", blur);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("keydown", key);
    const frame = (now: number) => {
      const seconds = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      if (active) {
        if (Math.abs(yawDelta(angle.yaw, target.yaw)) + Math.abs(angle.tilt - target.tilt) > 0.00001) {
          angle = easeCamera(angle, target, seconds); dirty = true;
        }
        const read = now - lastRead >= 100;
        if (read) { snapshot = handle.snapshot(); lastRead = now; }
        if (snapshot && width > 0 && height > 0 && (read || dirty || now - lastDraw >= 50) && now - lastDraw >= 32) {
          focus ??= worldCentre();
          const base = baseCamera(), centre = project(angle, focus);
          const scale = Math.max(0.035, Math.min(3.5, base.scale * zoomFactor));
          camera = { x: centre.x, y: centre.y, scale: camera ? camera.scale + (scale - camera.scale) * (1 - Math.exp(-seconds * 14)) : scale };
          const view = angle;
          if (dirty || revision !== snapshot.revision) {
            layer.setTransform(ratio, 0, 0, ratio, 0, 0);
            artwork ??= loadProjectedMaterials(snapshot.world, () => { dirty = true; });
            renderProjectedWorld(layer, snapshot.world, view, camera, width, height, artwork.materials, { ground: snapshot.ground, art: snapshot.art });
            agentVisible = directionalVisibility(view, snapshot.world.objects);
            revision = snapshot.revision; dirty = Math.abs(scale - camera.scale) > 0.00001;
          }
          lastDraw = now;
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, el.width, el.height); ctx.drawImage(still, 0, 0);
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          // Live agents as their own Top characters, standing on their projected feet, back to front.
          const k = Math.max(0.32, Math.min(1.2, camera.scale));
          const shown = [];
          for (const agent of snapshot.agents) {
            if (agentVisible && !agentVisible(agent, agent.height / 2)) continue;
            const p = project(view, agent, 0);
            const x = width / 2 + (p.x - camera.x) * camera.scale, y = height / 2 + (p.y - camera.y) * camera.scale;
            if (x < -40 || y < 0 || x > width + 40 || y > height + 60) continue;
            shown.push({ agent, x, y });
          }
          shown.sort((a, b) => a.y - b.y);
          for (const { agent, x, y } of shown) {
            if (agent.metadata?.mine) {
              ctx.strokeStyle = "#f3cf70"; ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.ellipse(x, y, 18 * k, 6 * k, 0, 0, Math.PI * 2); ctx.stroke();
            }
            if (!handle.paintAgent(agent.id, ctx, x, y, k, canvasPainter)) {
              ctx.fillStyle = agent.metadata?.mine ? "#f3cf70" : "#c9e7d5"; ctx.strokeStyle = "#243e35"; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.arc(x, y - 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
          }
          if (snapshot.night) {
            ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = nightOf("#ffffff"); ctx.fillRect(0, 0, width, height); ctx.restore();
          }
          // Labels are bounded to landmarks and avoid DOM nodes for objects/agents.
          const labels = snapshot.world.objects.filter((o) => o.id.startsWith("site:") || o.type === "mountain" || o.metadata?.landmark).sort((a, b) => Number(b.type === "arena") - Number(a.type === "arena"));
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
          el.dataset.yaw = String(angle.yaw); el.dataset.tilt = String(angle.tilt); el.dataset.zoom = String(camera.scale);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); artwork?.dispose(); handle.setProjectedZoom(null); handle.setRotationEnabled(false);
      for (const id of pointers.keys()) if (capture.hasPointerCapture(id)) capture.releasePointerCapture(id);
      top.removeEventListener("pointerdown", down); el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      capture.removeEventListener("lostpointercapture", lost); window.removeEventListener("blur", blur);
      el.removeEventListener("wheel", wheel); el.removeEventListener("keydown", key);
    };
  }, [village, topSurface]);

  return <>
    <div className="absolute left-1/2 top-28 z-10 flex max-w-[calc(100%-1rem)] -translate-x-1/2 gap-0.5 rounded-panel border border-hud-line bg-hud p-1 shadow-lg md:top-16" role="group" aria-label="Field view">
      {FIELD_VIEWS.map((mode) => <button key={mode} type="button" aria-pressed={!orbit && view === mode} onClick={() => choose.current(mode)}
        className={`rounded px-2 py-2 text-[11px] focus-visible:outline-2 focus-visible:outline-accent ${!orbit && view === mode ? "bg-accent text-ink" : "text-text hover:bg-white/10"}`}>{VIEW_LABELS[mode]}</button>)}
    </div>
    <canvas ref={canvas} tabIndex={view === "top" ? -1 : 0} aria-hidden={view === "top"} aria-label="Rotate the AgenticPad world. Drag to rotate, Shift-drag or arrow keys to pan, scroll or pinch to zoom."
      className="absolute left-0 top-14 cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
      style={{ backgroundColor: VOID, visibility: view === "top" ? "hidden" : "visible", opacity: view === "top" ? 0 : 1, pointerEvents: view === "top" ? "none" : "auto",
        transition: view === "top" ? "opacity 180ms ease, visibility 0s 180ms" : "opacity 180ms ease",
        width: `calc(100% - ${inset.right}px)`, height: `calc(100% - ${56 + inset.bottom}px)` }} />
    {/* Top keeps the shell's own hint, which sits beside its minimap. */}
    {view !== "top" ? <aside className="absolute left-3 z-10 max-w-[min(310px,calc(100%-6rem))] rounded-panel border border-hud-line bg-hud p-3 text-[11px] text-text" style={{ bottom: inset.bottom + 100 }}>
      <p className="text-accent">{orbit ? "Rotate world" : VIEW_LABELS[view]}</p>
      <p className="mt-1 text-muted">Drag to rotate · drag up to look down · scroll or pinch to zoom</p>
      <p className="mt-1 text-muted">Shift-drag to pan. Open agents and buildings in Top.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => fit.current()} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Frame view</button>
        <button type="button" onClick={() => fit.current(true)} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Whole world</button>
      </div>
    </aside> : null}
  </>;
}
