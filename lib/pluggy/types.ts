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

export type PluggyTransaction = {
  id: string
  accountId: string
  description: string
  descriptionRaw?: string | null
  amount: number
  date: string
  type: 'DEBIT' | 'CREDIT'
  category?: string | null
  merchant?: { name?: string | null; businessName?: string | null } | null
  creditCardMetadata?: {
    installmentNumber?: number | null
    totalInstallments?: number | null
  } | null
}

export type PluggyConfig = {
  apiUrl: string
  clientId: string
  clientSecret: string
}
