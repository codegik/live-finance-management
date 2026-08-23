import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { archiveCategoryAction, createCategoryAction, renameCategoryAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function CategoriesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const categories = await listCategories(getDb(), session.householdId)

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1>Categories</h1>
      </header>

      <form action={createCategoryAction as unknown as (formData: FormData) => void}>
        <label>
          New category
          <input name="name" type="text" required />
        </label>
        <button type="submit">Add</button>
      </form>

      <ul className="settings__list">
        {categories.map((category) => (
          <li key={category.id} className="settings__row">
            <form action={renameCategoryAction as unknown as (formData: FormData) => void}>
              <input type="hidden" name="categoryId" value={category.id} />
              <input name="name" type="text" defaultValue={category.name} aria-label="Category name" />
              <button type="submit">Rename</button>
            </form>
            <form action={archiveCategoryAction as unknown as (formData: FormData) => void}>
              <input type="hidden" name="categoryId" value={category.id} />
              <button type="submit">Archive</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
