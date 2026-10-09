import { PublicKey } from "@solana/web3.js";
import { LAUNCH_FEE_RECIPIENT, DAILY_REWARDS_WALLET, WEEKLY_REWARDS_WALLET } from "@/lib/launchpad-fees";
import { fromThisSite, LaunchError, ownerOf, readLaunchBody } from "@/lib/launchpad-server";
import { buildPayoutPlan, type PayoutInput, type PayoutWinner } from "@/lib/payout-plan";
import { PayoutStore } from "@/lib/payout-store";
import { ExecutionStore } from "@/lib/payout-execution-store";
import { executionConfig } from "@/lib/payout-adapter";
import { payoutStep, startExecution, startPayoutWorker } from "@/lib/payout-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const apiUrl = () => process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
async function adminRead(request: Request, path: string) {
  const response = await fetch(`${apiUrl()}${path}`, { headers: { authorization: request.headers.get("authorization") ?? "" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const message = response.status === 400 ? "Invalid payout date. Weekly seasons must start on a Monday (UTC)."
      : response.status === 409 ? "This payout needs frozen scores and valid receiving wallets."
      : response.status === 401 ? "Your sign-in expired. Sign out and sign in again."
      : response.status === 403 || response.status === 404 ? "The payout API has not granted admin access to this wallet. Check that it uses the same API as the dashboard."
      : "The payout API is unavailable. Try again shortly.";
    throw new LaunchError(message, response.status);
  }
  return response.json();
}
function agpMint() {
  if (!process.env.PAYOUT_AGP_MINT) return null;
  try { return new PublicKey(process.env.PAYOUT_AGP_MINT).toBase58(); }
  catch { throw new LaunchError("The payout mint is not configured correctly.", 503); }
}
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (request.method === "POST" && !fromThisSite(request)) throw new LaunchError("Payout requests must come from this site.", 403);
    const owner = await ownerOf(request);
    await adminRead(request, "/admin");
    const { path } = await context.params;
    const store = new PayoutStore();
    const executions = new ExecutionStore(store.db);
    startPayoutWorker();
    let result: unknown;
    if (request.method === "GET" && path.join("/") === "plans") result = {
      plans: store.list(), agpMint: agpMint(), executionConnected: executionConfig().ready,
      executionMissing: executionConfig().missing, executions: executions.views(),
      sourceWallets: { daily: DAILY_REWARDS_WALLET, weekly: WEEKLY_REWARDS_WALLET }, platform: LAUNCH_FEE_RECIPIENT,
    };
    else if (request.method === "POST" && path.join("/") === "preview") {
      const body = await readLaunchBody(request);
      if ((body.kind !== "daily" && body.kind !== "weekly") || typeof body.period !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.period) ||
        !["budgetSol", "rewardPercent", "batchSol"].every((key) => typeof body[key] === "string") ||
        typeof body.delaySeconds !== "number" || typeof body.slippageBps !== "number") throw new LaunchError("Invalid payout settings.");
      const input = body as unknown as PayoutInput;
      const date = new Date(`${input.period}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.period) throw new LaunchError("Choose a valid calendar date.");
      if (input.kind === "weekly" && date.getUTCDay() !== 1) throw new LaunchError("Choose the Monday that started a completed weekly season.");
      const frozen = await adminRead(request, `/admin/payout-recipients?${input.kind === "daily" ? "day" : "season"}=${encodeURIComponent(input.period)}`) as { frozen: boolean; winners: PayoutWinner[] };
      if (!frozen.frozen) throw new LaunchError("Only frozen scores can be paid.", 409);
      for (const winner of frozen.winners) {
        if (new PublicKey(winner.wallet).toBase58() === LAUNCH_FEE_RECIPIENT) throw new LaunchError("The platform wallet cannot be a reward winner.");
      }
      let plan;
      try { plan = buildPayoutPlan(input, frozen.winners, input.kind === "daily" ? DAILY_REWARDS_WALLET : WEEKLY_REWARDS_WALLET, LAUNCH_FEE_RECIPIENT, owner); }
      catch (error) { throw new LaunchError((error as Error).message); }
      plan.agpMint = agpMint();
      store.insert(plan);
      result = plan;
    } else if (request.method === "POST" && path.length === 2 && path[1] === "approve") {
      const plan = store.get(path[0]!);
      if (!plan) throw new LaunchError("Payout plan not found.", 404);
      if (!plan.agpMint || plan.agpMint !== agpMint()) throw new LaunchError("Configure the $AGP mint and preview again before approving this plan.", 409);
      try { result = store.approve(plan.id, owner); }
      catch (error) { throw new LaunchError((error as Error).message, 409); }
    } else if (request.method === "POST" && path.length === 2 && ["start", "prepare", "submit", "pause", "resume"].includes(path[1]!)) {
      if (!executionConfig().ready && path[1] !== "pause") throw new LaunchError("Configure payout execution before starting or resuming payments.", 503);
      const id = path[0]!; const action = path[1]!;
      if (!store.get(id)) throw new LaunchError("Payout plan not found.", 404);
      try {
        if (action === "start") result = await startExecution(id, owner, undefined, executions);
        else if (action === "pause" || action === "resume") result = executions.control(id, action);
        else if (action === "prepare") result = await payoutStep(id, true, undefined, undefined, executions);
        else {
          const body = await readLaunchBody(request);
          if (typeof body.signed !== "string" || body.signed.length > 10_000) throw new LaunchError("Invalid signed payout transaction.");
          result = await payoutStep(id, false, body.signed, undefined, executions);
        }
      } catch (error) {
        if (error instanceof LaunchError) throw error;
        // Local verification errors are useful; do not return external provider errors.
        const message = error instanceof Error ? error.message : "";
        const known = ["Approve a payout", "This reward wallet", "A payout step", "A batch step", "Payout execution not found", "No payout transaction", "Only the reward wallet", "The signed launch", "The launch transaction"];
        throw new LaunchError(known.some(prefix => message.startsWith(prefix)) ? message.replaceAll("launch", "payout") : "Payout step could not be verified. Check progress and configuration before retrying.", 409);
      }
    } else throw new LaunchError("Not found.", 404);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof LaunchError ? error.message : "The payout service could not complete the request." }, { status: error instanceof LaunchError ? error.status : 502 });
  }
}
export const GET = handle;
export const POST = handle;
