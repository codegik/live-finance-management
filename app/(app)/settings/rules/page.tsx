import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { listRules } from '@/lib/db/rules'
import { CreateRuleForm, DeleteRuleForm } from './RuleForms'

export const dynamic = 'force-dynamic'

export default async function RulesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const db = getDb()
  const [rules, categories] = await Promise.all([
    listRules(db, session.householdId),
    listCategories(db, session.householdId),
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
      <CreateRuleForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />

      {rules.length === 0 ? (
        <p className="empty">
          Nenhuma regra ainda. Categorize um estabelecimento em “A categorizar” para criar uma.
        </p>
      ) : (
        <ul className="settings__list">
          {rules.map((rule) => (
            <li key={rule.id} className="settings__row">
              <span>
                {rule.matchType === 'EXACT' ? 'é' : 'contém'} <strong>{rule.pattern}</strong> →{' '}
                {rule.categoryName}
              </span>
              <DeleteRuleForm ruleId={rule.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
