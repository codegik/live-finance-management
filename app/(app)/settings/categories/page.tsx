import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { CATEGORY_GROUP_LABELS, CATEGORY_GROUPS } from '@/lib/domain/seed-categories'
import { CategoryRow, CreateCategoryForm } from './CategoryForms'

export const dynamic = 'force-dynamic'

export default async function CategoriesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const categories = await listCategories(getDb(), session.householdId)

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
        <p className="text-sm text-muted-foreground">
          O bloco decide onde a categoria é somada no mês — e, no caso da Receita, de quais
          lançamentos ela é lida.
        </p>
      </header>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Nova categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCategoryForm />
        </CardContent>
      </Card>

      {/* Listed in the blocks, in the block order, so that this screen and the
          month screen are recognisably the same taxonomy. */}
      <div className="flex flex-col gap-4">
        {CATEGORY_GROUPS.map((group) => {
          const inGroup = categories.filter((category) => category.group === group)
          if (inGroup.length === 0) return null

          return (
            <Card key={group} className="rounded-xl">
              <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border bg-surface-2/40">
                <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_GROUP_LABELS[group]}
                </CardTitle>
                <Badge variant="secondary">{inGroup.length}</Badge>
              </CardHeader>
              <CardContent className="pt-4">
                <ul className="flex flex-col divide-y divide-border">
                  {inGroup.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={{ id: category.id, name: category.name, group: category.group }}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </main>
  )
}
