import { permanentRedirect } from "next/navigation";

/** The world is the site itself now, at /; this keeps old /field links working. */
export default function Field() {
  permanentRedirect("/");
}
