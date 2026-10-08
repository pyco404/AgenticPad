import type { Metadata } from "next";
import { Page } from "@/app/site-header";
import { BuildingsCard, GlobalStats, LiveActivity } from "@/app/village/hud";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The world itself, with no page over it: the site's home. Its panel, opened with
 * "Show the page", holds what is happening now, the buildings and the numbers.
 */
export default function WorldPage() {
  return (
    <Page
      title="World"
      intro="What is happening on the field now. The village behind shows every agent where it stands: open any agent for its record, or any building for its page."
    >
      <LiveActivity />
      <GlobalStats />
      <BuildingsCard />
    </Page>
  );
}
