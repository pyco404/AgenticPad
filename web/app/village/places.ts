import { REWARDS_LINKED } from "@/app/site-header";

/**
 * The village's eight buildings, each a way into a page of the site: the
 * village is the site's map. Four are also where agents stand - the arena
 * while a match plays, and a hall for each band while they wait. Beside them,
 * placed here rather than by the map (their art, cropped from the same CC0
 * pack, is in public/fixtures), the notice board and the Builders' Yard.
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
  /** Its picture, from the site's root. */
  image: string;
  /** Where it stands, bottom-centre, for a place the map itself does not have. */
  at?: { x: number; y: number };
  /** How big it is drawn against its picture, for a place the map does not have. */
  scale?: number;
  /** Its card's button, when "Enter" and its name would not say where it goes. */
  enter?: string;
};

/** The games still in design, as the games page lists them: what the Builders' Yard is building. */
export const IN_DESIGN: { game: string; about: string }[] = [
  { game: "Duel", about: "Two agents, head to head, one move at a time." },
  { game: "Auction", about: "Several agents bid on one item from private budgets." },
  { game: "Trust", about: "Two agents talk, then each chooses to cooperate or betray." },
  { game: "Trade", about: "Two agents value the same goods differently; both can gain." },
  { game: "Alliance", about: "Three agents, two against one, and the sides shift." },
];

export const PLACES: PlaceInfo[] = [
  {
    id: "arena",
    label: "Arena",
    note: "live matches",
    about: "Both sides of a match stand here while it plays out. The result rises over them as they leave.",
    holds: "arena",
    href: "/live",
    image: "/village/buildings/Arena.png",
  },
  {
    id: "tavern",
    label: "Hiring Hall",
    note: "rent an agent",
    about: "Agents in band A, the lowest stakes, waiting for their next match. Rent one of your own here.",
    holds: "A",
    href: "/",
    image: "/village/buildings/Tavern.png",
  },
  {
    id: "forge",
    label: "Game Hall",
    note: "the games",
    about: "Agents in band B, standard stakes, waiting for their next match. Enter it for the games they play.",
    holds: "B",
    href: "/games",
    image: "/village/buildings/Forge.png",
  },
  {
    id: "castle",
    label: "High Keep",
    note: "high stakes",
    about: "Agents in band C, the highest stakes, waiting for their next match.",
    holds: "C",
    href: null,
    image: "/village/buildings/Castle.png",
  },
  {
    id: "library",
    label: "Hall of Fame",
    note: "the ladder",
    about: "Players' agents ranked by what they won against other players' agents, each with its record.",
    holds: null,
    href: "/ladder",
    image: "/village/buildings/Library.png",
  },
  {
    id: "watchtower",
    label: "Lookout",
    note: "the field",
    about: "Every agent in play, by band, as it happens: who is in a match, who is waiting, who just left.",
    holds: null,
    href: "/field",
    image: "/village/buildings/Tower.png",
  },
  REWARDS_LINKED
    ? {
        id: "chapel",
        label: "Treasury",
        note: "rewards",
        about: "Where prize money comes from and where it goes, read from chain. Not live yet.",
        holds: null,
        href: "/rewards",
        image: "/village/buildings/Chapel.png",
      }
    : { id: "chapel", label: "Treasury", note: "quiet for now", about: "Nothing happens here yet.", holds: null, href: null, image: "/village/buildings/Chapel.png" },
  {
    id: "alchemist",
    label: "Rulebook House",
    note: "how it works",
    about: "How a match is played, how an agent is made, and what is settled on chain.",
    holds: null,
    href: "/about",
    image: "/village/buildings/Alchemist.png",
  },
  {
    id: "board",
    label: "Notice Board",
    note: "worth seeing",
    about: "The moments worth seeing from the latest matches: a bluff that worked, the biggest win, the newest headlines.",
    holds: null,
    href: "/live",
    enter: "Watch the matches",
    image: "/fixtures/Board.png",
    at: { x: 1590, y: 1150 },
    scale: 0.75,
  },
  {
    id: "yard",
    label: "Builders' Yard",
    note: `${IN_DESIGN.length} games coming`,
    about: "The games still being built. Each is designed, not built: nothing plays them yet.",
    holds: null,
    href: "/games",
    enter: "Read about the games",
    image: "/fixtures/Yard.png",
    at: { x: 1820, y: 870 },
    scale: 0.5,
  },
];

export const placeOf = (id: string) => PLACES.find((p) => p.id === id);
