CREATE TYPE "public"."recurring_cadence" AS ENUM('MONTHLY', 'ANNUAL');--> statement-breakpoint
CREATE TABLE "recurring_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"match_type" "rule_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"title" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" bigint,
	"day_of_month" integer NOT NULL,
	"cadence" "recurring_cadence" DEFAULT 'MONTHLY' NOT NULL,
	"anchor_month" date NOT NULL,
	"end_month" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_expense_unique" ON "recurring_expense" USING btree ("household_id","match_type","pattern");--> statement-breakpoint
CREATE INDEX "recurring_expense_household_idx" ON "recurring_expense" USING btree ("household_id");