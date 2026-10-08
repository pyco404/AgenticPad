import { permanentRedirect } from "next/navigation";

/** The village is the site's world itself, at /. */
export default function VillagePage() {
  permanentRedirect("/");
}
