CREATE TYPE "public"."category_group" AS ENUM('RECEITA', 'INVESTIMENTO', 'DESPESA_FIXA', 'DESPESA_VARIAVEL');--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "group" "category_group" DEFAULT 'DESPESA_VARIAVEL' NOT NULL;--> statement-breakpoint
-- Backfill mirrors lib/domain/seed-categories.ts. Keyed on seed_key, never on
-- name: a household that renamed 'Casa' to 'Apartamento' must still land in
-- Despesas fixas.
UPDATE "category" SET "group" = 'DESPESA_FIXA'
  WHERE "seed_key" IN ('home', 'education', 'subscriptions');--> statement-breakpoint
-- Receita and Investimento have no rows to backfill: until now the taxonomy
-- had no way to express either, so every existing household needs the new
-- categories created. Without this the two new blocks render empty for every
-- household that predates this migration, which reads as "you earned nothing".
-- sort_order continues past the 15 seeded in Slice 2.
INSERT INTO "category" ("household_id", "name", "seed_key", "sort_order", "group")
SELECT h."id", v."name", v."seed_key", v."sort_order", v."group"::"category_group"
FROM "household" h
CROSS JOIN (VALUES
  ('income-salary',    'Salário',                  100, 'RECEITA'),
  ('income-extra',     'Renda extra',              101, 'RECEITA'),
  ('invest-portfolio', 'Carteira de investimento', 200, 'INVESTIMENTO'),
  ('invest-pension',   'Previdência',              201, 'INVESTIMENTO'),
  ('invest-emergency', 'Reserva de emergência',    202, 'INVESTIMENTO')
) AS v("seed_key", "name", "sort_order", "group")
ON CONFLICT DO NOTHING;
