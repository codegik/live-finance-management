import type { ConnectionDetail } from '@/lib/db/connections'

export type BankOption = { id: string; label: string }

/**
 * Names each bank by its account(s), not by `institution`: that column holds
 * Pluggy's connector label ("MeuPluggy" for every sandbox item), which does
 * not tell one bank from another. The account name is the real bank/account
 * name the household recognizes. Institution is only a fallback for a
 * connection with no accounts yet, and a short id fragment breaks any remaining
 * tie so every option stays distinct.
 *
 * Shared by the rules page picker and the "create rule from a transaction"
 * flow, so both offer the household the exact same bank labels.
 */
export function bankOptions(connections: ConnectionDetail[]): BankOption[] {
  const seen = new Set<string>()
  return connections.map((c) => {
    const names = c.accounts.map((a) => a.name).join(', ')
    let label = names || c.institution
    if (seen.has(label)) label = `${label} (${c.id.slice(0, 4)})`
    seen.add(label)
    return { id: c.id, label }
  })
}
