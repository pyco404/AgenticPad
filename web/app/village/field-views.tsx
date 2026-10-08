"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { VillageHandle } from "./game";
import { renderProjectedWorld, type ProjectionCamera } from "./game/projected-art";
import { CAMERA_ANGLES, dragCamera, easeCamera, frameProjection, project, unprojectGround, yawDelta } from "../../lib/world/projection";
import { VOID, nightOf } from "./game/palette";
import { loadProjectedMaterials } from "./game/projected-materials";
import { canvasPainter } from "./game/projected-agents";
import { agentBox, inside, worldPicker, type ScreenBox, type WorldTarget } from "./game/projected-picking";
import type { WorldSnapshot } from "../../lib/world/model";
import { directionalVisibility } from "../../lib/world/visibility";

type Props = { village: RefObject<VillageHandle | null>; inset: { right: number; bottom: number } };
type Pointer = { x: number; y: number; startX: number; startY: number; allowed: boolean; dragging: boolean; pan: boolean; target: WorldTarget | null };
type Hit = { target: WorldTarget; box: ScreenBox };
const DRAG = 8;

/** One Isometric camera observes the live shared scene at every angle. */
export function FieldViews({ village, inset }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fit = useRef<(whole?: boolean) => void>(() => {});
  const reset = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current, handle = village.current;
    if (!el || !handle) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = document.createElement("canvas"), layer = still.getContext("2d")!;
    let snapshot: WorldSnapshot | null = null, camera: ProjectionCamera | null = null;
    let angle = { ...CAMERA_ANGLES.isometric }, target = { ...angle };
    let focus: { x: number; y: number } | null = null, zoomFactor = 1, whole = false, following: string | null = null;
    let lastRead = -Infinity, lastDraw = -Infinity, lastFrame = 0, revision = -1, dirty = true, raf = 0, width = 0, height = 0, ratio = 1;
    let artwork: ReturnType<typeof loadProjectedMaterials> | null = null;
    let agentVisible: ReturnType<typeof directionalVisibility> | null = null;
    let pickWorld: (p: { x: number; y: number }) => WorldTarget | null = () => null;
    let agentHits: Hit[] = [], labelHits: Hit[] = [];
    const pick = (point: { x: number; y: number }) => {
      for (const hits of [labelHits, agentHits]) for (let i = hits.length - 1; i >= 0; i--) if (inside(point, hits[i]!.box)) return hits[i]!.target;
      return pickWorld(point);
    };
    const worldCentre = () => {
      const b = snapshot!.world.bounds;
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    };
    const baseCamera = () => frameProjection(angle, snapshot!.world.bounds, width, height, snapshot!.world.slabDepth, whole ? "overview" : "immersive");
    const resize = () => {
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
    const pan = (dx: number, dy: number) => {
      if (!camera || !focus) return;
      following = null;
      const delta = unprojectGround(angle, { x: -dx / camera.scale, y: -dy / camera.scale });
      focus.x += delta.x; focus.y += delta.y; dirty = true;
    };
    fit.current = (overview = false) => {
      if (!snapshot) return;
      following = null; focus = worldCentre(); zoomFactor = 1; whole = overview; dirty = true;
    };
    reset.current = () => { target = { ...CAMERA_ANGLES.isometric }; fit.current(); };
    handle.setFieldCamera({
      zoom: (step) => changeZoom(step > 0 ? 1.25 : 0.8),
      lookAt: (point) => { following = null; focus = { ...point }; dirty = true; },
      view: (mode) => {
        if (mode === "world") fit.current(true);
        else if (camera) changeZoom((mode === "agent" ? 2.4 : 1.05) / camera.scale);
      },
      follow: (id) => {
        following = id;
        if (id && camera) changeZoom(Math.max(camera.scale, 0.8) / camera.scale);
      },
    });
    const pointers = new Map<number, Pointer>();
    let pinch = 0;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const next = local(e), hit = pick(next), wantsPan = e.shiftKey || e.button === 1;
      pointers.set(e.pointerId, { ...next, startX: next.x, startY: next.y, target: hit, allowed: !hit || wantsPan, dragging: false, pan: wantsPan });
      el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
      if (e.button === 1) e.preventDefault();
      const [a, b] = [...pointers.values()];
      pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      if (a && b) for (const p of pointers.values()) p.dragging = true;
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const next = local(e), dx = next.x - p.x, dy = next.y - p.y;
      p.x = next.x; p.y = next.y;
      const [a, b] = [...pointers.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        following = null;
        if (pinch > 0) changeZoom(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pan(dx / 2, dy / 2); pinch = distance;
        for (const pointer of pointers.values()) pointer.dragging = true;
        e.preventDefault(); return;
      }
      if (!p.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) < DRAG) return;
      p.dragging = true;
      if (!p.allowed || !camera || !focus) return;
      e.preventDefault(); following = null;
      if (p.pan) pan(dx, dy);
      else target = dragCamera(target, dx, dy);
      dirty = true;
    };
    const release = (e: PointerEvent, cancel = false) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId); pinch = 0;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!p || cancel || p.dragging || e.button !== 0) return;
      const at = local(e), hit = pick(at);
      if (Math.hypot(at.x - p.startX, at.y - p.startY) < DRAG && hit && hit.kind === p.target?.kind && hit.id === p.target.id) handle.activateWorldTarget(hit);
    };
    const up = (e: PointerEvent) => release(e);
    const cancel = (e: PointerEvent) => release(e, true);
    const blur = () => { for (const id of [...pointers.keys()]) release({ pointerId: id } as PointerEvent, true); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); following = null; const rect = el.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
      changeZoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), e.clientX - rect.left, e.clientY - rect.top);
    };
    const key = (e: KeyboardEvent) => {
      if (!camera || !focus) return;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = 60;
      else if (e.key === "ArrowRight") dx = -60;
      else if (e.key === "ArrowUp") dy = 60;
      else if (e.key === "ArrowDown") dy = -60;
      else if (e.key === "+" || e.key === "=") changeZoom(1.25);
      else if (e.key === "-") changeZoom(0.8);
      else if (e.key === "0") fit.current();
      else return;
      if (dx || dy) pan(dx, dy);
      e.preventDefault(); dirty = true;
    };
    // Only the world canvas starts gestures; overlaid controls keep their own events.
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    el.addEventListener("lostpointercapture", cancel); window.addEventListener("blur", blur);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("keydown", key);
    const frame = (now: number) => {
      const seconds = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      if (Math.abs(yawDelta(angle.yaw, target.yaw)) + Math.abs(angle.tilt - target.tilt) > 0.00001) {
        angle = easeCamera(angle, target, seconds); dirty = true;
      }
      const read = now - lastRead >= 100;
      if (read) { snapshot = handle.snapshot(); lastRead = now; }
      if (snapshot && width > 0 && height > 0 && (read || dirty || now - lastDraw >= 50) && now - lastDraw >= 32) {
        focus ??= worldCentre();
        if (following) {
          const agent = snapshot.agents.find((a) => a.id === `agent:${following}`);
          if (agent) {
            const amount = 1 - Math.exp(-seconds * 10);
            focus.x += (agent.x - focus.x) * amount; focus.y += (agent.y - focus.y) * amount;
            dirty = true;
          } else following = null;
        }
        const base = baseCamera(), centre = project(angle, focus);
        const scale = Math.max(0.035, Math.min(3.5, base.scale * zoomFactor));
        camera = { x: centre.x, y: centre.y, scale: camera ? camera.scale + (scale - camera.scale) * (1 - Math.exp(-seconds * 14)) : scale };
        const view = angle;
        if (dirty || revision !== snapshot.revision) {
          layer.setTransform(ratio, 0, 0, ratio, 0, 0);
          artwork ??= loadProjectedMaterials(snapshot.world, () => { dirty = true; });
          renderProjectedWorld(layer, snapshot.world, view, camera, width, height, artwork.materials, { ground: snapshot.ground, art: snapshot.art });
          agentVisible = directionalVisibility(view, snapshot.world.objects);
          pickWorld = worldPicker(view, snapshot.world.objects, camera, width, height, snapshot.art);
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
        agentHits = shown.map(({ agent, x, y }) => ({ target: { kind: "agent" as const, id: agent.id }, box: agentBox({ x, y }, camera!.scale) }));
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
        labelHits = [];
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
          if (o.id.startsWith("site:") && (o.type === "arena" || o.type === "building")) {
            labelHits.push({ target: { kind: "building", id: o.id.slice(5) }, box: { x: x - w / 2 - 5, y: y - 12, width: w + 10, height: 17 } });
          }
          ctx.fillStyle = "#182c24e8"; ctx.fillRect(x - w / 2 - 5, y - 12, w + 10, 17);
          ctx.fillStyle = "#e8d89d"; ctx.fillText(text, x, y);
        }
        if (snapshot.forestPending) { ctx.fillStyle = "#e8d89d"; ctx.fillText("Preparing woodland…", width / 2, height - 18); }
        el.dataset.focusX = String(focus.x); el.dataset.focusY = String(focus.y); el.dataset.following = following ?? "";
        el.dataset.yaw = String(angle.yaw); el.dataset.tilt = String(angle.tilt); el.dataset.zoom = String(camera.scale);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); artwork?.dispose(); handle.setFieldCamera(null);
      blur();
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      el.removeEventListener("lostpointercapture", cancel); window.removeEventListener("blur", blur);
      el.removeEventListener("wheel", wheel); el.removeEventListener("keydown", key);
    };
  }, [village]);

  return <>
    <canvas ref={canvas} tabIndex={0} aria-label="Explore the AgenticPad world. Drag empty ground to rotate, Shift-drag or arrow keys to pan, scroll or pinch to zoom. Tap agents or buildings to open them."
      className="absolute left-0 top-14 cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
      style={{ backgroundColor: VOID, width: `calc(100% - ${inset.right}px)`, height: `calc(100% - ${56 + inset.bottom}px)` }} />
    <aside className="absolute left-3 z-10 max-w-[min(310px,calc(100%-6rem))] rounded-panel border border-hud-line bg-hud p-3 text-[11px] text-text" style={{ bottom: inset.bottom + 100 }} aria-label="World camera controls">
      <p className="text-accent">Isometric</p>
      <p className="mt-1 text-muted">Drag empty ground to rotate · drag up to look down</p>
      <p className="mt-1 text-muted">Scroll or pinch to zoom · Shift-drag or two-finger drag to pan</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => reset.current()} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Reset camera</button>
        <button type="button" onClick={() => fit.current(true)} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Whole world</button>
      </div>
    </aside>
  </>;
}
