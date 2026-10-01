-- Bands are gone. They were money scales that set how much a match could move,
-- and with nothing staked (docs/no-loss-rewards.md) they have no job left: every
-- match plays at one scale, the engine's own stakes (ante 4, bet 10, raised 20),
-- and a chip is a chip. 0027 already put every agent in band B.
--
-- A match still keeps the stakes it was played at in rules_config, so a match
-- played in another band before this still replays exactly.
ALTER TABLE "agents" DROP COLUMN "band";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "band";
