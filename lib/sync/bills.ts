import type { Executor } from '@/lib/db/client'
import { bills, type NewBill } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyBill } from '@/lib/pluggy/types'

/**
 * The calendar date out of a Pluggy date field.
 *
 * A fatura's due and closing dates are calendar dates, not instants -- a bill is
 * due "on the 17th", and Pluggy expresses that as `2026-08-17T00:00:00.000Z`.
 * Converting it as a real instant would shift it to the 16th in Sao Paulo
 * (00:00Z is 21:00 the day before), so the date part is taken verbatim. This is
 * the opposite of a transaction timestamp, which IS an instant -- see
 * lib/domain/dates.ts toSaoPauloDate.
 */
function billDate(value: string): string {
  return value.slice(0, 10)
}

/**
 * A Pluggy fatura into a `bill` row.
 *
 * `period` is the first of the due-date's month -- the month the household pays
 * it, which is the same key the budgeting screens bucket transactions under
 * (budget_month). Amounts are rounded to the centavo: a live payload carried a
 * sub-centavo total (`179.5958`), which stored raw would never reconcile.
 */
export function mapBill(remote: PluggyBill, accountId: string): NewBill {
  const dueDate = billDate(remote.dueDate)
  return {
    accountId,
    pluggyBillId: remote.id,
    period: `${dueDate.slice(0, 7)}-01`,
    dueDate,
    closingDate: remote.billClosingDate ? billDate(remote.billClosingDate) : null,
    totalAmountCents: Math.round(remote.totalAmount * 100),
    minimumAmountCents:
      remote.minimumPaymentAmount != null ? Math.round(remote.minimumPaymentAmount * 100) : null,
  }
}

/**
 * Pulls and stores every closed fatura for one account. A BANK account has
 * none, so it is skipped rather than round-tripping to Pluggy for an empty
 * result. Idempotent by `pluggy_bill_id`: a re-sync of a bill whose total the
 * bank later restated (a late fee, a reversal) updates it in place.
 */
export async function syncBills(
  exec: Executor,
  pluggy: PluggyClient,
  account: { id: string; pluggyAccountId: string; type: 'CREDIT' | 'BANK' },
): Promise<{ upserted: number }> {
  if (account.type !== 'CREDIT') return { upserted: 0 }

  const remote = await pluggy.listBills(account.pluggyAccountId)
  let upserted = 0
  for (const rb of remote) {
    const row = mapBill(rb, account.id)
    await exec
      .insert(bills)
      .values(row)
      .onConflictDoUpdate({
        target: bills.pluggyBillId,
        set: {
          period: row.period,
          dueDate: row.dueDate,
          closingDate: row.closingDate,
          totalAmountCents: row.totalAmountCents,
          minimumAmountCents: row.minimumAmountCents,
          updatedAt: new Date(),
        },
      })
    upserted += 1
  }
  return { upserted }
}
