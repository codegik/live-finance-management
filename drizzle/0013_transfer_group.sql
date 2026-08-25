-- Adds the TRANSFER category group. No 'card-payment' category is inserted
-- here, unlike 0011 which back-filled its new groups: the drizzle migrator runs
-- every pending migration in ONE transaction, and Postgres forbids USING an
-- enum value in the same transaction that ADDed it ("unsafe use of new value"),
-- so inserting a TRANSFER-group category here would fail the whole deploy. The
-- category is created instead by seedCategories (lib/db/categories.ts), which
-- is idempotent and runs at household setup and on every nightly reconcile --
-- so the existing household gets 'Pagamento de cartão' on the next reconcile.
-- See lib/domain/seed-categories.ts.
ALTER TYPE "public"."category_group" ADD VALUE 'TRANSFER';
