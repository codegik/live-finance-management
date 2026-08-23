import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { listRules } from '@/lib/db/rules'
import { createRuleAction, deleteRuleAction } from './actions'

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
        <h1>Rules</h1>
      </header>

      {/* The inbox only ever writes EXACT rules. This form is the only way a
          CONTAINS rule -- the thing that unifies branch variants of one
          merchant -- can be created. */}
      <form action={createRuleAction as unknown as (formData: FormData) => void}>
        <label>
          Match
          <select name="matchType" defaultValue="CONTAINS">
            <option value="CONTAINS">anything containing</option>
            <option value="EXACT">exactly</option>
          </select>
        </label>
        <label>
          Pattern
          <input name="pattern" type="text" required />
        </label>
        <label>
          Category
          <select name="categoryId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add rule</button>
      </form>

      {rules.length === 0 ? (
        <p className="empty">No rules yet. Categorize a merchant in the inbox to create one.</p>
      ) : (
        <ul className="settings__list">
          {rules.map((rule) => (
            <li key={rule.id} className="settings__row">
              <span>
                {rule.matchType === 'EXACT' ? 'is' : 'contains'} <strong>{rule.pattern}</strong> →{' '}
                {rule.categoryName}
              </span>
              <form action={deleteRuleAction as unknown as (formData: FormData) => void}>
                <input type="hidden" name="ruleId" value={rule.id} />
                <button type="submit">Delete</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
