"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Counts from 0 up to `target` over `durationMs`, once, the first time a target
 * arrives. Later changes to the target land instantly: this is arrival motion,
 * not something that replays whenever a number updates. With reduced motion,
 * the final value renders straight away.
 */
export function useCountUp(target: number | undefined, durationMs = 400, delayMs = 0): number | undefined {
  const [value, setValue] = useState<number | undefined>(undefined);
  const played = useRef(false);

  useEffect(() => {
    if (target === undefined) return;
    if (played.current || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    played.current = true;
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now + delayMs;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      // Ease out: fast at first, settling onto the real value.
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setValue(0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setValue(target);
    };
  }, [target, durationMs, delayMs]);

  return value;
}

/**
 * A counter that ticks: whenever `target` changes, it runs from the value on
 * screen to the new one over `durationMs`. Unlike useCountUp it plays on every
 * change, because here the change is the news. The first value lands as is,
 * and with reduced motion so does every one after it.
 */
export function useTicker(target: number | undefined, durationMs = 900): number | undefined {
  const [value, setValue] = useState<number | undefined>(target);
  const shown = useRef<number | undefined>(target);

  useEffect(() => {
    const from = shown.current;
    if (target === undefined || from === undefined || from === target || prefersReducedMotion()) {
      shown.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / durationMs);
      const v = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      shown.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}

type Spot = { x: number; y: number };

/** How far a running glide has the element drawn from where it sits. */
function offsetOf(el: HTMLElement): Spot {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(t);
  return { x: m.m41, y: m.m42 };
}

/**
 * Moves that glide instead of jump. Every element under `container` carrying
 * `data-flip="<key>"` is measured after each render; one whose key was
 * somewhere else last time is drawn back there and slid to where it is now -
 * even into another parent, since it is found by key, not by node. A key seen
 * for the first time fades in. Positions are taken relative to the container,
 * so scrolling moves nothing, and a resize re-measures without animating.
 * A render that moves nothing leaves a glide in flight alone; one that moves
 * the element again picks the glide up from where it is drawn. With reduced
 * motion everything lands where it is.
 */
export function useFlip(container: RefObject<HTMLElement | null>, durationMs = 450) {
  const spots = useRef<Map<string, Spot> | null>(null);

  const measure = (box: HTMLElement) => {
    const origin = box.getBoundingClientRect();
    const next = new Map<string, { el: HTMLElement; spot: Spot; offset: Spot }>();
    for (const el of box.querySelectorAll<HTMLElement>("[data-flip]")) {
      const r = el.getBoundingClientRect();
      const offset = offsetOf(el);
      // Where it sits, not where a glide in flight has it drawn.
      next.set(el.dataset.flip!, { el, offset, spot: { x: r.left - origin.left - offset.x, y: r.top - origin.top - offset.y } });
    }
    return next;
  };
  const keep = (measured: ReturnType<typeof measure>) =>
    new Map([...measured].map(([key, { spot }]) => [key, spot]));

  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return;
    const next = measure(box);
    const before = spots.current;
    spots.current = keep(next);
    if (!before || prefersReducedMotion()) return;
    const timing = { duration: durationMs, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
    for (const [key, { el, spot, offset }] of next) {
      const was = before.get(key);
      if (!was) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, duration: durationMs * 0.6 });
        continue;
      }
      // Where it was drawn a moment ago, relative to where it sits now.
      const dx = was.x + offset.x - spot.x;
      const dy = was.y + offset.y - spot.y;
      if (Math.abs(dx - offset.x) < 1 && Math.abs(dy - offset.y) < 1) continue;
      for (const a of el.getAnimations()) if (a.id === "flip") a.cancel();
      // Lifted above its neighbours for the trip, so a tile crossing a column is not drawn under it.
      const glide = el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 10 },
          { transform: "none", zIndex: 10 },
        ],
        timing,
      );
      glide.id = "flip";
    }
  });

  useEffect(() => {
    const box = container.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      spots.current = keep(measure(box));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [container]);
}
