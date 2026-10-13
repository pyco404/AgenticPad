CREATE TABLE "negotiation_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigserial NOT NULL,
  "played_at" timestamptz NOT NULL DEFAULT now(),
  "agent_a" uuid NOT NULL REFERENCES "agents"("id"),
  "agent_b" uuid NOT NULL REFERENCES "agents"("id"),
  "preset_a" text NOT NULL,
  "preset_b" text NOT NULL,
  "seed" bigint NOT NULL,
  "net_a" integer NOT NULL,
  "net_b" integer NOT NULL,
  "scored" boolean NOT NULL DEFAULT false,
  "log" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "negotiation_matches_seq" ON "negotiation_matches" ("seq");
--> statement-breakpoint
CREATE INDEX "negotiation_matches_agent_a" ON "negotiation_matches" ("agent_a");
--> statement-breakpoint
CREATE INDEX "negotiation_matches_agent_b" ON "negotiation_matches" ("agent_b");
