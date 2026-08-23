CREATE TYPE "public"."category_source" AS ENUM('PLUGGY', 'RULE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."rule_match_type" AS ENUM('EXACT', 'CONTAINS');--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"seed_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"match_type" "rule_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "merchant_normalized" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "category_source" "category_source";--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_seed_key_unique" ON "category" USING btree ("household_id","seed_key");--> statement-breakpoint
CREATE INDEX "category_household_idx" ON "category" USING btree ("household_id","sort_order");--> statement-breakpoint
CREATE INDEX "merchant_rule_household_idx" ON "merchant_rule" USING btree ("household_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rule_unique" ON "merchant_rule" USING btree ("household_id","match_type","pattern");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_category_idx" ON "transaction" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transaction_merchant_idx" ON "transaction" USING btree ("merchant_normalized");