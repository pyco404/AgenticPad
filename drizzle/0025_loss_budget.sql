-- The owner's daily loss budget (docs/security.md), mirrored from the program's
-- LossBudget account, in base units. Null for an agent without one.
--
-- "loss_budget" is in force now. "loss_budget_next" applies from UTC day
-- "loss_budget_next_from_day" when that is set: a cut waits for the next day,
-- so a settlement already agreed under the old budget can always land.
ALTER TABLE "agents" ADD COLUMN "loss_budget" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "loss_budget_next" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "loss_budget_next_from_day" integer;
