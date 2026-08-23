CREATE TYPE "public"."budget_role" AS ENUM('SPEND', 'TRANSFER', 'INCOME');--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "budget_role" "budget_role" DEFAULT 'SPEND' NOT NULL;--> statement-breakpoint

-- Carry the boolean across before dropping it. refreshBudgetRoles would
-- eventually do this, but it is up to 24 hours away at deploy time and every
-- figure is wrong until it runs.
UPDATE "transaction" SET "budget_role" = 'TRANSFER' WHERE "is_transfer" = true;--> statement-breakpoint

-- Income has never had a column, so there is nothing to carry: these rows are
-- classified here for the first time. The list is duplicated from
-- INCOME_PLUGGY_CATEGORIES in lib/domain/budget-role.ts and
-- tests/budget-role.test.ts asserts the two agree.
UPDATE "transaction" SET "budget_role" = 'INCOME'
  WHERE "pluggy_category" IN ('Salary', 'Retirement', 'Interest income', 'Investment redemption');--> statement-breakpoint

ALTER TABLE "transaction" DROP COLUMN "is_transfer";
