"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, BANDS, type BandName, type FieldAgent } from "@/lib/api";
import { isPlaying, useLive } from "@/lib/live";
import { presetLabel } from "@/lib/agent-mark";
import { useFlip, useTicker } from "@/lib/motion";
import { LiveDot } from "@/app/live-dot";

/** How often the roster is read again. Who is playing needs no poll: the live stream says. */
const POLL_MS = 5_000;

/**
 * Everyone on the field, kept fresh: re-read on a timer while the tab is
 * visible and straight away when it comes back. `refresh` reads it now.
 */
function useField(initial: FieldAgent[] | null) {
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
  return { agents, refresh };
}

type Opponent = { id: string; name: string; mark: string | null };

/** What goes in a column: a match, both sides joined, or one agent on its own. */
type Slot = { kind: "pair"; key: string; a: FieldAgent; b: FieldAgent } | { kind: "solo"; key: string; agent: FieldAgent; vs: Opponent | null };

export function FieldBoard({ initial }: { initial: FieldAgent[] | null }) {
  const live = useLive();
  // The stream moves `now` when a playback ends, so this settles without a timer.
  // Newest first, so an agent in two playbacks at once is shown in the newer.
  const playing = useMemo(
    () => live.arrivals.filter((a) => isPlaying(a, live.playMs, live.now)),
    [live.arrivals, live.playMs, live.now],
  );
  const { agents, refresh } = useField(initial);

  // A match with an agent the board has not met: a new rental. Read the field
  // now, so it arrives with its first match rather than up to a poll later.
  const stranger = useMemo(() => {
    if (!agents) return null;
    const known = new Set(agents.map((a) => a.id));
    return playing.flatMap((a) => [a.match.a.id, a.match.b.id]).find((id) => !known.has(id)) ?? null;
  }, [agents, playing]);
  useEffect(() => {
    if (stranger) refresh();
  }, [stranger, refresh]);

  const columns = useMemo(() => {
    const byId = new Map((agents ?? []).map((a) => [a.id, a]));
    const opponent = new Map<string, Opponent>();
    const paired = new Map<string, string>();
    for (const { match } of playing) {
      if (opponent.has(match.a.id) || opponent.has(match.b.id)) continue;
      opponent.set(match.a.id, match.b);
      opponent.set(match.b.id, match.a);
      const a = byId.get(match.a.id);
      const b = byId.get(match.b.id);
      // Joined only when both are on the board in the same column; a match
      // that straddles a band change is shown on each tile instead.
      if (a && b && a.band === b.band && !a.retiredAt && !b.retiredAt) {
        paired.set(a.id, match.id);
        paired.set(b.id, match.id);
      }
    }
    return BANDS.map((band) => {
      const here = (agents ?? []).filter((a) => a.band === band.name);
      const pairs: Slot[] = [];
      const solos: Slot[] = [];
      const done = new Set<string>();
      for (const agent of here) {
        if (done.has(agent.id)) continue;
        const matchId = paired.get(agent.id);
        const other = matchId ? here.find((o) => o.id !== agent.id && paired.get(o.id) === matchId) : undefined;
        if (matchId && other) {
          done.add(other.id);
          pairs.push({ kind: "pair", key: matchId, a: agent, b: other });
        } else {
          solos.push({ kind: "solo", key: agent.id, agent, vs: agent.retiredAt ? null : (opponent.get(agent.id) ?? null) });
        }
      }
      // Matches on top, where the eye goes; everyone else keeps the order they arrived in.
      const slots = [...pairs, ...solos];
      const active = here.filter((a) => !a.retiredAt);
      return { band, slots, count: active.length, inMatch: active.filter((a) => opponent.has(a.id)).length };
    });
  }, [agents, playing]);

  const total = columns.reduce((n, c) => n + c.count, 0);
  const inMatch = columns.reduce((n, c) => n + c.inMatch, 0);
  const shownTotal = useTicker(agents ? total : undefined);
  const shownInMatch = useTicker(agents ? inMatch : undefined);

  const board = useRef<HTMLDivElement>(null);
  useFlip(board);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
        <span>
          <span className="font-mono text-[18px] text-text">{shownTotal ?? "–"}</span>{" "}
          <span className="text-muted">on the field</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[18px] text-live">{shownInMatch ?? "–"}</span>{" "}
          <span className="text-muted">in a match</span>
        </span>
        <span className="ml-auto">
          {live.status === "open" ? (
            <LiveDot label title="Connected to the live stream" />
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
              {live.status === "down" ? "offline" : "connecting"}
            </span>
          )}
        </span>
      </div>

      {agents === null ? (
        <p className="rounded-panel border border-line bg-panel p-4 text-[13px] text-muted">Couldn&apos;t load the field. Retrying…</p>
      ) : (
        <div ref={board} className="grid grid-cols-3 gap-2 lg:gap-4">
          {columns.map(({ band, slots, count, inMatch }) => (
            <section key={band.name} aria-label={`Band ${band.name}`} className="min-w-0 rounded-panel border border-line bg-panel p-1.5 lg:p-2">
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 px-1 pt-0.5">
                <h2 className="text-[13px] font-semibold tracking-wide">
                  {band.name} <span className="font-normal text-muted">· {band.label}</span>
                </h2>
                <span className="font-mono text-[11px] text-muted">
                  {count}
                  {inMatch ? <span className="text-live"> · {inMatch} live</span> : null}
                </span>
              </header>
              {slots.length === 0 ? (
                <p className="px-1 pb-1 text-[12px] text-muted">Nobody here.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
                  {slots.map((slot) =>
                    slot.kind === "pair" ? (
                      <li key={slot.key} className="col-span-full flex flex-col items-stretch rounded-panel border border-live p-1 sm:flex-row sm:items-center">
                        <Tile agent={slot.a} state="playing" />
                        <span aria-hidden className="flex shrink-0 items-center justify-center self-center font-mono text-[10px] uppercase text-live sm:px-1.5">
                          <span className="hidden h-px w-2 bg-live sm:inline-block" />
                          <span className="px-1 py-0.5 sm:py-0">vs</span>
                          <span className="hidden h-px w-2 bg-live sm:inline-block" />
                        </span>
                        <Tile agent={slot.b} state="playing" />
                      </li>
                    ) : (
                      <li key={slot.key} className="min-w-0">
                        <Tile agent={slot.agent} state={slot.agent.retiredAt ? "retired" : slot.vs ? "playing" : "waiting"} vs={slot.vs} />
                      </li>
                    ),
                  )}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>
          <span className="field-pulse mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-live align-[-1px]" aria-hidden />
          in a match, joined to its opponent
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-line bg-panel-2 align-[-1px]" aria-hidden />
          waiting for one
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-line opacity-40 align-[-1px]" aria-hidden />
          retired, leaving
        </span>
      </p>
    </div>
  );
}

const STATE_WORDS = { playing: "in a match", waiting: "waiting", retired: "retired" } as const;

function Tile({ agent, state, vs = null }: { agent: FieldAgent; state: keyof typeof STATE_WORDS; vs?: Opponent | null }) {
  const label = `${agent.name}, ${presetLabel(agent.presetName)}${agent.house ? ", house" : ""}: ${STATE_WORDS[state]}${
    vs ? ` against ${vs.name}` : ""
  }`;
  return (
    <Link
      href={`/a/${agent.id}`}
      data-flip={agent.id}
      aria-label={label}
      title={label}
      className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-panel border px-1.5 py-1.5 text-center sm:flex-row sm:gap-2 sm:px-2 sm:text-left transition-opacity duration-700 hover:border-accent ${
        state === "playing"
          ? "field-pulse border-live"
          : state === "retired"
            ? "border-line bg-panel opacity-35 grayscale"
            : "border-line bg-panel-2"
      }`}
    >
      <span aria-hidden className="shrink-0 text-[20px] leading-none">
        {agent.mark ?? <span className="font-mono text-[13px] text-muted">{agent.name.slice(0, 1)}</span>}
      </span>
      <span className="w-full min-w-0 sm:w-auto sm:flex-1">
        <span className="block truncate text-[12px] leading-4 text-text">{agent.name}</span>
        <span className="block truncate font-mono text-[10px] uppercase leading-3 tracking-wider text-muted">
          {state === "retired" ? "retired" : vs ? `vs ${vs.mark ?? vs.name}` : agent.house ? "house" : presetLabel(agent.presetName)}
        </span>
      </span>
    </Link>
  );
}
