"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { installUrl, shortKey, type WalletName } from "@/lib/wallet";
import { PrivyOption } from "./privy-option";
import { useWallet } from "./wallet-context";
import { REWARDS_LINKED } from "./site-header";
import { useWorld } from "./village/world";
import { sound } from "@/lib/sound";
import {
  MuteIcon,
  SoundIcon,
  ChevronIcon,
  CloseIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
} from "./icons";

type Section = { href: string; label: string };

const NAV: Section[] = [
  { href: "/", label: "Home" },
  { href: "/live", label: "Live" },
  { href: "/field", label: "Field" },
  { href: "/ladder", label: "Ladder" },
  { href: "/games", label: "Games" },
  // Announces the token before it exists; NEXT_PUBLIC_SHOW_REWARDS=false hides it without a code change.
  ...(REWARDS_LINKED ? [{ href: "/rewards", label: "Rewards" }] : []),
  { href: "/about", label: "About" },
];


/** Which section a path belongs to: match pages live under Live, agent pages under Ladder. */
function sectionOf(path: string): string | null {
  if (path === "/") return "/";
  if (path.startsWith("/m/") || path.startsWith("/live")) return "/live";
  if (path.startsWith("/a/") || path.startsWith("/ladder")) return "/ladder";
  if (path.startsWith("/field")) return "/field";
  if (path.startsWith("/games")) return "/games";
  if (path.startsWith("/rewards")) return "/rewards";
  if (path.startsWith("/about")) return "/about";
  return null;
}

function Mark() {
  return (
    <Link href="/" aria-label="AgentClash home" className="flex shrink-0 items-center gap-2">
      <img src="/agentclash-tb.png" alt="" width={32} height={32} className="h-7 w-7 md:h-8 md:w-8" />
    </Link>
  );
}

/**
 * The wallet control: "Sign in" signed out, the short address signed in. Either opens a small menu rather
 * than acting on one tap, so a stray tap can't sign anyone out.
 */
function WalletControl() {
  const { session, wallets, busy, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Close once signing in or out finishes.
  useEffect(() => setOpen(false), [session]);

  const all: WalletName[] = ["Phantom", "Solflare"];
  return (
    <div ref={box} className={`relative ${session ? "min-w-0" : "shrink-0"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={session ? `Wallet ${session.ownerId}` : "Sign in"}
        className={`rounded-panel flex h-9 max-w-full items-center gap-2 truncate border px-2 text-[13px] font-medium md:h-10 md:px-3.5 ${
          session ? "border-hud-line bg-hud font-mono text-text" : "border-accent bg-accent/10 text-accent hover:bg-accent/20"
        }`}
      >
        {/* The wallet mark from tablets up; on a phone the words alone, to keep the bar's room. */}
        {session ? null : <WalletIcon className="hidden h-[18px] w-[18px] shrink-0 md:block" />}
        <span className="truncate">{busy === "connect" ? "Waiting…" : session ? shortKey(session.ownerId) : "Sign in"}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="rounded-panel absolute right-0 top-12 z-40 w-64 border border-hud-line bg-hud p-3 text-[12px] leading-5 shadow-[0_6px_18px_rgb(0_0_0/0.45)]"
        >
          {session ? (
            <>
              <p className="text-muted">
                Signed in with {session.wallet === "Privy" ? "an email or X wallet" : session.wallet}
              </p>
              <p className="mt-1 break-all font-mono text-[11px]">{session.ownerId}</p>
              <button
                type="button"
                role="menuitem"
                onClick={() => void disconnect()}
                disabled={busy === "disconnect"}
                className="rounded-panel mt-3 w-full border border-line px-3 py-2 text-[13px] text-muted hover:text-accent"
              >
                {busy === "disconnect" ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <p className="text-muted">You sign a message, not a transaction. It costs nothing and moves nothing.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {all.map((name) =>
                  wallets.includes(name) ? (
                    <button
                      key={name}
                      type="button"
                      role="menuitem"
                      onClick={() => void connect(name)}
                      disabled={busy === "connect"}
                      className="rounded-panel bg-accent px-3 py-2 text-[13px] font-medium text-ink disabled:bg-line disabled:text-muted"
                    >
                      {name}
                    </button>
                  ) : (
                    <a
                      key={name}
                      role="menuitem"
                      href={installUrl(name)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-panel border border-line px-3 py-2 text-center text-[13px] text-muted"
                    >
                      Get {name}
                    </a>
                  ),
                )}
              </div>
              {/* A second way in: an embedded wallet from an email or X login. */}
              <PrivyOption menu />
            </>
          )}
          {error ? <p className="mt-2 text-loss">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sound on or off, remembered in this browser; off until someone turns it on.
 * A browser only lets a page play sound after a click, so a visitor who left it
 * on last time hears it again from their first tap on the page.
 */
export function useSoundSetting(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let remembered = false;
    try {
      remembered = localStorage.getItem("agentclash.sound") === "1";
    } catch {
      // No storage: it stays off.
    }
    if (!remembered) return;
    setOn(true);
    const start = () => sound.setEnabled(true);
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);
  const toggle = () =>
    setOn((was) => {
      const now = !was;
      sound.setEnabled(now);
      try {
        localStorage.setItem("agentclash.sound", now ? "1" : "0");
      } catch {
        // Not remembered, but still switched.
      }
      return now;
    });
  return [on, toggle];
}

/** Day or night over the village, remembered in this browser. */
export function useNight(): [boolean, () => void] {
  const [night, setNight] = useState(false);
  useEffect(() => {
    try {
      setNight(localStorage.getItem("agentclash.night") === "1");
    } catch {
      // No storage (a private window): it is day.
    }
  }, []);
  const toggle = () =>
    setNight((n) => {
      try {
        localStorage.setItem("agentclash.night", n ? "0" : "1");
      } catch {
        // Not remembered, but still switched.
      }
      return !n;
    });
  return [night, toggle];
}


/**
 * The HUD over the village: the mark, the sections, what the world is doing,
 * day or night, and the wallet. Below xl the ☰ menu holds the sections the
 * bar has no room for - on a phone, all of them.
 */
export function SiteBar({ night, onNight }: { night: boolean; onNight: () => void }) {
  const path = usePathname() ?? "/";
  const [soundOn, toggleSound] = useSoundSetting();
  const active = sectionOf(path);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => menu.current && !menu.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-hud-line bg-hud px-3 shadow-[0_2px_10px_rgb(0_0_0/0.4)] md:px-4 xl:gap-6">
        <Mark />
        <nav className="hidden h-full min-w-0 items-stretch lg:flex" aria-label="Sections">
          {NAV.map((item) => {
            const current = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`pixel-outline relative flex items-center px-2 font-pixel text-[17px] font-bold xl:px-3.5 ${
                  current ? "text-accent" : "text-[#f5ecd8] hover:text-accent"
                }`}
              >
                {item.label}
                {current ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] bg-accent xl:inset-x-3.5" /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 md:gap-3">
          <WalletControl />
          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
            aria-pressed={soundOn}
            title={soundOn ? "Sound on" : "Sound off"}
            className="rounded-panel flex h-9 w-9 shrink-0 items-center justify-center border border-hud-line bg-hud text-accent hover:border-accent md:h-10 md:w-10"
          >
            {soundOn ? <SoundIcon className="h-5 w-5" /> : <MuteIcon className="h-5 w-5 text-muted" />}
          </button>
          <button
            type="button"
            onClick={onNight}
            aria-label={night ? "Day in the village" : "Night in the village"}
            aria-pressed={night}
            title={night ? "Day" : "Night"}
            className="rounded-panel flex h-9 w-9 shrink-0 items-center justify-center border border-hud-line bg-hud text-accent hover:border-accent md:h-10 md:w-10"
          >
            {night ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
          </button>
          <div ref={menu} className="relative xl:hidden">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
              className="rounded-panel flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-[5px] border border-hud-line bg-hud md:h-10 md:w-10"
            >
              {open ? (
                <span className="text-lg leading-none text-muted">×</span>
              ) : (
                <>
                  <span className="block h-0.5 w-5 bg-text" />
                  <span className="block h-0.5 w-5 bg-text" />
                  <span className="block h-0.5 w-5 bg-text" />
                </>
              )}
            </button>
            {open ? <MenuPanel active={active} onClose={() => setOpen(false)} /> : null}
          </div>
        </div>
      </header>

    </>
  );
}

/**
 * The menu, in Agent Quest's shape: a panel with the mark, a live dot and its
 * own close, the pages as rows, and Rent at the foot. On a phone it drops over
 * the top of the screen; from sm up it hangs under the ☰. The world's numbers
 * are not here: on a phone they sit on the village itself (shell.tsx).
 */
function MenuPanel({ active, onClose }: { active: string | null; onClose: () => void }) {
  const w = useWorld();
  return (
    <>
    {/* The rest of the screen, dimmed: a tap on it closes the menu, as in Agent Quest. */}
    <div aria-hidden onClick={onClose} className="fixed inset-0 z-40 bg-ink/20" />
    <div
      id="site-menu"
      role="dialog"
      aria-label="Menu"
      className="rounded-panel fixed inset-x-2 top-2 z-40 flex max-h-[calc(100dvh-1rem)] flex-col overflow-y-auto border border-hud-line bg-hud px-4 pb-4 pt-3 shadow-[0_10px_32px_rgb(0_0_0/0.6)] sm:inset-x-auto sm:right-3 sm:top-16 sm:w-80"
    >
      <div className="flex items-center justify-between pb-2">
        <img src="/agentclash-tb.png" alt="AgentClash" width={32} height={32} className="h-8 w-8" />
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-full ${w.online ? "live-blink bg-live" : w.online === null ? "bg-muted" : "bg-loss"}`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-panel flex h-9 w-9 items-center justify-center border border-hud-line bg-hud text-text hover:border-accent"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav aria-label="Pages" className="mt-1 border-t border-line">
        {NAV.map((item) => {
          const current = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={current ? "page" : undefined}
              className={`pixel-outline flex items-center justify-between border-b border-line py-2.5 font-pixel text-[18px] font-bold ${
                current ? "text-accent" : "text-[#f5ecd8] hover:text-accent"
              }`}
            >
              {item.label}
              <ChevronIcon className={`h-4 w-4 ${current ? "text-accent" : "text-muted"}`} />
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 flex gap-2">
        <Link
          href="/"
          onClick={onClose}
          className="rounded-panel flex h-11 flex-1 items-center justify-center bg-accent px-3 text-[13px] font-semibold text-ink hover:bg-accent/90"
        >
          Rent an agent
        </Link>
      </div>
    </div>
    </>
  );
}
