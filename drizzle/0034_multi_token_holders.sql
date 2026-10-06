ALTER TABLE agents ADD COLUMN holder_mint text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE holdings ADD COLUMN mint text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE holdings ADD COLUMN minimum bigint;
--> statement-breakpoint
ALTER TABLE holdings ADD COLUMN price_usd double precision;
--> statement-breakpoint
ALTER TABLE holdings ADD COLUMN decimals integer;
--> statement-breakpoint
ALTER TABLE holdings ADD COLUMN price_at timestamptz;
--> statement-breakpoint
ALTER TABLE holdings DROP CONSTRAINT holdings_pkey;
--> statement-breakpoint
ALTER TABLE holdings ADD PRIMARY KEY (wallet, mint);
--> statement-breakpoint
ALTER TABLE holder_preferences ADD COLUMN mint text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE holder_preferences DROP CONSTRAINT holder_preferences_pkey;
--> statement-breakpoint
ALTER TABLE holder_preferences ADD PRIMARY KEY (wallet, mint);
--> statement-breakpoint
CREATE TABLE holder_tokens (mint text PRIMARY KEY, symbol text NOT NULL, name text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX agents_active_holder_token ON agents(owner_id, holder_mint)
WHERE owner_id IS NOT NULL AND funding = 'holder' AND retired_at IS NULL;
