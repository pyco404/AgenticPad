import { launchStore } from "@/lib/launchpad-store";
import { MarketStore } from "@/lib/token-market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const backend = process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
    const access = await fetch(`${backend}/admin`, { headers: { authorization: request.headers.get("authorization") ?? "" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!access.ok) return Response.json({ error: "Admin access unavailable" }, { status: access.status });
    const markets = new MarketStore();
    return Response.json({ tokens: launchStore().list().filter((l) => l.confirmed).map((l) => ({ mint: l.mint, name: l.form.name, ticker: l.form.ticker, market: markets.get(l.mint) })) }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "Token monitoring unavailable" }, { status: 503 }); }
}
