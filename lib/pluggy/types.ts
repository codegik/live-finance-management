import { z } from 'zod'

export type PluggyItemStatus =
  | 'UPDATED'
  | 'UPDATING'
  | 'LOGIN_ERROR'
  | 'WAITING_USER_INPUT'
  | 'OUTDATED'

export type PluggyItem = {
  id: string
  status: PluggyItemStatus
  connector: { id: number; name: string }
  lastUpdatedAt: string | null
}

export type PluggyAccount = {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT'
  name: string
  number: string
  creditData?: { level?: string; balanceDueDate?: string | null; creditLimit?: number | null }
}

/**
 * Pluggy is a third party: nothing about a response is guaranteed. A missing
 * `amount` used to reach toCentavos() as undefined and be stored as R$ 0,00 --
 * a transaction that vanishes from every total while the ledger still looks
 * healthy. Validate at the boundary and fail loudly instead: a failed sync
 * leaves the connection stale, and the stale banner tells the truth.
 */
export const pluggyTransactionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  description: z.string(),
  descriptionRaw: z.string().nullish(),
  amount: z.number().finite(),
  // Present only when the transaction was made in another currency: `amount`
  // is then the foreign figure and this is the account-currency one. Verified
  // against a live payload — a USD 31.89 purchase carries 171.25 here.
  amountInAccountCurrency: z.number().finite().nullish(),
  currencyCode: z.string().nullish(),
  date: z.string().min(1),
  type: z.enum(['DEBIT', 'CREDIT']),
  // POSTED once the institution has settled the charge; PENDING while it is
  // only an authorization -- typically a card purchase on a fatura that has
  // not closed yet. The bank app shows these, so the household does too, but
  // marked provisional: a PENDING amount can still move or be reversed, and
  // Pluggy may re-post it under a different id. Nullish because not every
  // connector supplies it, and an absent status reads as POSTED (see mapper).
  status: z.enum(['POSTED', 'PENDING']).nullish(),
  category: z.string().nullish(),
  merchant: z
    .object({ name: z.string().nullish(), businessName: z.string().nullish() })
    .nullish(),
  creditCardMetadata: z
    .object({
      installmentNumber: z.number().nullish(),
      totalInstallments: z.number().nullish(),
    })
    .nullish(),
})

export type PluggyTransaction = z.infer<typeof pluggyTransactionSchema>

export type PluggyConfig = {
  apiUrl: string
  clientId: string
  clientSecret: string
}
