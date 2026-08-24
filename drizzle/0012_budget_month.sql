ALTER TABLE "transaction" ADD COLUMN "budget_month" date;--> statement-breakpoint
CREATE INDEX "transaction_budget_month_idx" ON "transaction" USING btree ("budget_month");--> statement-breakpoint
-- Seeded to the transaction's own month, which is exactly what every screen
-- used before this column existed. The nightly refreshBudgetMonths pass then
-- shifts card purchases onto the fatura that pays them
-- (lib/sync/budget-month.ts), but it is up to 24 hours away at deploy time and
-- a NULL here would empty every budgeting screen until it ran.
UPDATE "transaction" SET "budget_month" = date_trunc('month', "date")::date;
