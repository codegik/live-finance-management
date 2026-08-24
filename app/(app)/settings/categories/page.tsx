import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { CATEGORY_GROUP_LABELS, CATEGORY_GROUPS } from '@/lib/domain/seed-categories'
import { CategoryRow, CreateCategoryForm } from './CategoryForms'

export const dynamic = 'force-dynamic'

export default async function CategoriesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const categories = await listCategories(getDb(), session.householdId)

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Categorias</h1>
          <span className="page__sub">
            O bloco decide onde a categoria é somada no mês — e, no caso da Receita, de quais
            lançamentos ela é lida.
          </span>
        </div>
      </header>

      <CreateCategoryForm />

      {/* Listed in the blocks, in the block order, so that this screen and the
          month screen are recognisably the same taxonomy. */}
      {CATEGORY_GROUPS.map((group) => {
        const inGroup = categories.filter((category) => category.group === group)
        if (inGroup.length === 0) return null

        return (
          <section key={group} className="block">
            <header className="block__header">
              <h2 className="block__title">{CATEGORY_GROUP_LABELS[group]}</h2>
              <span className="block__planned">{inGroup.length}</span>
            </header>
            <ul className="settings__list settings__list--flush">
              {inGroup.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={{ id: category.id, name: category.name, group: category.group }}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </main>
  )
}
