/** Mandatory per-token anti-spam fee, separate from buys and network fees. */
export const LAUNCH_FEE_LAMPORTS = 100_000_000;

/** Server env overrides; the preview keeps the documented default wallets. */
export const LAUNCH_FEE_RECIPIENT = process.env.PUMP_PLATFORM_WALLET ?? "8d2HSFZJiAg9UP8r5k4giGTrdsBxMkzjM6g2imcWwjGf";
export const DAILY_REWARDS_WALLET = process.env.PUMP_DAILY_REWARDS_WALLET ?? "2THUfu66VhCcfZsexroAzujCxGspoYUo2DZDwWQd87T5";
export const WEEKLY_REWARDS_WALLET = process.env.PUMP_WEEKLY_REWARDS_WALLET ?? "6uLTDFMvoehtXg6PuwR1o1J4yYNYhMjpGrsDPZ3fWTQn";
