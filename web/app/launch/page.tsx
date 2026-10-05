import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/app/site-header";
import { LAUNCHPAD } from "@/lib/launchpad";
import { LaunchIndex } from "./index-view";

export const metadata: Metadata = {
  title: "Launch Pad — AgenticPad",
  description: "Launch a token on pump.fun with an optional initial buy. Creator fees go to AgenticPad's reward and platform wallets.",
  alternates: { canonical: "/launch" },
};

export default function LaunchPage() {
  if (!LAUNCHPAD) notFound();
  return (
    <Page title="Launch Pad" intro="Launch a token on pump.fun. Its creator fees go to AgenticPad's reward and platform wallets.">
      <LaunchIndex />
    </Page>
  );
}
