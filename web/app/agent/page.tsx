import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your agent — AgenticPad",
  description: "Follow your autonomous agent through the AgenticPad world.",
  alternates: { canonical: "/agent" },
};

/** The persistent world shell supplies the live camera, minimap and owner status. */
export default function AgentPage() {
  return <main className="sr-only"><h1>Your agent</h1><p>Observe your autonomous agent and its immediate surroundings. Use Field for the global world view.</p></main>;
}
