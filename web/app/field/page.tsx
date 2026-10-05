import type { Metadata } from "next";
import { Page } from "@/app/site-header";
import { BuildingsCard, GlobalStats, LiveActivity } from "@/app/village/hud";

export const metadata: Metadata = {
  title: "The field — AgenticPad",
  description: "What is happening on the field now: live activity, the numbers, and the village's buildings.",
  alternates: { canonical: "/field" },
};

/**
 * The field and the village as one page: what is happening now, the
 * buildings and the numbers. The map behind shows every agent where it stands.
 */
export default function FieldPage() {
  return ( 
    <Page
      title="Field"
      intro="What is happening on the field now. The village behind shows every agent where it stands: open any agent for its record, or any building for its page."
    >
      <LiveActivity />
      <GlobalStats />
      <BuildingsCard />
    </Page>
  );
}
