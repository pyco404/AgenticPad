"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useField, usePlayingNow } from "@/lib/field";
import { useLive } from "@/lib/live";
import { prefersReducedMotion } from "@/lib/motion";
import { sound } from "@/lib/sound";
import { SiteBar, useNight } from "@/app/site-bar";
import { CloseIcon } from "@/app/icons";
import { BuildingCard, OpenBuildingProvider } from "@/app/village/hud";
import { placeOf, PLACES } from "@/app/village/places";
import { placeResidents } from "@/app/village/residents";
import { placeLine, worldTally, WorldProvider, type World } from "@/app/village/world";
import type { VillageHandle } from "@/app/village/game";

/** The phone layout ends here: from md up the page is a panel on the right, below it a sheet along the bottom. */
const WIDE = "(min-width: 768px)";

/** The buttons shown with the page put away: all alike, in the bar's dark with the gold of its edge. */
const QUICK =
  "rounded-panel h-8 items-center justify-center border border-hud-line bg-hud px-4 text-[12px] font-medium uppercase tracking-wide text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)] hover:border-accent md:h-9 md:text-[13px]";

/** The longest the site waits behind its cover for the village and its agents. */
const COVER_MAX_MS = 10_000;

/** The agent whose page is open, from /a/<id>. */
const agentOf = (path: string) => /^\/a\/([^/]+)/.exec(path)?.[1] ?? null;

/** The bar's height: it covers the top of the village on every page. */
const BAR = 56;

/**
 * Every page's frame. The village is the application: it fills the window
 * behind everything and keeps playing from page to page, since this frame is
 * never unmounted by a navigation. The bar sits on top like a game's HUD; a
 * page opens as a panel over the world that can be put away to see the whole
 * of it. The world is the site's map: an
 * agent opens its record, a building its card, and the card its page.
 */
export function Shell({ children, chip }: { children: ReactNode; chip: ReactNode }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  // Closed on arrival: the village first, and a page only once someone asks for one.
  const [open, setOpen] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [night, toggleNight] = useNight();
  // A state rather than a ref, so measuring starts again whenever the panel comes and goes.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState({ right: 0, bottom: 0 });
  const [villageStatus, setVillageStatus] = useState<"loading" | "ready" | "failed">("loading");
  // If the game server can't be reached the agents never come, and a site that waited for them would stay
  // blank for good: after this long the cover lifts anyway, and the village says why it is empty.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), COVER_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  const live = useLive();
  const playing = usePlayingNow();
  const agents = useField(null, playing);
  // Each match with its playback clock, so the arena keeps the same running score as the live feed.
  const residents = useMemo(
    () => (agents ? placeResidents(agents, playing.map((a) => ({ ...a.match, startedAt: a.startedAt, playMs: live.playMs }))) : null),
    [agents, playing, live.playMs],
  );
  const world: World = useMemo(
    () => ({
      residents,
      arrivals: live.arrivals,
      playMs: live.playMs,
      now: live.now,
      counters: live.counters,
      online: live.status === "connecting" ? null : live.status === "open",
    }),
    [residents, live],
  );

  // A soft click when a building's card or a new page opens.
  useEffect(() => {
    if (building) sound.click();
  }, [building]);
  const firstPath = useRef(path);
  useEffect(() => {
    if (path !== firstPath.current) sound.click();
    firstPath.current = path;
  }, [path]);

  // A page someone went to starts at its top - the panel, not the window, is what scrolls - and closes any card.
  // The page the site loaded on stays put away until asked for.
  // Judged against the path it loaded on, not a first run: React runs effects twice on mount in development.
  const loadedOn = useRef(path);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && path === loadedOn.current) return;
    moved.current = true;
    setOpen(true);
    setBuilding(null);
    scroller.current?.scrollTo(0, 0);
  }, [path]);

  // Any link to a page of the site opens the panel, the one already showing included: a click is the ask.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='/']");
      if (a && !a.closest("footer")) setOpen(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // What the panel covers of the village, so it frames itself in the rest.
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const measure = () => {
      const r = open ? panel?.getBoundingClientRect() : undefined;
      if (!r || r.width === 0) return setInset({ right: 0, bottom: 0 });
      setInset(wide.matches ? { right: window.innerWidth - r.left, bottom: 0 } : { right: 0, bottom: window.innerHeight - r.top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panel) observer.observe(panel);
    wide.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open, panel]);

  const go = useCallback(
    (href: string) => {
      setBuilding(null);
      setOpen(true);
      router.push(href);
    },
    [router],
  );
  const place = building ? placeOf(building) : undefined;

  return (
    <WorldProvider value={world}>
      <OpenBuildingProvider value={setBuilding}>
        <Village
          world={world}
          path={path}
          inset={inset}
          night={night}
          go={go}
          openBuilding={setBuilding}
          scrolls={open ? scroller : null}
          onStatus={setVillageStatus}
        />
        <SiteBar night={night} onNight={toggleNight} />

        {open ? (
          // The page as a HUD card over the world, like the village's own: as tall as its content and no
          // taller, scrolling only when it runs longer than the screen. Inside it the site's panel and line
          // colours become the HUD's, so every page's own boxes turn into translucent, gold-edged cards too.
          <div
            ref={setPanel}
            className="hud-page pointer-events-none fixed inset-x-2 bottom-12 z-20 flex max-h-[60dvh] flex-col md:inset-x-auto md:bottom-auto md:right-4 md:top-[4.5rem] md:max-h-[calc(100dvh-8rem)] md:w-[clamp(400px,48vw,680px)]"
          >
            {/* The close X on its own above the cards, so it never sits on a page's content. */}
            <div className="flex shrink-0 justify-end pb-2 pr-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the page and see the village"
                title="Close"
                className="rounded-panel pointer-events-auto flex h-8 w-8 items-center justify-center border border-hud-line bg-hud text-accent shadow-[0_4px_16px_rgb(0_0_0/0.5)] hover:border-accent"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div ref={scroller} className="@container pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </div>
        ) : (
          // With the page put away: the way back to it, and the two things most worth doing, all in one look.
          <div className="fixed bottom-[46px] right-2 z-20 flex flex-col items-stretch gap-2 md:bottom-auto md:right-4 md:top-[4.5rem]">
            <button type="button" onClick={() => setOpen(true)} className={`flex ${QUICK}`}>
              Show the page
            </button>
            {/* Not on a phone: the ☰ menu there already has the pages and Rent. */}
            <Link href="/live" onClick={() => setOpen(true)} className={`hidden md:flex ${QUICK}`}>
              Watch matches
            </Link>
            <Link href="/" onClick={() => setOpen(true)} className={`hidden md:flex ${QUICK}`}>
              Rent an agent
            </Link>
          </div>
        )}

        {/* The footer as a chip in the bottom-right corner, on every page and with the page closed. */}
        <div className="fixed bottom-2 right-2 z-20 max-w-[calc(100vw-1rem)] md:bottom-4 md:right-4 md:max-w-[min(760px,calc(100vw-2rem))]">{chip}</div>

        {place ? (
          // A building's card, in the middle of the uncovered village; on a phone, along the bottom.
          <div
            className="pointer-events-none fixed left-0 top-14 z-20 flex items-end justify-center p-3 pb-12 md:items-center md:p-6"
            style={{ right: inset.right, bottom: inset.bottom }}
          >
            <BuildingCard place={place} onClose={() => setBuilding(null)} onEnter={go} />
          </div>
        ) : null}
        <Cover
          up={(villageStatus === "ready" && residents !== null) || villageStatus === "failed" || waited}
        />
      </OpenBuildingProvider>
    </WorldProvider>
  );
}

/** The village layer: fixed behind everything, with a light veil so what is on top of it reads. */
function Village({
  world,
  path,
  inset,
  night,
  go,
  openBuilding,
  scrolls,
  onStatus,
}: {
  world: World;
  path: string;
  inset: { right: number; bottom: number };
  night: boolean;
  go: (href: string) => void;
  openBuilding: (id: string) => void;
  /** The open page's scroller: while there is one, the wheel over the village scrolls the page rather than zooming. */
  scrolls: React.RefObject<HTMLDivElement | null> | null;
  /** How the village's own loading is going, for the frame's cover. */
  onStatus: (status: "loading" | "ready" | "failed") => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => onStatus(status), [status, onStatus]);
  // The field is re-read every few seconds; if a first read still hasn't come back after this, say why the village is empty.
  const [stranded, setStranded] = useState(false);
  const empty = world.residents === null;
  useEffect(() => {
    if (!empty) return setStranded(false);
    const timer = setTimeout(() => setStranded(true), 8_000);
    return () => clearTimeout(timer);
  }, [empty]);
  const box = useRef<HTMLDivElement>(null);
  const village = useRef<VillageHandle | null>(null);

  // With a page open, a wheel anywhere is someone reading: over the village - the margins round the panel,
  // or the strip beside it - it scrolls the page. Only ctrl or ⌘, as a trackpad pinch sends, still zooms the
  // village. Caught before it reaches the canvas, where the scene would take it as a zoom.
  useEffect(() => {
    const el = box.current;
    if (!el || !scrolls) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      scrolls.current?.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [scrolls]);
  const notes = useMemo(() => Object.fromEntries(PLACES.map((p) => [p.id, placeLine(world, p)])), [world]);
  /** The latest of everything the village is told, for when it finishes loading. */
  const latest = useRef({ world, inset, notes, night, go, openBuilding, agent: agentOf(path) });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let gone = false;
    // Building names are drawn in the HUD's pixel face: the family next/font gave it, loaded before the first draw.
    const face = getComputedStyle(document.documentElement).getPropertyValue("--font-pixel-face").trim() || "monospace";
    const loaded = document.fonts ? document.fonts.load(`18px ${face}`).catch(() => []) : Promise.resolve([]);
    // Phaser is loaded here and only here, after the page itself: never in the server render.
    Promise.all([import("./village/game"), loaded])
      .then(([{ startVillage }]) =>
        startVillage(el, {
          base: "/village",
          buildings: PLACES.map(({ id, label, note }) => ({ id, label, note })),
          still: prefersReducedMotion(),
          nameFont: face,
          events: {
            ready: () => setStatus("ready"),
            selectAgent: (id) => {
              if (id) latest.current.go(`/a/${id}`);
            },
            selectBuilding: (id) => latest.current.openBuilding(id),
          },
        }),
      )
      .then(
        (handle) => {
          if (gone) return handle.destroy();
          village.current = handle;
          const now = latest.current;
          handle.setInsets({ top: BAR, ...now.inset });
          handle.setNotes(now.notes);
          handle.setNight(now.night);
          if (now.world.residents) handle.setResidents(now.world.residents);
          handle.select(now.agent, true);
        },
        () => {
          if (!gone) setStatus("failed");
        },
      );
    return () => {
      gone = true;
      village.current?.destroy();
      village.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current.go = go;
    latest.current.openBuilding = openBuilding;
  }, [go, openBuilding]);

  const residents = world.residents;
  useEffect(() => {
    latest.current.world = world;
    if (residents) village.current?.setResidents(residents);
  }, [world, residents]);

  useEffect(() => {
    latest.current.notes = notes;
    village.current?.setNotes(notes);
  }, [notes]);

  useEffect(() => {
    latest.current.night = night;
    village.current?.setNight(night);
  }, [night]);

  useEffect(() => {
    latest.current.inset = inset;
    village.current?.setInsets({ top: BAR, ...inset });
  }, [inset]);

  // An agent's page picks it out in the village and brings the camera to it.
  const agent = agentOf(path);
  useEffect(() => {
    latest.current.agent = agent;
    village.current?.select(agent, true);
  }, [agent]);

  return (
    <div className="fixed inset-0 z-0 bg-ink">
      <div ref={box} className="absolute inset-0" style={{ touchAction: "none" }} />
      {/* The veil: enough to settle the world behind the HUD, never enough to hide it. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-ink/10" />
      {/* On a phone the bar has no room for the world's numbers: they sit on the village, top left. */}
      {status === "ready" ? <PhoneStats world={world} /> : null}
      {/* The village's own controls, kept in the part the panel leaves uncovered. */}
      <div
        className="pointer-events-none absolute left-0 top-14 z-10 flex items-end justify-between gap-2 p-2 md:p-3"
        style={{ right: inset.right, bottom: inset.bottom }}
      >
        <p
          className={`rounded-panel border border-hud-line bg-hud px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted ${
            status === "ready" && !stranded ? "hidden md:block" : "mb-10 max-w-[55%] md:mb-0 md:max-w-none"
          }`}
        >
          {status === "failed"
            ? "The village didn't load"
            : status === "loading"
              ? "Opening..."
              : stranded
                ? "Can't reach the game server, so no agents yet. Retrying…"
                : scrolls
                  ? "Drag to look around · ctrl + scroll or pinch to zoom"
                  : "Drag to look around · scroll or pinch to zoom"}
        </p>
        {status === "ready" ? (
          // The footer chip runs along the bottom-right edge, and on a narrower screen reaches under these: they sit
          // above its line - and on a phone with the page closed, above "Show the page", which sits over the chip.
          <div className={`pointer-events-auto ml-auto flex flex-col gap-1 md:mb-10 ${scrolls ? "mb-9" : "mb-[76px]"}`}>
            {([1, -1] as const).map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => village.current?.zoom(step)}
                aria-label={step > 0 ? "Zoom in" : "Zoom out"}
                className="rounded-panel h-9 w-9 border border-hud-line bg-hud text-[16px] text-text hover:border-accent"
              >
                {step > 0 ? "+" : "−"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What shows while the world is loading: only the mark, on the village's own
 * dark, over everything - no bar, no page, no half-drawn map. It fades once the
 * village is drawn with its agents standing in it, and is gone for the rest of
 * the visit: moving between pages never brings it back.
 */
function Cover({ up }: { up: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!up) return;
    const timer = setTimeout(() => setGone(true), prefersReducedMotion() ? 0 : 500);
    return () => clearTimeout(timer);
  }, [up]);
  if (gone) return null;
  return (
    <div
      aria-hidden={up}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-ink transition-opacity duration-500 motion-reduce:transition-none ${
        up ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <img src="/agentclash-tb.png" alt="" width={474} height={239} className="h-auto w-56 [image-rendering:pixelated] md:w-80" />
      <p className="font-pixel text-[44px] font-bold leading-none tracking-[0.04em] text-brand md:text-[56px]">AgentClash</p>
      <p role="status" className="text-[18px] tracking-wide text-muted md:text-[20px]">
        Opening...
      </p>
    </div>
  );
}

/**
 * The world's numbers on the village itself, top left, on every screen. On a
 * phone, two tight lines; from sm up, where the left of the village is open,
 * one number to a line.
 */
function PhoneStats({ world }: { world: World }) {
  const t = worldTally(world);
  const n = (v: number | undefined) => (v === undefined ? "–" : v);
  const state = world.online === null ? "Connecting" : world.online ? "Online" : "Offline";
  const tone = world.online === null ? "text-muted" : world.online ? "text-live" : "text-loss";
  const dot = `inline-block h-2 w-2 rounded-full ${world.online ? "live-blink bg-live" : world.online === null ? "bg-muted" : "bg-loss"}`;
  const cells: { label: string; value: number | undefined; tone: string; title?: string }[] = [
    { label: "Active", value: t?.active, tone: "text-live" },
    { label: "Idle", value: t?.idle, tone: "text-accent" },
    { label: "Done", value: t?.done, tone: "text-text", title: "Matches finished in the live window" },
    { label: "Total", value: t?.total, tone: "text-text" },
  ];
  return (
    <div
      aria-live="polite"
      className="rounded-panel pointer-events-none absolute left-2 top-16 z-10 border border-hud-line bg-hud px-3 py-2 font-mono text-[12px] leading-5 shadow-[0_4px_16px_rgb(0_0_0/0.45)] sm:left-4 sm:top-[4.5rem] sm:min-w-44 sm:px-4 sm:py-3 sm:text-[14px] sm:leading-7"
    >
      <p className="flex items-center gap-1.5 sm:justify-between sm:gap-6">
        <span className="text-muted">Status:</span>
        <span className="flex items-center gap-1.5">
          <span className={dot} aria-hidden />
          <span className={tone}>{state}</span>
        </span>
      </p>
      <p className="flex gap-3 sm:flex-col sm:gap-0">
        {cells.map((c) => (
          <span key={c.label} title={c.title} className="sm:flex sm:justify-between sm:gap-6">
            <span className="text-muted">{c.label}:</span> <span className={c.tone}>{n(c.value)}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
