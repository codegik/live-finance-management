DROP INDEX "merchant_rule_unique";--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rule_unique" ON "merchant_rule" USING btree ("household_id","match_type","pattern",coalesce("connection_id", '00000000-0000-0000-0000-000000000000'));