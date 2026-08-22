import { toSaoPauloDate } from '@/lib/domain/dates'
import { toCentavos } from '@/lib/domain/money'
import type { NewTransaction } from '@/lib/db/schema'
import type { PluggyTransaction } from './types'

export function mapTransaction(remote: PluggyTransaction, accountId: string): NewTransaction {
  return {
    accountId,
    pluggyTransactionId: remote.id,
    date: toSaoPauloDate(remote.date),
    amountCents: toCentavos(remote.amount, remote.type),
    description: remote.descriptionRaw ?? remote.description,
    merchantRaw: remote.merchant?.name ?? remote.merchant?.businessName ?? null,
    pluggyCategory: remote.category ?? null,
  }
}
