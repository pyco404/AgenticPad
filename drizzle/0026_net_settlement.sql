-- Hourly net settlement (src/db/netting.ts, docs/economy.md).
--
-- A staked match on the deposit flow writes its settle row as before, marked
-- "netted": it settles through its agents' hourly nets and is never sent on
-- its own. A cut takes an hour's rows ("status" = 'netted', "cut" set) and
-- writes one "net" op per agent, numbered by "batch" in the order the program
-- takes them and dated by "day" for the loss budget.
ALTER TABLE "chain_ops" ADD COLUMN "netted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD COLUMN "cut" uuid;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD COLUMN "batch" bigint;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD COLUMN "day" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chain_ops_cut_idx" ON "chain_ops" USING btree ("cut");--> statement-breakpoint
-- An owner asking for their money while matches wait for their hour.
ALTER TABLE "agents" ADD COLUMN "settle_requested_at" timestamp with time zone;
