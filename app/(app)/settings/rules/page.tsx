import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { type ConnectionDetail, listConnectionDetails } from '@/lib/db/connections'
import { listRules } from '@/lib/db/rules'
import { CreateRuleForm, DeleteRuleForm } from './RuleForms'

export const dynamic = 'force-dynamic'

/**
 * The picker names each bank by its account(s), not by `institution`: that
 * column holds Pluggy's connector label ("MeuPluggy" for every sandbox item),
 * which does not tell one bank from another. The account name is the real
 * bank/account name the household recognizes. Institution is only a fallback
 * for a connection with no accounts yet, and a short id fragment breaks any
 * remaining tie so every option stays distinct.
 */
function bankOptions(connections: ConnectionDetail[]): { id: string; label: string }[] {
  const seen = new Set<string>()
  return connections.map((c) => {
    const names = c.accounts.map((a) => a.name).join(', ')
    let label = names || c.institution
    if (seen.has(label)) label = `${label} (${c.id.slice(0, 4)})`
    seen.add(label)
    return { id: c.id, label }
  })
}

export default async function RulesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const db = getDb()
  const [rules, categories, connections] = await Promise.all([
    listRules(db, session.householdId),
    listCategories(db, session.householdId),
    listConnectionDetails(db, session.householdId),
  ])

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <div className="page__title">
          <h1>Regras</h1>
          <span className="page__sub">
            Uma regra decide a categoria de um estabelecimento, hoje e no histórico.
          </span>
        </div>
      </header>

      {/* The inbox only ever writes EXACT rules. This form is the only way a
          CONTAINS rule -- the thing that unifies branch variants of one
          merchant -- can be created. */}
      <CreateRuleForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        connections={bankOptions(connections)}
      />

      {rules.length === 0 ? (
        <p className="empty">
          Nenhuma regra ainda. Categorize um estabelecimento em “A categorizar” para criar uma.
        </p>
      ) : (
        <ul className="settings__list">
          {rules.map((rule) => (
            <li key={rule.id} className="settings__row">
              <span>
                {rule.matchType === 'EXACT' ? 'é' : 'contém'} <strong>{rule.pattern}</strong>
                {rule.institution ? <> ({rule.institution})</> : null} → {rule.categoryName}
              </span>
              <DeleteRuleForm ruleId={rule.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
