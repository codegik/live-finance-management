import { toSaoPauloDate } from '@/lib/domain/dates'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { parseInstallment } from '@/lib/domain/installments'
import { toCentavos } from '@/lib/domain/money'
import { isTransfer } from '@/lib/domain/transfers'
import type { NewTransaction } from '@/lib/db/schema'
import type { PluggyTransaction } from './types'

export function mapTransaction(remote: PluggyTransaction, accountId: string): NewTransaction {
  const merchantRaw = remote.merchant?.name ?? remote.merchant?.businessName ?? null
  const description = remote.descriptionRaw ?? remote.description
  const installment = parseInstallment(description)

  return {
    accountId,
    pluggyTransactionId: remote.id,
    date: toSaoPauloDate(remote.date),
    // A foreign-currency purchase puts the foreign figure in `amount`; the
    // amount actually charged to the card is amountInAccountCurrency. Using
    // `amount` understates the spend, which is the failure this ledger exists
    // to avoid.
    amountCents: toCentavos(remote.amountInAccountCurrency ?? remote.amount, remote.type),
    description,
    merchantRaw,
    pluggyCategory: remote.category ?? null,
    // Prefer Pluggy's merchant name: it is already the clean brand, so it
    // collapses branch variants that the descriptor alone would split.
    merchantNormalized: normalizeMerchant(merchantRaw ?? description),
    isTransfer: isTransfer(remote.category ?? null),
    installmentNumber: installment?.number ?? null,
    installmentTotal: installment?.total ?? null,
  }
}
