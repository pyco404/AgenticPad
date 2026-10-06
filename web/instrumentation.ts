export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PAYOUT_EXECUTION_ENABLED === "true") {
    const { startPayoutWorker } = await import("./lib/payout-runner");
    startPayoutWorker();
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PUBLIC_LAUNCHPAD_MODE === "pump" && process.env.PUMP_LAUNCH_DB_PATH) {
    const { startTokenMarkets } = await import("./lib/token-market");
    startTokenMarkets();
  }
}
