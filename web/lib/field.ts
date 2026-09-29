"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type FieldAgent } from "@/lib/api";
import { isPlaying, useLive, type Arrival } from "@/lib/live";

/** How often the roster is read again. Who is playing needs no poll: the live stream says. */
const POLL_MS = 5_000;

/** The matches still playing out, newest first, so an agent in two at once is shown in the newer. */
export function usePlayingNow(): Arrival[] {
  const live = useLive();
  // The stream moves `now` when a playback ends, so this settles without a timer.
  return useMemo(() => live.arrivals.filter((a) => isPlaying(a, live.playMs, live.now)), [live.arrivals, live.playMs, live.now]);
}

/**
 * Everyone on the field, kept fresh: re-read on a timer while the tab is
 * visible, straight away when it comes back, and straight away when a match
 * starts with an agent not on it yet - a new rental, which then arrives with
 * its first match rather than up to a poll later.
 */
export function useField(initial: FieldAgent[] | null, playing: Arrival[]): FieldAgent[] | null {
  const [agents, setAgents] = useState(initial);
  const [refresh] = useState(() => () => {
    if (!document.hidden) api.field().then((r) => setAgents(r.agents), () => {});
  });
  useEffect(() => {
    if (!initial) refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initial, refresh]);

  const stranger = useMemo(() => {
    if (!agents) return null;
    const known = new Set(agents.map((a) => a.id));
    return playing.flatMap((a) => [a.match.a.id, a.match.b.id]).find((id) => !known.has(id)) ?? null;
  }, [agents, playing]);
  useEffect(() => {
    if (stranger) refresh();
  }, [stranger, refresh]);

  return agents;
}
