import { accounts, transactions } from '@/lib/db/schema'
import { normalizeMerchant } from '@/lib/domain/categorize'
import type { Db } from '@/lib/db/client'

/**
 * The shared Pluggy fixture is asserted exactly by tests/ledger-view.test.ts,
 * so it must not grow. Tests needing other transaction shapes insert them
 * directly here — still against the real database, so this is an integration
 * path, not a mock.
 */
export async function seedAccount(
  db: Db,
  connectionId: string,
  over: { pluggyAccountId?: string; name?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(accounts)
    .values({
      connectionId,
      pluggyAccountId: over.pluggyAccountId ?? `acc-${crypto.randomUUID()}`,
      type: 'CREDIT',
      name: over.name ?? 'Card',
      last4: '9999',
    })
    .returning({ id: accounts.id })
  return row.id
}

export async function insertTransaction(
  db: Db,
  accountId: string,
  over: {
    description: string
    amountCents?: number
    date?: string
    merchantRaw?: string | null
    pluggyCategory?: string | null
  },
): Promise<string> {
  const merchantRaw = over.merchantRaw ?? null
  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      pluggyTransactionId: `tx-${crypto.randomUUID()}`,
      date: over.date ?? '2026-08-15',
      amountCents: over.amountCents ?? 10_000,
      description: over.description,
      merchantRaw,
      pluggyCategory: over.pluggyCategory ?? null,
      merchantNormalized: normalizeMerchant(merchantRaw ?? over.description),
    })
    .returning({ id: transactions.id })
  return row.id
}
