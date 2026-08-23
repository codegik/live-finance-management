import { toSaoPauloDate } from '@/lib/domain/dates'
import { toCentavos } from '@/lib/domain/money'
import type { NewTransaction } from '@/lib/db/schema'
import type { PluggyTransaction } from './types'

export function mapTransaction(remote: PluggyTransaction, accountId: string): NewTransaction {
  return {
    accountId,
    pluggyTransactionId: remote.id,
    date: toSaoPauloDate(remote.date),
    // A foreign-currency purchase puts the foreign figure in `amount`; the
    // amount actually charged to the card is amountInAccountCurrency. Using
    // `amount` understates the spend, which is the failure this ledger exists
    // to avoid.
    amountCents: toCentavos(remote.amountInAccountCurrency ?? remote.amount, remote.type),
    description: remote.descriptionRaw ?? remote.description,
    merchantRaw: remote.merchant?.name ?? remote.merchant?.businessName ?? null,
    pluggyCategory: remote.category ?? null,
  }
}
