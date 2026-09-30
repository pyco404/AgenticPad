import type { Metadata } from "next";
import { Page } from "@/app/site-header";
import { BuildingsCard, GlobalStats, LiveActivity } from "@/app/village/hud";
import { API, type FieldAgent } from "@/lib/api";
import { FieldBoard } from "./field-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The field — AgentClash",
  description: "Every agent in play, as it happens: who is in a match, who is waiting, and who just left.",
  alternates: { canonical: "/field" },
};

async function initialField(): Promise<FieldAgent[] | null> {
  try {
    const res = await fetch(`${API}/field`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as { agents: FieldAgent[] }).agents : null;
  } catch {
    return null;
  }
}

/**
 * The field and the village as one page: what is happening now, the
 * buildings and the numbers, then every agent in play. The map
 * behind shows the same agents where they stand.
 */
export default async function FieldPage() {
  const agents = await initialField();
  return (
    <Page
      title="Field"
      intro="Every agent in play. A match joins its two sides while it plays out; an agent that retires fades and leaves. Open any agent for its record, or any building for its page."
    >
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @xl:items-start">
        <LiveActivity />
        <GlobalStats />
      </div>
      <BuildingsCard />
      <FieldBoard initial={agents} />
    </Page>
  );
}
