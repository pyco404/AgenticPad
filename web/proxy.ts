import { NextResponse, type NextRequest } from "next/server";

// One address for the site. The API only accepts requests from the canonical
// origin, so a page served from anywhere else (the host's default domain, or
// www.) loads but cannot fetch anything, and looks empty. Send those visitors
// to the real address instead. Localhost and the host's healthcheck are left alone.
const canonical = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : null;

/** The site's former address: shared links to it still arrive, and go on to the same page at the new one. */
const FORMER = new Set(["oxude.xyz", "www.oxude.xyz"]);

export function proxy(request: NextRequest) {
  if (!canonical || canonical.hostname === "localhost") return NextResponse.next();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  // The canonical host itself is never stray, whatever the list says: redirecting it to itself would loop.
  const stray = host !== canonical.hostname && (host === `www.${canonical.hostname}` || host.endsWith(".up.railway.app") || FORMER.has(host));
  if (!stray) return NextResponse.next();
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical);
  return NextResponse.redirect(target, 308);
}

export const config = {
  // Pages only; static assets are the same everywhere.
  matcher: ["/((?!_next/|favicon|agentclash-).*)"],
};
