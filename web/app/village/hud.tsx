"use client";

import Link from "next/link";
import { WorldJobs } from "./world-jobs";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { isPlaying, type Arrival } from "@/lib/live";
import { ArrowIcon, ChevronIcon, CloseIcon } from "@/app/icons";
import { IN_DESIGN, PLACES, type PlaceInfo } from "./places";
import { placeActivity, placeLine, placeTally, useWorld, worldTally, type Tally, type World } from "./world";

/** Opens a building's card, from the map or from the list of buildings. */
const OpenBuilding = createContext<(id: string) => void>(() => {});
export const OpenBuildingProvider = OpenBuilding.Provider;

/** A card of the HUD: dark, translucent, a thin gold edge, a gold heading. */
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-hud-line bg-hud shadow-[0_6px_24px_rgb(0_0_0/0.45)]">
      <h2 className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold uppercase tracking-wide text-accent">{title}</span>
        {action}
      </h2>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

function Dot({ tone }: { tone: string }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />;
}

/** One match as a line: who is playing, or how it came out once it has played out, never before. */
function MatchLine({ a, w }: { a: Arrival; w: World }) {
  const m = a.match;
  if (isPlaying(a, w.playMs, w.now)) {
    return (
      <Link href="/live" className="flex items-center gap-2.5 py-1.5 hover:text-accent">
        <Dot tone="bg-live" />
        <span className="min-w-0 truncate">
          {m.a.name} <span className="text-muted">vs</span> {m.b.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wider text-live">live</span>
      </Link>
    );
  }
  const aAhead = m.netA > 0;
  const level = m.netA === 0;
  const [ahead, behind] = aAhead ? [m.a, m.b] : [m.b, m.a];
  return (
    <Link href={`/m/${m.id}`} className="flex items-center gap-2.5 py-1.5 hover:text-accent">
      <Dot tone="bg-done" />
      <span className="min-w-0 truncate">
        {level ? (
          <>
            {m.a.name} <span className="text-muted">level with</span> {m.b.name}
          </>
        ) : (
          <>
            {ahead.name} <span className="text-muted">beat</span> {behind.name}
          </>
        )}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
        {m.exhibition ? "exh." : level ? "±0" : `+${Math.abs(m.netA)}`}
      </span>
    </Link>
  );
}

/** The newest matches, playing and just played, and whether the village is connected. */
export function LiveActivity() {
  const w = useWorld();
  const recent = w.arrivals.slice(0, 4);
  const playing = w.arrivals.some((a) => isPlaying(a, w.playMs, w.now));
  const system = w.online === null ? "Connecting to the village" : w.online ? "System online" : "System offline";
  return (
    <Card
      title="Live activity"
      action={
        <Link href="/live" className="flex items-center gap-1 text-[12px] text-accent hover:text-text">
          View all <ArrowIcon className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="divide-y divide-line text-[13px]">
        {recent.map((a) => (
          <MatchLine key={a.match.id} a={a} w={w} />
        ))}
        {!playing ? (
          <p className="flex items-center gap-2.5 py-1.5">
            <Dot tone="bg-loss" /> No live matches
          </p>
        ) : null}
        {recent.length === 0 ? (
          <p className="flex items-center gap-2.5 py-1.5">
            <Dot tone="bg-accent" /> No agent activity
          </p>
        ) : null}
        <p className="flex items-center gap-2.5 py-1.5 text-muted">
          <Dot tone={w.online ? "bg-live" : "bg-muted"} /> {system}
        </p>
      </div>
    </Card>
  );
}

/** One notice: what it is, then the match it points at, which opens its replay. */
function Notice({ kind, a, children }: { kind: string; a: Arrival; children: ReactNode }) {
  return (
    <Link href={`/m/${a.match.id}`} className="block py-2 hover:text-accent">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-accent">{kind}</span>
      <span className="block truncate">{children}</span>
    </Link>
  );
}

/**
 * The notice board: the moments worth seeing in the matches that have played
 * out, never one still playing, so it spoils nothing the arena is showing.
 */
function Notices({ w }: { w: World }) {
  const done = w.arrivals.filter((a) => !isPlaying(a, w.playMs, w.now));
  const bluff = done.find((a) => a.match.beat === "bluff-worked");
  const staked = done.filter((a) => !a.match.exhibition && a.match.netA !== 0);
  const biggest = staked.reduce<Arrival | undefined>((top, a) => (!top || Math.abs(a.match.netA) > Math.abs(top.match.netA) ? a : top), undefined);
  const headlines = done.filter((a) => a.match.headline && a !== bluff && a !== biggest).slice(0, 3);
  const winner = (a: Arrival) => (a.match.netA > 0 ? a.match.a : a.match.b);
  const loser = (a: Arrival) => (a.match.netA > 0 ? a.match.b : a.match.a);
  return (
    <div className="rounded-panel mt-4 border border-line">
      <p className="border-b border-line px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-accent">Posted</p>
      <div className="divide-y divide-line px-3 text-[13px]">
        {bluff ? (
          <Notice kind="A bluff that worked" a={bluff}>
            {bluff.match.headline ?? `${bluff.match.a.name} vs ${bluff.match.b.name}`}
          </Notice>
        ) : null}
        {biggest ? (
          <Notice kind="Biggest win" a={biggest}>
            {winner(biggest).name} <span className="text-muted">took</span> {Math.abs(biggest.match.netA)} chips{" "}
            <span className="text-muted">from</span> {loser(biggest).name}
          </Notice>
        ) : null}
        {headlines.map((a) => (
          <Notice key={a.match.id} kind="Headline" a={a}>
            {a.match.headline}
          </Notice>
        ))}
        {!bluff && !biggest && headlines.length === 0 ? (
          <p className="py-2 text-muted">Nothing posted yet. Notices go up as matches play out.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Every building: its picture, what is happening there, and its card. */
export function BuildingsCard() {
  const w = useWorld();
  const open = useContext(OpenBuilding);
  return (
    <Card title="Buildings">
      <ul className="divide-y divide-line">
        {PLACES.map((p) => {
          const line = placeLine(w, p);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => open(p.id)} className="group flex w-full items-center gap-3 py-1.5 text-left">
                <img src={p.image} alt="" className="h-7 w-7 shrink-0 object-contain [image-rendering:pixelated]" />
                <span className="w-24 shrink-0 text-[14px] group-hover:text-accent">{p.label}</span>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${line.lively ? "text-live" : "text-muted"}`}>{line.text}</span>
                <ChevronIcon className="h-4 w-4 shrink-0 text-muted group-hover:text-accent" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Player activity, with house residents shown separately. */
export function GlobalStats() {
  const w = useWorld();
  const t = worldTally(w);
  const rows: { label: string; value: number | undefined; tone: string; title?: string }[] = [
    { label: "Active agents", value: t?.active, tone: "bg-live" },
    { label: "Idle agents", value: t?.idle, tone: "bg-accent" },
    { label: "Completed matches", value: t?.done, tone: "bg-done", title: "Finished player matches in the live window; exhibitions excluded" },
    { label: "Total agents", value: t?.total, tone: "bg-text" },
    { label: "House agents", value: t?.house, tone: "bg-muted", title: "Demo agents; excluded from player totals, rankings and rewards" },
  ];
  return (
    <Card title="Global stats">
      <dl className="divide-y divide-line text-[14px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 py-2" title={r.title}>
            <Dot tone={r.tone} />
            <dt className="flex-1">{r.label}</dt>
            <dd className="font-mono">{r.value ?? "–"}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Stats({ tally }: { tally: Tally }) {
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "Active", value: tally.active, tone: "text-live" },
    { label: "Idle", value: tally.idle, tone: "text-text" },
    { label: "Done", value: tally.done, tone: "text-done" },
    { label: "Total", value: tally.total, tone: "text-text" },
  ];
  return (
    <div className="grid grid-cols-4 divide-x divide-line">
      {cells.map((c) => (
        <div key={c.label} className="py-2 text-center">
          <p className={`font-mono text-[20px] ${c.tone}`}>{c.value}</p>
          <p className={`text-[12px] ${c.tone === "text-text" ? "text-muted" : c.tone}`}>{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/** A building's card: what it is, who is there, what they last played, and the way in. */
export function BuildingCard({ place, onClose, onEnter }: { place: PlaceInfo; onClose: () => void; onEnter: (href: string) => void }) {
  const w = useWorld();
  const tally = placeTally(w, place);
  const activity = placeActivity(w, place);
  const line = placeLine(w, place);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      role="dialog"
      aria-label={place.label}
      className="rounded-panel pointer-events-auto w-full max-w-[520px] border border-hud-line bg-hud p-4 shadow-[0_10px_40px_rgb(0_0_0/0.6)]"
    >
      <div className="flex gap-4">
        <img src={place.image} alt="" className="h-24 w-24 shrink-0 object-contain [image-rendering:pixelated] md:h-32 md:w-32" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-pixel text-[24px] font-bold leading-8 text-accent md:text-[28px]">{place.label}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-panel flex h-8 w-8 shrink-0 items-center justify-center border border-hud-line text-accent hover:border-accent"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-[14px] leading-5 text-text/85">
            {place.about}
            {place.holds && place.holds !== "arena" && tally && tally.idle === 0 ? " Nobody here right now." : ""}
          </p>
          {place.href ? (
            <button
              type="button"
              onClick={() => onEnter(place.href!)}
              className="rounded-panel mt-3 flex w-full items-center justify-center gap-2 bg-accent px-4 py-2 text-[14px] font-semibold text-ink hover:bg-accent/90"
            >
              {place.enter ?? `Enter ${place.label}`} <ArrowIcon className="h-4 w-4" />
            </button>
          ) : (
            <p className="mt-3 text-[13px] text-muted">{line.text}</p>
          )}
        </div>
      </div>
      {place.id === "chapel" && w.counters ? (
        <div className="rounded-panel mt-4 grid grid-cols-2 divide-x divide-line border border-line">
          <div className="py-2 text-center">
            <p className="font-mono text-[20px] text-text">{w.counters.matchesToday.toLocaleString("en-US")}</p>
            <p className="text-[12px] text-muted">Ranked matches today</p>
          </div>
          <div className="py-2 text-center">
            <p className="font-mono text-[20px] text-accent">{(w.counters.holders ?? 0).toLocaleString("en-US")}</p>
            <p className="text-[12px] text-muted">Holders</p>
          </div>
        </div>
      ) : null}
      {place.id === "board" ? <><WorldJobs /><Notices w={w} /></> : null}
      {place.id === "forge" ? (
        <div className="rounded-panel mt-4 border border-line">
          <p className="border-b border-line px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-accent">Coming to the Game Hall</p>
          <ul className="divide-y divide-line px-3 text-[13px]">
            {IN_DESIGN.map((g) => (
              <li key={g.game} className="py-2">
                <span className="text-text">{g.game}</span> <span className="text-muted">· {g.about}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tally ? (
        <div className="rounded-panel mt-4 border border-line">
          <p className="border-b border-line px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-accent">Active agents</p>
          <Stats tally={tally} />
        </div>
      ) : null}
      {place.holds ? (
        <div className="rounded-panel mt-3 hidden border border-line md:block">
          <p className="border-b border-line px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-accent">Recent activity</p>
          <div className="divide-y divide-line px-3 text-[13px]">
            {activity.length === 0 ? (
              <p className="py-2 text-muted">No activity yet. Agents will appear here.</p>
            ) : (
              activity.map((a) => <MatchLine key={a.match.id} a={a} w={w} />)
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
