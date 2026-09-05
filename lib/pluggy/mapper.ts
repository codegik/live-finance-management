import { toSaoPauloDate } from '@/lib/domain/dates'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { parseInstallment } from '@/lib/domain/installments'
import { toCentavos } from '@/lib/domain/money'
import { classifyRole } from '@/lib/domain/budget-role'
import type { NewTransaction } from '@/lib/db/schema'
import type { PluggyTransaction } from './types'

/**
 * `account` rather than an account id: the budget role now turns on whether
 * the row sits on a card or on checking, because Pluggy labels a PIX and a
 * card settlement with the same string. See lib/domain/budget-role.ts.
 */
export function mapTransaction(
  remote: PluggyTransaction,
  account: { id: string; type: 'CREDIT' | 'BANK' },
): NewTransaction {
  const merchantRaw = remote.merchant?.name ?? remote.merchant?.businessName ?? null
  const description = remote.descriptionRaw ?? remote.description
  const installment = parseInstallment(description)

  const amountCents = toCentavos(remote.amountInAccountCurrency ?? remote.amount, remote.type)

  return {
    accountId: account.id,
    pluggyTransactionId: remote.id,
    date: toSaoPauloDate(remote.date),
    // A foreign-currency purchase puts the foreign figure in `amount`; the
    // amount actually charged to the card is amountInAccountCurrency. Using
    // `amount` understates the spend, which is the failure this ledger exists
    // to avoid.
    amountCents,
    description,
    merchantRaw,
    pluggyCategory: remote.category ?? null,
    // Prefer Pluggy's merchant name: it is already the clean brand, so it
    // collapses branch variants that the descriptor alone would split.
    merchantNormalized: normalizeMerchant(merchantRaw ?? description),
    budgetRole: classifyRole(remote.category ?? null, { accountType: account.type, amountCents }),
    // Only an explicit PENDING makes it pending; an absent or POSTED status is
    // settled. A charge that later settles flips back to false on the next sync
    // (see the upsert in lib/sync/transactions.ts).
    pending: remote.status === 'PENDING',
    installmentNumber: installment?.number ?? null,
    installmentTotal: installment?.total ?? null,
  }
}
