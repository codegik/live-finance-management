import { and, inArray, isNotNull, like, or } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { transactions } from '@/lib/db/schema'
import { householdTransactionIds } from '@/lib/db/transactions'
import { parseInstallment } from '@/lib/domain/installments'

/**
 * Brings `installment_number` / `installment_total` into line with what the
 * descriptors actually say.
 *
 * WHY THIS EXISTS. The two columns arrived in drizzle/0006_budgets.sql with no
 * backfill, and Pluggy never re-delivers an old transaction -- so every row
 * already in the table stayed NULL for good. On a live connection that was all
 * 1,537 of them: 116 rows worth R$ 34.967,76 that are plainly instalments
 * ('AUTO MECANICA BOA 06/10') and were flagged as nothing.
 *
 * The parser was never at fault; it reads all of those correctly. Only the
 * backfill was missing. Two things break without it, and both are silent:
 *
 *   - The forward view is built entirely on `installment_total IS NOT NULL`,
 *     so "Comprometido" renders empty over a household with three years of
 *     committed parcelas.
 *   - pace() adds instalments at face value and extrapolates everything else.
 *     An unflagged parcela dated earlier this month becomes a daily rate --
 *     the "one R$1,147 car instalment seen on the 10th projects R$3,556 by
 *     month end" false alarm that lib/domain/budget.ts exists to prevent.
 *
 * Runs nightly rather than once, for the same reason refreshBudgetRoles does:
 * an improved parser then lands without a migration. It also CLEARS the
 * columns on a row whose descriptor no longer parses, so a fix that stops
 * matching '10/12' inside a date does not leave phantom commitments behind.
 *
 * parseInstallment is imported, never reimplemented in SQL. The rule has real
 * subtleties -- symmetric slash guards so a Brazilian date is not read as a
 * parcel, digits glued to letters allowed but digits glued to digits refused --
 * and a second copy in SQL would drift from the one the ingest path uses.
 */
export async function refreshInstallments(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
  // Only rows that could possibly be affected: something that already carries
  // a parse, or something whose descriptor contains a slash. Everything else
  // is neither flagged nor flaggable, and reading it would mean pulling a
  // household's entire history into memory to prove it.
  const candidates = await exec
    .select({
      id: transactions.id,
      description: transactions.description,
      installmentNumber: transactions.installmentNumber,
      installmentTotal: transactions.installmentTotal,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
        or(isNotNull(transactions.installmentTotal), like(transactions.description, '%/%')),
      ),
    )

  const updates = new Map<string, string[]>()
  for (const row of candidates) {
    const parsed = parseInstallment(row.description)
    const number = parsed?.number ?? null
    const total = parsed?.total ?? null

    // Only rows whose stored value is actually wrong, so a nightly no-op
    // costs no writes and the returned count is honest.
    if (number === row.installmentNumber && total === row.installmentTotal) continue

    const key = `${number ?? 'null'}:${total ?? 'null'}`
    updates.set(key, [...(updates.get(key) ?? []), row.id])
  }

  let changed = 0
  for (const [key, ids] of updates) {
    const [number, total] = key.split(':').map((v) => (v === 'null' ? null : Number(v)))
    // Grouped by value and chunked: one UPDATE per distinct instalment pair
    // rather than per row, and never more ids than the driver will bind.
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500)
      await exec
        .update(transactions)
        .set({ installmentNumber: number, installmentTotal: total, updatedAt: new Date() })
        .where(inArray(transactions.id, slice))
      changed += slice.length
    }
  }

  return { changed }
}
