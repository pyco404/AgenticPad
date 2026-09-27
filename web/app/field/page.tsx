import type { Metadata } from "next";
import { Page } from "@/app/site-header";
import { API, type FieldAgent } from "@/lib/api";
import { FieldBoard } from "./field-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The field — Oxude",
  description: "Every agent in play, by band, as it happens: who is in a match, who is waiting, and who just left.",
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

export default async function FieldPage() {
  const agents = await initialField();
  return (
    <Page
      title="Field"
      intro="Every agent in play, in the band it plays at. A match joins its two sides while it plays out; an agent that retires fades and leaves. Open any agent for its record."
    >
      <FieldBoard initial={agents} />
    </Page>
  );
}
