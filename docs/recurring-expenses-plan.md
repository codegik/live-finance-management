# Recurring expenses — plan

## The problem

Planning upcoming months is hard because there is no record of what repeats. The
same bills land every month (plano de saúde, academia, escola, streaming) plus
some annual ones (IPVA, seguro), but the app only ever shows a month once its
real transactions have arrived. There is nothing that says *"this repeats, and
here is what to expect next month."*

## The idea

Recurring items live **inline under their category**, in the same expandable
block the month sheet already renders. Expand *Saúde* and you see its real
charges **plus** its recurring lines (`previsto`), and you can add a new
recurring item right there under the category.

## Why it is mostly reuse

The custom-label feature (`merchantLabels` + `resolveLabel` + `normalizeMerchant`)
is already the exact matching engine this needs: a household-defined thing linked
to real charges by a normalized `(matchType, pattern)` against
`merchant_normalized`, with an editable title on top. A recurring expense is the
same shape plus an amount and a cadence. One matching model across rules, labels,
and recurring — no new matching logic.

## Decisions (from the user)

- **Matching:** auto-match, editable — reuse the label/rule `(matchType, pattern)`
  engine. The pattern (and title) are editable exactly like an apelido, which is
  what makes the match correctable.
- **Variable amounts:** rolling average of the last N matched charges when
  `amountCents` is null.
- **Creation:** from a charge (glyph next to the apelido/rule cluster) **and**
  a "+ Adicionar recorrente" row inside each expanded category.
- **Making a charge recurring also creates a label** (the apelido feature): the
  same `(matchType, pattern)` is stored as a `merchant_label` with the title as
  its name, so the merchant reads by that name everywhere -- ledger, inbox, and
  the real charge that later fulfils it. Removing a recurrence leaves the apelido
  in place (renaming is a separate concern; the pencil removes it).
- **A real charge overrides the recurrence for its month:** when an incoming
  Pluggy charge matches (same category + pattern), the forecast is suppressed and
  the charge's own amount and date stand -- even when they differ from the stored
  figure. The stored recurrence is untouched for other months. The charge is
  badged `recorrente` (via `MonthTransaction.recurring`).
- **Edit only while unfulfilled:** the "make recurring" glyph is withheld on a
  charge that already fulfils a recurrence, and editing is offered on the
  `previsto` line. So a recurrence is edited on a month where it is still a
  forecast, never on one where the real charge has already landed.

## Known gap (later)

An incoming charge that lands *uncategorized* does not match (matching is scoped
to the category), so its month still shows the forecast until it is categorised.
Pluggy's own category mapping or an existing rule usually files it correctly; if
this proves common, making a recurrence also create a `merchant_rule` (not just a
label) would close it.

## Data model — `recurring_expense` (mirrors `merchant_label`)

| column        | notes                                                        |
|---------------|--------------------------------------------------------------|
| id            | uuid pk                                                       |
| householdId   | fk households, cascade                                        |
| matchType     | EXACT \| CONTAINS (`rule_match_type` enum)                    |
| pattern       | normalized, matches `merchant_normalized` (like a label)     |
| title         | editable name shown on the projected line                    |
| categoryId    | fk categories, cascade                                        |
| amountCents   | bigint, **nullable** → null = variable → rolling average      |
| dayOfMonth    | integer 1..31, seeded from the source charge's date          |
| cadence       | `recurring_cadence` enum: MONTHLY (default) \| ANNUAL         |
| anchorMonth   | date (first-of-month) — start; ANNUAL uses its month         |
| endMonth      | date, nullable — stop projecting after this month            |
| active        | boolean default true                                         |
| createdAt/updatedAt | timestamps                                             |

Unique index `(householdId, matchType, pattern)` — retyping a pattern updates in
place, same rule as `merchant_label`.

## The three states (powered by the matcher)

For a category in a given month, for each recurring def test whether any real
transaction that month matches its `(matchType, pattern)` — the same
`merchant.includes(pattern)` test `resolveLabel` uses:

1. **Matched** → the real charge fulfils this month's recurrence. Show the real
   charge (optionally badged `recorrente`), **no projected line** → no double
   count.
2. **Unmatched, current/future month** → render a `previsto` line at
   `amountCents ?? rollingAverage`, feeding committed/projected totals, not
   `actualCents`.
3. **Unmatched, month closed** → expected and never came — a "did this stop?"
   signal (later polish).

Rolling average = mean of the last N real charges matching that pattern
(available today from history keyed by `merchant_normalized`).

## Slices

- **Slice 1 (this change):** `recurring_expense` table + migration +
  `lib/db/recurring-expenses.ts` (set / clear / list / resolve, cloned from
  `merchant-labels.ts`) + rolling-average helper + unit tests.
- **Slice 2:** projection + de-dup in `lib/views/month.ts`; emit `previsto`
  lines and feed committed/projected totals; honour month stance.
- **Slice 3:** creation modals (from-charge glyph + "+ Adicionar recorrente")
  and rendering the projected `<li>`s in `MonthBlock`, plus server actions.

## Open questions (later)

- ANNUAL bills (IPVA, seguro): project only in the anchor month; how to surface
  the "coming in 4 months" hint on other months.
- The credit-card fatura itself as a recurring line vs the existing
  pending-fatura section — keep separate for now.
