import {
  getPumpToken, LaunchError, fromThisSite, listPumpTokens, ownerOf, prepareLaunch,
  pumpConfig, readLaunchBody, statusOfLaunch, submitLaunch,
} from "@/lib/launchpad-server";
import type { LaunchSort } from "@/lib/launchpad";
import { launchStore } from "@/lib/launchpad-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (process.env.NEXT_PUBLIC_LAUNCHPAD !== "1") throw new LaunchError("Launchpad not found.", 404);
    const { path } = await context.params;
    const url = new URL(request.url);
    let result: unknown;
    if (request.method === "GET" && path.length === 1 && path[0] === "config") result = pumpConfig();
    else if (request.method === "GET" && path.length === 1 && path[0] === "holder-tokens") {
      // Mint identity only, not market listings. Archived launches still have holders.
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new LaunchError("Invalid offset.");
      result = launchStore().holderTokens(offset);
    }
    else if (request.method === "GET" && path[0] === "tokens") {
      if (path.length === 2) result = await getPumpToken(path[1]!);
      else if (path.length === 1) result = listPumpTokens({
        sort: (url.searchParams.get("sort") ?? "newest") as LaunchSort,
        search: url.searchParams.get("search") ?? "",
        offset: Number(url.searchParams.get("offset")) || 0, limit: Number(url.searchParams.get("limit")) || 20,
      });
      else throw new LaunchError("Not found.", 404);
    } else {
      if (request.method === "POST" && !fromThisSite(request)) throw new LaunchError("Launch requests must come from this site.", 403);
      const owner = await ownerOf(request);
      if (request.method === "POST" && path.length === 1 && path[0] === "prepare") result = await prepareLaunch(await readLaunchBody(request), owner);
      else if (request.method === "POST" && path.length === 2 && path[1] === "submit") result = await submitLaunch(path[0]!, await readLaunchBody(request), owner);
      else if (request.method === "GET" && path.length === 2 && path[1] === "status") result = await statusOfLaunch(path[0]!, owner);
      else throw new LaunchError("Not found.", 404);
    }
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // RPC URLs and provider errors can contain credentials. Never echo them.
    return Response.json({ error: error instanceof LaunchError ? error.message : "The launch service could not complete the request. Please try again." }, { status: error instanceof LaunchError ? error.status : 502 });
  }
}
export const GET = handle;
export const POST = handle;
