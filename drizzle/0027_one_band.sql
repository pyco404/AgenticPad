-- Everyone on their own: nothing is staked any more (docs/no-loss-rewards.md),
-- so a band no longer sets what a match can move, and nothing is gained by
-- keeping agents apart. Every agent moves to band B, the middle scale, and
-- plays everyone else there. Matches keep the band they were played at, so a
-- transcript still replays and a ranked figure is still normalised as before.
UPDATE "agents" SET "band" = 'B' WHERE "band" <> 'B';
