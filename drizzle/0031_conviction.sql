-- Conviction on snapshots (docs/holder-agents.md): the clock a wallet's holding
-- keeps. The amount is the minimum, in tokens, at the reading where the wallet
-- qualified; the clock runs while each reading holds at least that much, so a
-- retune of the minimum never costs anyone their days. A sell and a rebuy
-- between two readings is not seen - the gap docs/economy.md states.
ALTER TABLE "holdings" ADD COLUMN "conviction_amount" bigint;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "conviction_since" timestamp with time zone;
