export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PUBLIC_LAUNCHPAD_MODE === "pump" && process.env.PUMP_LAUNCH_DB_PATH) {
    const { startTokenMarkets } = await import("./lib/token-market");
    startTokenMarkets();
  }
}
