import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { CategoryRow, CreateCategoryForm } from './CategoryForms'

export const dynamic = 'force-dynamic'

export default async function CategoriesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const categories = await listCategories(getDb(), session.householdId)

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1>Categories</h1>
      </header>

      <CreateCategoryForm />

      <ul className="settings__list">
        {categories.map((category) => (
          <CategoryRow key={category.id} category={{ id: category.id, name: category.name }} />
        ))}
      </ul>
    </main>
  )
}
