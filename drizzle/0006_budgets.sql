CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "is_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "installment_number" integer;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "installment_total" integer;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_period_unique" ON "budget" USING btree ("household_id","category_id","period_month");--> statement-breakpoint
CREATE INDEX "budget_household_idx" ON "budget" USING btree ("household_id","period_month");--> statement-breakpoint
CREATE INDEX "transaction_date_idx" ON "transaction" USING btree ("date");--> statement-breakpoint
-- Backfill is_transfer on the rows that already exist.
--
-- The column added above defaults to false, so without this every invoice
-- payment, transfer and fee already in the table counts as spending until the
-- nightly reconcile's refreshTransferFlags pass happens to run -- up to ~24
-- hours in which the new dashboard's headline total is wrong by the value of
-- every invoice the household has ever paid (R$177,174.79 on the live
-- connection, across 113 rows).
--
-- These four strings MUST stay in sync with TRANSFER_PLUGGY_CATEGORIES in
-- lib/domain/transfers.ts. Adding one there needs a NEW migration: the rows
-- already in the database are not revisited by this one.
--
-- installment_number/installment_total deliberately get no equivalent
-- backfill. The asymmetry is a decision, not an oversight: syncConnection
-- reads each account's full history and re-upserts every row through
-- mapTransaction, so the instalment columns self-heal on the next sync.
-- is_transfer cannot rely on that, because it also has to be right for the
-- hours before that sync.
UPDATE "transaction" SET "is_transfer" = true
WHERE "pluggy_category" IN
  ('Credit card payment','Transfers','Tax on financial operations','Credit card fees');
