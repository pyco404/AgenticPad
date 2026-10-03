-- Holding is the only way to an agent now (docs/holder-agents.md). Every
-- player agent from the seed and deposit flows is retired here, with its record
-- kept: the program that held their vaults is no longer served, so they cannot
-- be told apart from their money any more. Whatever a vault holds stays where
-- it is, on devnet, in a test token. House agents are not touched: they hold
-- nothing and play on.
UPDATE "agents"
SET "retired_at" = now(), "retired_reason" = 'replaced', "autoplay" = false
WHERE "owner_id" IS NOT NULL AND "funding" <> 'holder' AND "retired_at" IS NULL;
