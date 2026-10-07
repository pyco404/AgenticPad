CREATE TABLE "world_activities" (
  "id" text PRIMARY KEY NOT NULL,
  "checkpoint" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL
);
