/** Thin client for the HTTP layer. */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type Preset = { name: string; description: string; policyTable: Record<string, Record<string, string>> };
export type RosterAgent = {
  agentId: string;
  name: string;
  presetName: string | null;
  /** The agent's own emoji. */
  mark?: string | null;
  matchesPlayed: number;
  cumulativeNet: number;
  recentForm: number;
  balance: number;
};
/** The least an agent must hold to play, in chips: $20. Mirrors MIN_FUNDING_CHIPS on the server. */
export const MIN_FUNDING_CHIPS = 3_600;

export type PreviewBreakdown = { weight: number; expectedNet: number };
export type Preview = {
  trueRating: number;
  basis: string;
  /** True when rated against other players' agents: then it is exactly what rewards score, per match. */
  scoring?: boolean;
  roster: number;
  breakdown: PreviewBreakdown[];
};
/** An agent's character: presentation only. Mirrors src/character/store.ts. */
export type Character = {
  epithet: string;
  bio: string;
  /** "fox", "porcelain", "visor": what the character is. */
  type: string;
  nameSource: "owner" | "generated";
  /** Owner's view only: a chosen name still waiting for its check. */
  pendingName?: string | null;
};

/** Measured from real play. Mirrors src/character/traits.ts. */
export type Trait = { rate: number; word: string } | null;
export type Traits = {
  decisions: number;
  bluff: Trait;
  fold: Trait;
  aggression: Trait;
  underPressure: { word: "holds firm" | "backs down" | "pushes back"; foldShift: number; raiseShift: number } | null;
  note: string | null;
};


/**
 * How an agent is funded. "holder" is the model being built
 * (docs/holder-agents.md): the wallet holds $CLASH above the minimum and that
 * is the agent - nothing rented, deposited or withdrawn.
 */
export type Funding = "seed" | "deposit" | "holder";

/** A wallet's holding against the minimum, and the conviction clock it keeps. Chips throughout. */
export type HoldingView = {
  amount: number;
  chips: number;
  minimum: number;
  minimumChips: number;
  /** Holds the minimum - or, once its clock runs, what it qualified with. */
  eligible: boolean;
  readAt: string | null;
  conviction: { amount: number | null; chips: number | null; since: string | null; days: number };
};

/** What a holder's power is made of, and the weight it earns now. Weights the reward, never a match. */
export type PowerView = {
  convictionDays: number;
  convictionCapDays: number;
  /** 0 to 1. */
  conviction: number;
  shareOfSupply: number;
  /** 0 to 1. */
  position: number;
  power: number;
  /** x1 to x4. */
  weight: number;
};

export type HolderView = { holding: HoldingView; power: PowerView };

export type ScoreRow = {
  agentId: string;
  name: string;
  presetName: string | null;
  mark: string | null;
  rankedMatches: number;
  points: number;
  qualified: boolean;
  convictionDays: number;
  shareOfSupply: number;
  power: number;
  weight: number;
  score: number;
  /** Fraction of the payout, under the 10% cap. 0 when not qualified. */
  share: number;
};

export type SeasonScoreRow = {
  agentId: string;
  name: string;
  presetName: string | null;
  mark: string | null;
  rankedMatches: number;
  points: number;
  score: number;
  days: number;
  qualified: boolean;
  share: number;
};

export type Scores = {
  day?: { day: string; frozen: boolean; params: { opponentCap: number; minDailyMatches: number }; rows: ScoreRow[] };
  season?: { season: string; frozen: boolean; params: { minSeasonMatches: number }; rows: SeasonScoreRow[] };
};

export type AgentView = {
  /**
   * How this agent was funded. Every agent in play is a "holder"; "seed" and
   * "deposit" are agents from before, all retired, kept for their records.
   */
  funding?: Funding;
  /** Portrait, epithet and bio. Null for an agent not yet given one. */
  character?: Character | null;
  traits?: Traits;
  agentId?: string;
  id?: string;
  name: string;
  presetName: string | null;
  /** The agent's own emoji. */
  mark?: string | null;
  brief?: string | null;
  matchesPlayed?: number;
  cumulativeNet?: number;
  /** Player-versus-player only: what the ladder counts. */
  rankedMatches?: number;
  rankedNet?: number;
  recentForm?: number;
  balance?: number;
  /** The least an agent must hold to play, in chips. */
  minToPlay?: number;
  /** False when the balance is below that minimum. */
  canPlay?: boolean;
  retired?: boolean;
  trueRating?: number | null;
  trueRatingBasis?: string;
};
export type LadderRow = {
  agentId: string;
  name: string;
  presetName: string | null;
  /** The agent's own emoji. */
  mark?: string | null;
  /** Player-versus-player only: what the ladder ranks on. */
  matchesPlayed: number;
  cumulativeNet: number;
  netPerMatch?: number;
  rankedStaked?: number;
  /** Every staked match, house opponents included. Shown, never ranked. */
  totalMatches?: number;
  totalNet?: number;
  recentForm: number;
  balance: number;
  retired: boolean;
};
export type PlayResult = {
  matchId: string;
  opponent: { id: string; name: string; presetName?: string | null; mark?: string | null };
  matchmaking: { path: string; candidates: number; ratingGap: number | null };
  stake: number;
  result: { winner: "A" | "B" | null; net: number; opponentNet: number; rounds: number; uncappedNet: number };
  balance: number;
  retired: boolean;
  /** False when the opponent was a house agent: it doesn't count. */
  ranked?: boolean;
};

/** Mirrors src/db/autoplay.ts. `held` clears itself; `paused` needs the owner. */
export type AutoplayState = "off" | "on" | "waiting" | "held" | "paused";
export type AutoplayStatus = {
  enabled: boolean;
  floor: number | null;
  state: AutoplayState;
  message: string | null;
  action: string | null;
  stop: { reason: "floor" | "insolvent" | "retired" | "withdrawal" | "season" | "exit"; hold: boolean } | null;
  lastMatchAt: string | null;
  nextMatchAt: string | null;
  waitingSince: string | null;
  today: { matches: number; net: number };
  intervalMs: number;
};
export type SinceYouLeft = {
  since: string;
  matches: number;
  net: number;
  bestHand: { matchId: string; net: number; headline: string | null; createdAt: string } | null;
};

/** One agent on the field. Mirrors field() in src/db/runner.ts. */
export type FieldAgent = {
  id: string;
  name: string;
  mark: string | null;
  presetName: string | null;
  /** Unowned: plays exhibitions, never for money. */
  house: boolean;
  /** Set for the minute after it retires, while it is shown leaving. */
  retiredAt: string | null;
};

/** One match as the public feed shows it. Mirrors the API's FeedItem. */
export type FeedItem = {
  id: string;
  seq: number;
  createdAt: string;
  a: { id: string; name: string; presetName: string | null; mark: string | null };
  b: { id: string; name: string; presetName: string | null; mark: string | null };
  winner: "A" | "B" | null;
  netA: number;
  netB: number;
  stake: number;
  rounds: number;
  headline: string | null;
  /** Both sides player-rented. Staked but unranked means a house opponent. */
  ranked?: boolean;
  beat: string | null;
  beatSeat: "A" | "B" | null;
  /** House agents playing each other: nothing was staked or settled. */
  exhibition: boolean;
};
export type Feed = { matches: FeedItem[]; bluff: FeedItem | null };
export type AgentRecord = { wins: number; losses: number; level: number };

/** Which matches a ladder counts: today in UTC, the season in play, or everything. */
export type LadderPeriod = "day" | "season" | "all";

/** The season in play. Mirrors GET /season. */
export type SeasonInfo = { key: string; number: number; startsAt: string; endsAt: string };



export type ExitState = {
  /** Chips asked for. The claim pays at most this, and at most what the vault still holds. */
  amount: number;
  requestedSlot: number;
  unlockSlot: number;
  /** About when the window is up. An estimate: the chain's clock is slots. */
  unlockAt: string;
  claimable: boolean;
  claimed: boolean;
  claimedAmount: number | null;
  /** True once the ledger has taken account of the claim, which is when the agent is free again. */
  settled: boolean;
};

/**
 * The devnet faucet. Absent on any other network, where these endpoints answer
 * 503 and nothing should offer the button.
 */
export type FaucetStatus = {
  /** Base units a grant hands out. */
  amount: number;
  /** The same in chips, which is what the screen says. */
  chips: number;
  available: boolean;
  /** When this wallet may ask again; null when it may now. */
  nextAt: string | null;
};



export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      // Only with a body: on a plain GET it would force a CORS preflight, doubling every request.
      ...(rest.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body["error"] === "string" ? body["error"] : `request failed (${res.status})`,
      Number(res.headers.get("retry-after")) || undefined,
    );
  }
  return body as T;
}

export const api = {
  presets: () => request<{ presets: Preset[]; free: boolean }>("/presets"),
  /** Who you are signed in as, and every agent that wallet owns - on any device. */
  me: (token: string | null) =>
    request<{
      ownerId: string;
      agents: AgentView[];
      /** This wallet's last reading against the minimum; null where the server reads no holdings. */
      holding: HoldingView | null;
    }>("/auth/me", { token }),
  previewTable: (token: string | null, policyTable: unknown) =>
    request<{ preview: Preview }>("/preview", { method: "POST", token, body: JSON.stringify({ policyTable }) }),
  previewBrief: (token: string | null, brief: string) =>
    request<{ preview: Preview; policyTable: unknown; elicitation: { free: boolean } | null }>("/preview", {
      method: "POST",
      token,
      body: JSON.stringify({ brief }),
    }),
  /** Gets this wallet an agent, if it holds the minimum. Nothing is signed or paid. */
  rent: (token: string | null, input: { name?: string; presetName?: string; brief?: string }) =>
    request<{
      agent: AgentView;
      elicitation: { free: boolean } | null;
    }>("/agents", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    }),
  agent: (token: string | null, id: string) =>
    request<{
      agent: AgentView;
      view: string;
      autoplay?: AutoplayStatus;
      sinceYouLeft?: SinceYouLeft | null;
      /** Owner view of a holder agent: its wallet, clock and power. */
      holder?: HolderView | null;
    }>(
      `/agents/${id}`,
      { token },
    ),
  setAutoplay: (token: string | null, id: string, input: { enabled: boolean; floor?: number | null }) =>
    request<{ autoplay: AutoplayStatus }>(`/agents/${id}/autoplay`, { method: "POST", token, body: JSON.stringify(input) }),
  markSeen: (token: string | null, id: string) => request<{ ok: true }>(`/agents/${id}/seen`, { method: "POST", token }),
  play: (token: string | null, id: string) => request<PlayResult>(`/agents/${id}/play`, { method: "POST", token }),
  match: (id: string) => request<{ transcript: string }>(`/matches/${id}`),
  roster: () => request<{ agents: RosterAgent[] }>("/roster"),
  /**
   * Everything, exhibitions included. The live stream carries them, so asking
   * for staked-only here would show one thing on first paint and another a
   * second later. Every row says which it is.
   */
  feed: (limit = 12, before?: number) =>
    request<Feed>(`/matches?staked=false&limit=${limit}${before === undefined ? "" : `&before=${before}`}`),
  faucet: (token: string | null) => request<{ faucet: FaucetStatus }>("/faucet", { token }),
  claimFaucet: (token: string | null) =>
    request<{ grant: { amount: number; chips: number; signature: string } }>("/faucet", { method: "POST", token }),
  /** Everyone in play, and whoever retired in the last minute. */
  field: () => request<{ agents: FieldAgent[]; at: string }>("/field"),
  season: () => request<{ season: SeasonInfo; graceHours: number; reminderHours: number }>("/season"),
  ladder: (sort: "winnings" | "per-match", limit = 25, period: LadderPeriod = "season") =>
    request<{ rows: LadderRow[]; season?: SeasonInfo & { current: boolean } }>(`/ladder?sort=${sort}&limit=${limit}&period=${period}`),
  admin: (token: string | null) => request<AdminHealth>("/admin", { token }),
  /** Reads this wallet's holding now, rather than waiting for the next scheduled read. */
  refreshHolding: (token: string | null) => request<{ holding: HoldingView }>("/holding", { method: "POST", token }),
  /** Holder scores: today and this season, live until frozen. */
  scores: () => request<Scores>("/scores"),
};



/** An op the operator should look at: one given up on, or one still being retried. */
export type OpTrouble = {
  id: string;
  seq: number;
  kind: string;
  status: string;
  agentId: string | null;
  agentName: string | null;
  amount: number;
  amountChips: number;
  attempts: number;
  lastError: string | null;
  ageMs: number;
};

/**
 * Operational health. Every figure here is read from somewhere that already
 * measured it; nothing on the page is a number this page invented.
 */
export type AdminHealth = {
  at: string;
  settlement: {
    lagMs: number | null;
    alarmAfterMs: number;
    stalled: boolean;
    oldest: OpTrouble | null;
  };
  settlers: { flow: string; address: string; sol: number; floorSol: number; low: boolean }[];
  /** Null when no settlement program is reachable: not zero, which would read as healthy. */
  books: {
    reconcile: {
      checked: number;
      /** A vault that genuinely disagrees with the ledger. */
      mismatches: { agentId: string; name: string; ledgerChips: number; chainChips: number | null; funding: string }[];
      surpluses: { agentId: string; name: string; surplusChips: number; funding: string }[];
      explained: { agentId: string; name: string; claimedChips: number; claimedSlot: number }[];
      /**
       * Vaults this pass could not read. Reported apart from disagreements on
       * purpose: an RPC that throttled says nothing about the money.
       */
      unverified: { agentId: string; name: string; ledgerChips: number; why: string; funding: string }[];
    };
    /**
     * Per funding flow, and never summed: the seed and deposit programs hold
     * different mints, so one total across both would add two currencies.
     */
    solvency: {
      counted: number;
      unreachable: number;
      /** Settlements queued and not yet on chain, per flow, in that flow's chips. */
      inFlightChips: Record<string, number>;
      byFlow: Record<string, { ledgerChips: number; chainChips: number; differenceChips: number; counted: number }>;
    };
  } | null;
  ops: { failed: OpTrouble[]; stuck: OpTrouble[] };
  volume: {
    agents: { active: number; retired: number; house: number };
    /** Both routes money arrives by: at rent time, and as a later top-up. */
    deposits: { confirmed: number; chips: number; pending: number; atRentChips: number; topUpChips: number };
    withdrawals: { confirmed: number; chips: number; pending: number };
    rentals: { confirmed: number; burnedChips: number; pending: number };
    matches: { staked: number; ranked: number; exhibitions: number; last24h: number };
  };
};
