import { REWARDS_LINKED } from "@/app/site-header";

/**
 * The village's buildings, each a way into a page of the site: the village is
 * the site's map, laid out as the game is played (game/town.ts). Four are also
 * where agents stand - the arena while a match plays, and three halls they
 * wait at: the Hiring Hall, the Strategy Lab and the Game Hall. Where each
 * stands and how it is drawn is the town's plan; here is what it is.
 */
export type PlaceInfo = {
  id: string;
  label: string;
  /** Where it leads, in a few words. */
  note: string;
  /** What it is, for its card. */
  about: string;
  /** Who stands here: "arena" for matches, "hall" for agents waiting, null for a building that is only a way somewhere. */
  holds: "arena" | "hall" | null;
  href: string | null;
  /** Its picture on its card, from the site's root. */
  image: string;
  /** Its card's button, when "Enter" and its name would not say where it goes. */
  enter?: string;
};

/** The games still in design, as the games page lists them: what the Game Hall has coming. */
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
    about: "Where agents compete. Both sides of a match stand on the sand while it plays out, the crowd on its feet; the result rises over them as they leave.",
    holds: "arena",
    href: "/live",
    image: "/village/agentclash/arena-card.png",
  },
  {
    id: "tavern",
    label: "Hiring Hall",
    note: "get an agent",
    about: "Where it starts: agents waiting for their next match, and yours to rent. Rent one here and give it a strategy.",
    holds: "hall",
    href: "/",
    image: "/village/buildings/Tavern.png",
  },
  {
    id: "forge",
    label: "Game Hall",
    note: "the games",
    about: "Agents waiting for their next match, under the screens of the matches playing next door. Enter it for the games they play.",
    holds: "hall",
    href: "/games",
    image: "/village/agentclash/game-hall.png",
  },
  {
    id: "castle",
    label: "Strategy Lab",
    note: "plan the play",
    about: "Agents waiting for their next match, going over how they play. A strategy is a preset, or a brief in your own words that becomes the table its agent plays by: when to fold, call or raise.",
    holds: "hall",
    href: "/",
    enter: "Choose a strategy",
    image: "/village/agentclash/strategy-lab.png",
  },
  {
    id: "library",
    label: "Hall of Fame",
    note: "the ladder",
    about: "The legends: players' agents ranked by what they won against other players' agents, each with its record.",
    holds: null,
    href: "/ladder",
    image: "/village/buildings/Library.png",
  },
  {
    id: "watchtower",
    label: "Lookout",
    note: "the field",
    about: "Every agent in play, as it happens: who is in a match, who is waiting, who just left.",
    holds: null,
    href: "/field",
    image: "/village/agentclash/lookout.png",
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
    note: "standings and moments",
    about: "The town's leaderboard: who is winning, the moments worth seeing from the latest matches - a bluff that worked, the biggest win - and the newest headlines.",
    holds: null,
    href: "/live",
    enter: "Watch the matches",
    image: "/village/agentclash/leaderboard-card.png",
  },
];

export const placeOf = (id: string) => PLACES.find((p) => p.id === id);
