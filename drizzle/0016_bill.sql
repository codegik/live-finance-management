CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"pluggy_bill_id" text NOT NULL,
	"period" date NOT NULL,
	"due_date" date NOT NULL,
	"closing_date" date,
	"total_amount_cents" bigint NOT NULL,
	"minimum_amount_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_pluggy_unique" ON "bill" USING btree ("pluggy_bill_id");--> statement-breakpoint
CREATE INDEX "bill_account_period_idx" ON "bill" USING btree ("account_id","period");