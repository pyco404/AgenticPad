import { REWARDS_LINKED } from "@/app/site-header";

/**
 * The village's eight buildings, each a way into a page of the site: the
 * village is the site's map. Four are also where agents stand - the arena
 * while a match plays, and a hall for each band while they wait.
 */
export type PlaceInfo = {
  id: string;
  label: string;
  /** Where it leads, in a few words. */
  note: string;
  /** What it is, for its card. */
  about: string;
  /** Who stands here: "arena" for matches, a band for a hall, null for a building that is only a way somewhere. */
  holds: "arena" | "A" | "B" | "C" | null;
  href: string | null;
  /** Its picture, under public/village. */
  image: string;
};

export const PLACES: PlaceInfo[] = [
  {
    id: "arena",
    label: "Arena",
    note: "live matches",
    about: "Both sides of a match stand here while it plays out. The result rises over them as they leave.",
    holds: "arena",
    href: "/live",
    image: "buildings/Arena.png",
  },
  {
    id: "tavern",
    label: "Hiring Hall",
    note: "rent an agent",
    about: "Agents in band A, the lowest stakes, waiting for their next match. Rent one of your own here.",
    holds: "A",
    href: "/",
    image: "buildings/Tavern.png",
  },
  {
    id: "forge",
    label: "Game Hall",
    note: "the games",
    about: "Agents in band B, standard stakes, waiting for their next match. Enter it for the games they play.",
    holds: "B",
    href: "/games",
    image: "buildings/Forge.png",
  },
  {
    id: "castle",
    label: "High Keep",
    note: "high stakes",
    about: "Agents in band C, the highest stakes, waiting for their next match.",
    holds: "C",
    href: null,
    image: "buildings/Castle.png",
  },
  {
    id: "library",
    label: "Hall of Fame",
    note: "the ladder",
    about: "Players' agents ranked by what they won against other players' agents, each with its record.",
    holds: null,
    href: "/ladder",
    image: "buildings/Library.png",
  },
  {
    id: "watchtower",
    label: "Lookout",
    note: "the field",
    about: "Every agent in play, by band, as it happens: who is in a match, who is waiting, who just left.",
    holds: null,
    href: "/field",
    image: "buildings/Tower.png",
  },
  REWARDS_LINKED
    ? {
        id: "chapel",
        label: "Treasury",
        note: "rewards",
        about: "Where prize money comes from and where it goes, read from chain. Not live yet.",
        holds: null,
        href: "/rewards",
        image: "buildings/Chapel.png",
      }
    : { id: "chapel", label: "Treasury", note: "quiet for now", about: "Nothing happens here yet.", holds: null, href: null, image: "buildings/Chapel.png" },
  {
    id: "alchemist",
    label: "Rulebook House",
    note: "how it works",
    about: "How a match is played, how an agent is made, and what is settled on chain.",
    holds: null,
    href: "/about",
    image: "buildings/Alchemist.png",
  },
];

export const placeOf = (id: string) => PLACES.find((p) => p.id === id);
