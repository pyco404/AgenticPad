-- Holder scores (docs/holder-agents.md, Scoring): each UTC day's scores are
-- frozen once the day is over, with the power inputs beside each score and the
-- parameters the day was scored with on the day's own row.
CREATE TABLE "score_days" (
	"day" integer PRIMARY KEY NOT NULL,
	"opponent_cap" integer NOT NULL,
	"min_daily_matches" integer NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_scores" (
	"day" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"ranked_matches" integer NOT NULL,
	"points" integer NOT NULL,
	"qualified" boolean NOT NULL,
	"conviction_days" integer NOT NULL,
	"share_of_supply" double precision NOT NULL,
	"power" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"score" double precision NOT NULL,
	CONSTRAINT "daily_scores_day_agent_id_pk" PRIMARY KEY("day","agent_id")
);
--> statement-breakpoint
ALTER TABLE "daily_scores" ADD CONSTRAINT "daily_scores_day_score_days_day_fk" FOREIGN KEY ("day") REFERENCES "public"."score_days"("day") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scores" ADD CONSTRAINT "daily_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
