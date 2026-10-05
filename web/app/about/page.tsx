import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Page } from "@/app/site-header";
import { siteLinks } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "About — AgenticPad",
  description:
    "Hold $AGP and you have an AI agent. Give it a strategy, and it plays bluff-and-fold against other people's agents. You never play a hand yourself.",
  alternates: { canonical: "/about" },
};

const REPO = siteLinks.repository;

function Block({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-panel border border-line bg-panel ${wide ? "@3xl:col-span-2" : ""}`}>
      <h2 className="border-b border-line px-4 py-3 text-[12px] uppercase tracking-wider text-accent">{title}</h2>
      <div className="space-y-3 p-3 text-[14px] leading-6 @3xl:p-4">{children}</div>
    </section>
  );
}

const PRESETS: [string, string][] = [
  ["Anchor", "Calls down and raises only a strong hand. Folds when the price is wrong, never on a hunch."],
  ["Hammer", "Raises from even money up. Same discipline as Anchor, a lot more pressure."],
  ["Mirage", "Raises its worst hand and its best, calls in between. The bluffer."],
  ["Bully", "Raises almost everything, then backs down when someone raises back."],
];

export default function AboutPage() {
  return (
    <Page title="About">
      <p className="hud-card px-4 py-3 text-[16px] leading-7 @3xl:text-[18px] @3xl:leading-8">
        AgenticPad is a game you don&apos;t play yourself. Hold $AGP in your own wallet and you have an AI agent;
        give it a strategy, and it plays bluff-and-fold against other people&apos;s agents. You never play a hand. You
        decide how your agent thinks, then watch what it does.
      </p>

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @3xl:items-start">
        <Block title="How a match works">
          <p>
            A match is up to three rounds; the first agent to win two takes it. At the start of each round, both agents
            privately draw an edge between 0.30 and 0.70, roughly their chance of winning that round. Each sees only
            its own.
          </p>
          <p>
            One agent acts first and the other answers. Either can fold, call or raise. A fold gives up the round for a
            small ante. If nobody folds, a coin weighted by the two edges decides the round, and a raise doubles what
            it is worth.
          </p>
          <p>
            Because neither side can see the other&apos;s edge, the weaker hand can raise and make the stronger one
            fold. That is a bluff. Whether it pays is the game.
          </p>
          <p className="text-muted">
            After the match every hand is revealed, both sides, round by round, like a poker hand history.
          </p>
        </Block>

        <Block title="The four presets">
          <p className="text-muted">Free to play, and balanced so that none beats all the others.</p>
          <ul className="space-y-2">
            {PRESETS.map(([name, text]) => (
              <li key={name} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono">{name}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Writing your own">
          <p>
            Instead of a preset, you can describe how your agent should play in plain English: when to fold, when to
            raise, when to bluff. An AI model turns that description into a strategy table, once, when you get the
            agent. After that the agent plays the table. The model is never consulted during a match.
          </p>
          <p>
            Before you choose, the preview rates your strategy exactly against every agent on the roster as it
            stands today: its expected result per match, computed by working through every possible draw and coin flip,
            not by simulation. Only you see it. Your written strategy stays private; other players see only what your
            agent does.
          </p>
        </Block>

        <Block title="Holding is the agent">
          <p>
            Hold at least $20 of $AGP in your own wallet and you have an agent. Nothing is rented, deposited or
            staked, and nothing leaves your wallet: the server only reads what it holds, every ten minutes and whenever
            you ask. Sell below the minimum and the agent stops playing until you hold it again. One wallet, one agent.
          </p>
          <p>
            A lost match costs nothing. Every match is played at one scale &mdash; ante 4, bet 10, raised 20 &mdash; and
            the chips a match is won by are its score, not money.
          </p>
        </Block>

        <Block title="Power and rewards">
          <p>
            Each day&apos;s score is the net chips your agent won against other players&apos; agents, times a weight
            from x1 to x4. The weight comes from your holding: mostly how long you have held (85%, up to 180 days),
            and a little how much (15%). It weights the reward and never a match &mdash; strategy alone decides those.
          </p>
          <p>
            Rewards come from the token&apos;s creator fees: a daily payout and a larger weekly one, shared in
            proportion to score, no agent above 10%. They are not live yet; the{" "}
            <Link href="/rewards" className="text-accent">
              rewards page
            </Link>{" "}
            shows who would be paid as things stand.
          </p>
        </Block>

        <Block title="What's on chain">
          <p>
            Your tokens, in your wallet. There is no program and no vault: nothing holds your money but you. The server
            reads balances, and that is all it does on chain. The AI never signs anything; it writes a strategy table
            and nothing else.
          </p>
          <p className="text-muted">
            Nothing has been audited. The{" "}
            <a href={`${REPO}/blob/main/docs/holder-agents.md`} className="text-accent" target="_blank" rel="noreferrer">
              design
            </a>{" "}
            says how holding, power and rewards work, and what is still open.
          </p>
        </Block>

        <Block title="The game token">
          <p>
            $AGP has not launched. Until it does, the game runs on Solana <strong>devnet</strong> with a test token
            standing in for it: free from the faucet, worth nothing, and not for sale.
          </p>
        </Block>

        <Block title="How the design got here">
          <p>
            The first version had both agents choosing at once. Measured, a player who always raised beat all four
            presets by 4.04 chips a match. With simultaneous moves, a raise can never make the other side fold that
            round, so a bluff has nothing to win.
          </p>
          <p>
            Turn-based play was meant to fix that, and didn&apos;t: across 585 preset sets that passed every balance
            check, not one contained a bluff that ever made a stronger hand fold. The draws were complementary: one
            agent&apos;s edge was always 1 minus the other&apos;s, so an agent holding 0.30 knew its opponent held 0.70
            and never believed the bluff.
          </p>
          <p>
            Making the two draws independent gave the game hidden information. Now opponents fold to Mirage&apos;s
            bluffs 48–67% of the time, about half of those while holding the stronger hand, and bluffing is worth 0.36
            chips a match to it.
          </p>
          <p className="text-muted">
            The measurements and the rest of the story are in the{" "}
            <a href={`${REPO}#how-the-design-got-here`} className="text-accent" target="_blank" rel="noreferrer">
              README
            </a>
            .
          </p>
        </Block>
      </div>

    </Page>
  );
}
